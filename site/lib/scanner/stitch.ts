/**
 * In-browser pose-guided panorama stitching (WebGL2).
 *
 * The same method as `src/sodar/stitch/posed.py` and the Photo Sphere Android
 * stitcher: every frame is projected onto an equirectangular canvas from the
 * orientation the phone reported when the shutter fired. On the GPU each frame
 * is one full-screen pass with additive blending into a float accumulator
 * (rgb·w, w); a final pass normalises. A dozen frames at 2048×1024 take a few
 * tens of milliseconds on a phone, so the room can be previewed in Photo Sphere
 * Viewer the moment its ring is complete — no server round-trip.
 *
 * Conventions match lib/scanner/sphere.ts and src/sodar/stitch/posed.py: yaw
 * compass-like (0 = north, clockwise), elevation positive up (= −pitch), roll
 * about the optical axis; output longitude 0 at the image centre, latitude +90°
 * at the top row; the coverage mask is white where nothing was captured.
 *
 * This is the instant on-device preview, not survey-grade geometry: frames are
 * projected from sensor poses (wrist pivot parallax is not corrected) and
 * blended with feathered, view-angle weights. The server path (posed-stitch
 * with ORB refinement, OpenCV as an optional refinement) produces the
 * higher-resolution result later with the same conventions.
 */

export type StitchFrame = { blob: Blob; yaw: number; elevation: number; roll: number };
export type StitchOptions = {
  /** Output width (height = width / 2). 2048 for the instant preview; up to the GPU's texture limit for the high-quality pass. */
  width?: number;
  /** Longest side each source frame is decoded to. Originals on disk are never touched. */
  maxFrameDim?: number;
  fov: { horizontal: number; vertical: number };
  /** Clamp for per-frame exposure gain; keeps a badly exposed frame from being amplified into noise. */
  gainRange?: [number, number];
  onProgress?: (done: number, total: number) => void;
};
/**
 * `panorama` holds captured pixels only (black where nothing was captured);
 * `mask` is white where the sphere is uncovered, so a black captured pixel and
 * a missing pixel can always be told apart. `coverage` is the covered fraction.
 */
export type StitchOutput = { panorama: Blob; mask: Blob; coverage: number; width: number; height: number; frames: number; durationMs: number; gains: number[] };

/** Largest 2:1 output the current GPU can render (bounded to 8192). */
export function maxStitchWidth(): number {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const max = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 2048;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Math.min(8192, Math.max(1024, Math.floor(max / 1024) * 1024));
  } catch {
    return 2048;
  }
}

const VERT = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG_PROJECT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec3 u_right, u_up, u_forward; uniform float u_tanH, u_tanV, u_gain;
const float PI = 3.141592653589793;
void main(){
  // v_uv is already at pixel centres (interpolated from the full-screen quad), so
  // column 0 and column W-1 map to distinct longitudes and the ±π wrap has no seam.
  float lon = v_uv.x * 2.0 * PI - PI;       // -π..π, 0 = north
  float lat = v_uv.y * PI - PI * 0.5;       // -π/2..π/2, top = +
  vec3 d = vec3(sin(lon) * cos(lat), cos(lon) * cos(lat), sin(lat));
  float cz = dot(d, u_forward);
  if (cz < 0.15) discard;
  float u = 0.5 + (dot(d, u_right) / cz) / (2.0 * u_tanH);
  float v = 0.5 - (dot(d, u_up) / cz) / (2.0 * u_tanV);
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;
  // Overlap weighting: a smooth (cosine) ramp from the frame edge over 22 % of the
  // frame, multiplied by how central the ray is (cz) so the frame that saw a
  // surface most head-on dominates. Wins against the old linear 18 % ramp on
  // ghosting at seams, and lets edges fade instead of cutting.
  float edge = min(min(u, 1.0 - u), min(v, 1.0 - v)) / 0.22;
  float ramp = edge >= 1.0 ? 1.0 : 0.5 - 0.5 * cos(clamp(edge, 0.0, 1.0) * PI);
  float w = max(0.02, ramp) * (0.35 + 0.65 * cz * cz);
  vec3 c = texture(u_tex, vec2(u, v)).rgb * u_gain;
  o = vec4(c * w, w);
}`;

const FRAG_RESOLVE = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o; uniform sampler2D u_acc;
void main(){
  vec4 a = texture(u_acc, vec2(v_uv.x, 1.0 - v_uv.y));
  o = a.a > 0.0 ? vec4(a.rgb / a.a, 1.0) : vec4(0.0, 0.0, 0.0, 0.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
  return s;
}

function program(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program link failed");
  return p;
}

function basis(yaw: number, elevation: number, roll: number): { right: number[]; up: number[]; forward: number[] } {
  const y = (yaw * Math.PI) / 180, e = (elevation * Math.PI) / 180, r = (roll * Math.PI) / 180;
  const forward = [Math.sin(y) * Math.cos(e), Math.cos(y) * Math.cos(e), Math.sin(e)];
  const right0 = [Math.cos(y), -Math.sin(y), 0];
  const up0 = [right0[1] * forward[2] - right0[2] * forward[1], right0[2] * forward[0] - right0[0] * forward[2], right0[0] * forward[1] - right0[1] * forward[0]];
  const right = right0.map((v, i) => v * Math.cos(r) - up0[i] * Math.sin(r));
  const up = up0.map((v, i) => v * Math.cos(r) + right0[i] * Math.sin(r));
  return { right, up, forward };
}

async function decode(blob: Blob, maxDim: number): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(blob);
  if (Math.max(bmp.width, bmp.height) <= maxDim) return bmp;
  const scale = maxDim / Math.max(bmp.width, bmp.height);
  const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * scale), resizeHeight: Math.round(bmp.height * scale), resizeQuality: "high" });
  bmp.close();
  return small;
}

/** Mean luminance of a bitmap from a 16×16 downsample — used for per-frame gain. */
function meanLuma(bmp: ImageBitmap): number {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}

export async function stitchFrames(frames: StitchFrame[], opts: StitchOptions): Promise<StitchOutput> {
  const started = performance.now();
  if (!frames.length) throw new Error("no frames to stitch");
  const width = Math.max(512, Math.floor((opts.width ?? 2048) / 2) * 2);
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is not available");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets are not available");

  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const bind = (p: WebGLProgram) => {
    gl.useProgram(p);
    const loc = gl.getAttribLocation(p, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  };

  // accumulator
  const acc = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, acc);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete");
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  const proj = program(gl, FRAG_PROJECT);
  bind(proj);
  const uTex = gl.getUniformLocation(proj, "u_tex");
  const uRight = gl.getUniformLocation(proj, "u_right");
  const uUp = gl.getUniformLocation(proj, "u_up");
  const uForward = gl.getUniformLocation(proj, "u_forward");
  const uTanH = gl.getUniformLocation(proj, "u_tanH");
  const uTanV = gl.getUniformLocation(proj, "u_tanV");
  const uGain = gl.getUniformLocation(proj, "u_gain");
  gl.uniform1f(uTanH, Math.tan((opts.fov.horizontal * Math.PI) / 360));
  gl.uniform1f(uTanV, Math.tan((opts.fov.vertical * Math.PI) / 360));

  // Decode a few at a time: 80 full-size ImageBitmaps at once would exhaust a phone.
  const maxDim = opts.maxFrameDim ?? 1280;
  const [gainMin, gainMax] = opts.gainRange ?? [0.7, 1.45];
  const lumas: number[] = [];
  const gains: number[] = [];

  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(uTex, 0);

  // Pass 1: exposure statistics from tiny decodes (no GPU work yet).
  for (const f of frames) {
    const small = await decode(f.blob, 64);
    lumas.push(meanLuma(small));
    small.close();
  }
  const sorted = [...lumas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  // Pass 2: project each frame, decoding in small batches.
  const BATCH = 6;
  for (let start = 0; start < frames.length; start += BATCH) {
    const slice = frames.slice(start, start + BATCH);
    const bitmaps = await Promise.all(slice.map((f) => decode(f.blob, maxDim)));
    slice.forEach((f, k) => {
      const i = start + k;
      const bmp = bitmaps[k];
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      const b = basis(f.yaw, f.elevation, f.roll);
      gl.uniform3fv(uRight, b.right);
      gl.uniform3fv(uUp, b.up);
      gl.uniform3fv(uForward, b.forward);
      const gain = lumas[i] > 1 ? Math.min(gainMax, Math.max(gainMin, median / lumas[i])) : 1;
      gains.push(gain);
      gl.uniform1f(uGain, gain);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      bmp.close();
      opts.onProgress?.(i + 1, frames.length);
    });
    // Let the UI breathe between batches on slow phones.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // resolve to the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, width, height);
  const res = program(gl, FRAG_RESOLVE);
  bind(res);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, acc);
  gl.uniform1i(gl.getUniformLocation(res, "u_acc"), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // coverage mask from the resolved alpha
  const px = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const mctx = maskCanvas.getContext("2d")!;
  const mimg = mctx.createImageData(width, height);
  let covered = 0;
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width; // readPixels is bottom-up
    for (let x = 0; x < width; x++) {
      const a = px[(srcRow + x) * 4 + 3];
      const o = (y * width + x) * 4;
      const v = a > 0 ? 0 : 255; // white = uncovered (same convention as the Python provider)
      if (a > 0) covered++;
      mimg.data[o] = v;
      mimg.data[o + 1] = v;
      mimg.data[o + 2] = v;
      mimg.data[o + 3] = 255;
    }
  }
  mctx.putImageData(mimg, 0, 0);

  // panorama JPEG from the resolved canvas (flatten alpha onto black)
  const flat = document.createElement("canvas");
  flat.width = width;
  flat.height = height;
  const fctx = flat.getContext("2d")!;
  fctx.fillStyle = "#000";
  fctx.fillRect(0, 0, width, height);
  fctx.drawImage(canvas, 0, 0);
  const panorama = await new Promise<Blob>((resolve, reject) => flat.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.9));
  const mask = await new Promise<Blob>((resolve, reject) => maskCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"));

  // Release GPU + canvas memory explicitly: Safari keeps WebGL contexts alive otherwise.
  gl.deleteTexture(tex);
  gl.deleteTexture(acc);
  gl.deleteFramebuffer(fbo);
  gl.deleteBuffer(quad);
  gl.deleteProgram(proj);
  gl.deleteProgram(res);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  canvas.width = canvas.height = 0;
  flat.width = flat.height = 0;
  maskCanvas.width = maskCanvas.height = 0;
  return { panorama, mask, coverage: covered / (width * height), width, height, frames: frames.length, durationMs: Math.round(performance.now() - started), gains };
}

/**
 * Client half of the GPT Image 2 fill: pad the 2:1 panorama into the
 * 1536×1024 canvas the edit endpoint accepts, build the alpha mask (transparent
 * = paint here), post to /api/ai-fill, and map the result back to 2:1.
 *
 * Geometry: the 1536×768 strip in the middle covers latitudes ±67.5° of the
 * sphere's ±90°, i.e. exactly the band a ring capture at ~72° vertical FOV can
 * reach; the 128 px bands above and below are the missing zenith and nadir.
 */
export type FillResult = { panorama: Blob; width: number; height: number };

async function bitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export function aiFillEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AI_FILL === "1";
}

export async function aiFillPanorama(panorama: Blob, mask: Blob, outWidth = 2048): Promise<FillResult> {
  const [pano, m] = await Promise.all([bitmap(panorama), bitmap(mask)]);
  const W = 1536, H = 1024, STRIP = 768, BAND = 128;

  const img = document.createElement("canvas");
  img.width = W;
  img.height = H;
  const ictx = img.getContext("2d")!;
  ictx.fillStyle = "#000";
  ictx.fillRect(0, 0, W, H);
  ictx.drawImage(pano, 0, BAND, W, STRIP);

  // alpha mask: opaque = keep, transparent = editable
  const mk = document.createElement("canvas");
  mk.width = W;
  mk.height = H;
  const mctx = mk.getContext("2d")!;
  const md = mctx.createImageData(W, H);
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = STRIP;
  const tctx = tmp.getContext("2d")!;
  tctx.drawImage(m, 0, 0, W, STRIP);
  const cov = tctx.getImageData(0, 0, W, STRIP).data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let keep = true;
      if (y < BAND || y >= BAND + STRIP) keep = false;
      else if (cov[((y - BAND) * W + x) * 4] > 127) keep = false; // white in the coverage mask = uncovered
      md.data[o] = 0;
      md.data[o + 1] = 0;
      md.data[o + 2] = 0;
      md.data[o + 3] = keep ? 255 : 0;
    }
  }
  mctx.putImageData(md, 0, 0);

  const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"));
  const form = new FormData();
  form.set("image", await toBlob(img), "panorama.png");
  form.set("mask", await toBlob(mk), "mask.png");
  const res = await fetch("/api/ai-fill", { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string; error?: string }).message || (body as { error?: string }).error || `ai-fill failed (${res.status})`);
  }
  const filled = await bitmap(await res.blob());

  // The whole 1536×1024 canvas now represents the full ±90° sphere → resample to 2:1.
  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outWidth / 2;
  out.getContext("2d")!.drawImage(filled, 0, 0, outWidth, outWidth / 2);
  const blob = await new Promise<Blob>((r, j) => out.toBlob((b) => (b ? r(b) : j(new Error("encode failed"))), "image/jpeg", 0.9));
  pano.close();
  m.close();
  filled.close();
  return { panorama: blob, width: outWidth, height: outWidth / 2 };
}

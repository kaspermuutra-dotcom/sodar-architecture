/**
 * Camera selection and control for the scanner.
 *
 * Goals: the rear *wide* camera (not ultra-wide, not telephoto), a stable
 * exposure during a room, continuous focus, and full-resolution JPEG stills
 * without re-encoding the preview. All of it is best-effort behind feature
 * detection: Safari on iPhone exposes far fewer constraints than Chrome on
 * Android, and a failed constraint must never stop the capture.
 */
export type CameraCapabilities = { deviceLabel: string; width: number; height: number; exposureLocked: boolean; focusMode: string | null; torch: boolean; zoom: number | null; facing: string | null };

const ULTRA_WIDE = /ultra|0\.5|wide angle 0|超広角|广角|weitwinkel 0/i;
const TELE = /tele|2x|3x|5x|zoom/i;
const REAR = /back|rear|environment|arrière|rück|trasera|posteriore|achter|bak|taka|tagumine|后置|後置/i;

/** Picks the rear main camera id from enumerated devices, avoiding ultra-wide and telephoto labels. Labels need a granted permission. */
export function pickRearWideCamera(devices: MediaDeviceInfo[]): string | undefined {
  const video = devices.filter((device) => device.kind === "videoinput");
  const rear = video.filter((device) => REAR.test(device.label));
  const candidates = (rear.length ? rear : video).filter((device) => !ULTRA_WIDE.test(device.label) && !TELE.test(device.label));
  // Android often lists "camera2 0, facing back" first for the main sensor; iOS lists "Back Camera" before "Back Ultra Wide Camera".
  return (candidates.find((device) => /\b0\b|main|principal|haupt/i.test(device.label)) ?? candidates[0] ?? rear[0] ?? video[0])?.deviceId;
}

export async function openRearCamera(): Promise<MediaStream> {
  const base: MediaTrackConstraints = { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 }, frameRate: { ideal: 30, max: 30 } };
  let stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const preferred = pickRearWideCamera(devices);
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    if (preferred && current && preferred !== current) {
      const swapped = await navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: { exact: preferred } }, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      stream = swapped;
    }
  } catch {
    // Enumeration or re-open failed: keep the first stream.
  }
  return stream;
}

type ExtendedCapabilities = MediaTrackCapabilities & { exposureMode?: string[]; focusMode?: string[]; whiteBalanceMode?: string[]; torch?: boolean; zoom?: { min: number; max: number } };
type ExtendedConstraints = MediaTrackConstraintSet & { exposureMode?: string; focusMode?: string; whiteBalanceMode?: string; zoom?: number };

/** Continuous focus + auto exposure while the person frames the first shot. */
export async function prepareTrack(track: MediaStreamTrack): Promise<void> {
  const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  const advanced: ExtendedConstraints[] = [];
  if (caps.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
  if (caps.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
  if (caps.whiteBalanceMode?.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
  if (caps.zoom && caps.zoom.min <= 1 && caps.zoom.max >= 1) advanced.push({ zoom: 1 });
  if (advanced.length) await track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => undefined);
}

/**
 * Locks exposure and white balance for the rest of the room so frames match.
 * Chrome on Android supports `exposureMode: "manual"` keeping the current
 * exposure; Safari does not, in which case the stitcher's gain compensation
 * takes over. Returns whether a lock took effect.
 */
export async function lockExposure(track: MediaStreamTrack): Promise<boolean> {
  const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  const advanced: ExtendedConstraints[] = [];
  if (caps.exposureMode?.includes("manual")) advanced.push({ exposureMode: "manual" });
  if (caps.whiteBalanceMode?.includes("manual")) advanced.push({ whiteBalanceMode: "manual" });
  if (!advanced.length) return false;
  try {
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
    const settings = track.getSettings() as MediaTrackSettings & { exposureMode?: string };
    return settings.exposureMode === "manual";
  } catch {
    return false;
  }
}

export async function unlockExposure(track: MediaStreamTrack): Promise<void> {
  const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  const advanced: ExtendedConstraints[] = [];
  if (caps.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
  if (caps.whiteBalanceMode?.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
  if (advanced.length) await track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => undefined);
}

export function describeTrack(track: MediaStreamTrack, exposureLocked: boolean): CameraCapabilities {
  const settings = track.getSettings() as MediaTrackSettings & { focusMode?: string; zoom?: number; torch?: boolean; facingMode?: string };
  return { deviceLabel: track.label.slice(0, 60), width: settings.width ?? 0, height: settings.height ?? 0, exposureLocked, focusMode: settings.focusMode ?? null, torch: Boolean(settings.torch), zoom: settings.zoom ?? null, facing: settings.facingMode ?? null };
}

/** Non-identifying device summary for the capture manifest (no fingerprinting: no fonts, canvas hashes or exact models). */
export function deviceSummary(): { platform: "ios" | "android" | "other"; browser: "safari" | "chrome" | "firefox" | "other"; motion: boolean; webgl2: boolean; screen: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";
  const browser = /CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua) ? "chrome" : /Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua) ? "safari" : /Firefox|FxiOS/i.test(ua) ? "firefox" : "other";
  let webgl2 = false;
  try {
    webgl2 = typeof document !== "undefined" && Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {}
  return { platform, browser, motion: typeof DeviceOrientationEvent !== "undefined", webgl2, screen: typeof window !== "undefined" ? `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}` : "" };
}

/**
 * Grabs a full-resolution still from the live track. Prefers ImageCapture
 * (Android Chrome: real sensor-resolution JPEG with EXIF) and falls back to
 * drawing the video element (Safari). Returns the JPEG blob and its size.
 */
export async function grabStill(track: MediaStreamTrack, video: HTMLVideoElement, quality = 0.92): Promise<{ blob: Blob; width: number; height: number; source: "image_capture" | "video_frame" }> {
  const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto(opts?: Record<string, unknown>): Promise<Blob> } }).ImageCapture;
  if (ImageCaptureCtor) {
    try {
      const capture = new ImageCaptureCtor(track);
      const blob = await capture.takePhoto();
      if (blob.type === "image/jpeg" && blob.size > 1024) {
        const dims = await imageDimensions(blob);
        if (dims) return { blob, ...dims, source: "image_capture" };
      }
    } catch {
      // takePhoto is flaky on some devices; fall through to the video frame.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", quality));
  canvas.width = canvas.height = 0;
  return { blob, width: video.videoWidth, height: video.videoHeight, source: "video_frame" };
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

/** Small preview + grayscale for quality checks from the live video, cheap enough for every capture. */
export function previewAndGray(video: HTMLVideoElement, thumbWidth = 192, graySize = 96): { thumbnail: Promise<Blob>; rgba: Uint8ClampedArray; graySize: number } {
  const thumb = document.createElement("canvas");
  const aspect = video.videoHeight / Math.max(1, video.videoWidth);
  thumb.width = thumbWidth;
  thumb.height = Math.max(1, Math.round(thumbWidth * aspect));
  const tctx = thumb.getContext("2d", { alpha: false })!;
  tctx.drawImage(video, 0, 0, thumb.width, thumb.height);
  const small = document.createElement("canvas");
  small.width = graySize;
  small.height = graySize;
  const sctx = small.getContext("2d", { alpha: false, willReadFrequently: true })!;
  sctx.drawImage(thumb, 0, 0, graySize, graySize);
  const rgba = sctx.getImageData(0, 0, graySize, graySize).data;
  const thumbnail = new Promise<Blob>((resolve, reject) => thumb.toBlob((b) => (b ? resolve(b) : reject(new Error("thumbnail failed"))), "image/jpeg", 0.7));
  return { thumbnail, rgba, graySize };
}

import { normalizeDegrees } from "./plan";

/**
 * Port of `OrientationTracker` onto the DeviceOrientation API. Reports the
 * phone's look direction as yaw (0–360, compass-like) and elevation (degrees
 * above the horizon) for a phone held upright in portrait. iOS needs an
 * explicit permission call from a user gesture; Android/Chrome just fires.
 */
export type Orientation = { yaw: number; elevation: number; absolute: boolean; t: number };
export type OrientationStatus = "unsupported" | "denied" | "ok";

type DOEventCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
type DOEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

export async function requestOrientationPermission(): Promise<OrientationStatus> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return "unsupported";
  const ctor = DeviceOrientationEvent as DOEventCtor;
  if (typeof ctor.requestPermission === "function") {
    try {
      const r = await ctor.requestPermission();
      return r === "granted" ? "ok" : "denied";
    } catch {
      return "denied";
    }
  }
  return "ok";
}

export function subscribeOrientation(onReading: (o: Orientation) => void): () => void {
  const handler = (e: Event) => {
    const ev = e as DOEvent;
    if (ev.alpha == null || ev.beta == null) return;
    // iOS exposes a true compass heading; elsewhere alpha counts counter-clockwise from north.
    const yaw = ev.webkitCompassHeading != null ? ev.webkitCompassHeading : normalizeDegrees(360 - ev.alpha);
    // beta is 90 when the phone stands upright; above that the camera tilts up.
    const elevation = Math.max(-90, Math.min(90, ev.beta - 90));
    onReading({ yaw, elevation, absolute: !!ev.absolute || ev.webkitCompassHeading != null, t: performance.now() });
  };
  const abs = "ondeviceorientationabsolute" in window;
  const type = abs ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(type, handler as EventListener, { passive: true });
  return () => window.removeEventListener(type, handler as EventListener);
}

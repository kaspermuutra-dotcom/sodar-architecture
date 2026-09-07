"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { angularSpeed, normalizeOrientation, OrientationFilter, type Orientation } from "@/lib/scanner/sphere";

export type MotionState = "unknown" | "granted" | "denied" | "unavailable";

/**
 * Device orientation with permission handling (iOS needs a user gesture),
 * outlier filtering and angular speed. `available` becomes false when no
 * event arrives within 1.5 s of listening, which switches the scanner to the
 * manual-capture fallback.
 */
export function useOrientation(active: boolean) {
  const [orientation, setOrientation] = useState<Orientation>();
  const [motion, setMotion] = useState<MotionState>("unknown");
  const [speed, setSpeed] = useState(0);
  const filter = useRef(new OrientationFilter());
  const last = useRef<(Orientation & { t: number }) | undefined>(undefined);
  const latest = useRef<Orientation | undefined>(undefined);
  const latestSpeed = useRef(0);

  const requestPermission = useCallback(async (): Promise<MotionState> => {
    const ctor = typeof DeviceOrientationEvent !== "undefined" ? (DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }) : undefined;
    if (!ctor) {
      setMotion("unavailable");
      return "unavailable";
    }
    if (!ctor.requestPermission) {
      setMotion("granted");
      return "granted";
    }
    try {
      const result = await ctor.requestPermission();
      const state: MotionState = result === "granted" ? "granted" : "denied";
      setMotion(state);
      return state;
    } catch {
      setMotion("denied");
      return "denied";
    }
  }, []);

  useEffect(() => {
    if (!active || motion === "denied") return;
    let seen = false;
    const onEvent = (event: DeviceOrientationEvent) => {
      const raw = normalizeOrientation({ alpha: event.alpha, beta: event.beta, gamma: event.gamma, webkitCompassHeading: (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading, absolute: event.absolute });
      if (!raw) return;
      seen = true;
      const next = filter.current.update(raw);
      const now = performance.now();
      if (last.current) {
        const s = angularSpeed(last.current, { ...next, t: now });
        latestSpeed.current = s;
        setSpeed((prev) => prev * 0.6 + s * 0.4);
      }
      last.current = { ...next, t: now };
      latest.current = next;
      setOrientation(next);
    };
    window.addEventListener("deviceorientation", onEvent, true);
    const probe = window.setTimeout(() => {
      if (!seen) setMotion((prev) => (prev === "granted" || prev === "unknown" ? "unavailable" : prev));
      else setMotion("granted");
    }, 1500);
    return () => {
      window.removeEventListener("deviceorientation", onEvent, true);
      window.clearTimeout(probe);
    };
  }, [active, motion]);

  const reset = useCallback(() => {
    filter.current.reset();
    last.current = undefined;
  }, []);

  return { orientation, motion, speed, requestPermission, reset, latest, latestSpeed };
}

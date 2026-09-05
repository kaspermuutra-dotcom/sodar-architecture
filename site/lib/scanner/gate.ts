/**
 * Port of `AlignmentGate`: the shutter fires once the camera has stayed within
 * `thresholdDegrees` of the target for `dwellMillis`. Web sensors are noisier
 * than Android's rotation vector, so the default threshold is wider.
 */
export type GateReading = { dwellProgress: number; isAligned: boolean; isTriggered: boolean };

export class AlignmentGate {
  private alignedSince: number | null = null;
  constructor(private thresholdDegrees = 4, private dwellMillis = 350) {}

  update(distanceDegrees: number, now: number): GateReading {
    if (Number.isNaN(distanceDegrees) || distanceDegrees > this.thresholdDegrees) {
      this.alignedSince = null;
      return { dwellProgress: 0, isAligned: false, isTriggered: false };
    }
    if (this.alignedSince === null) this.alignedSince = now;
    const held = now - this.alignedSince;
    const progress = this.dwellMillis <= 0 ? 1 : Math.min(1, held / this.dwellMillis);
    const triggered = held >= this.dwellMillis;
    if (triggered) this.alignedSince = null;
    return { dwellProgress: progress, isAligned: true, isTriggered: triggered };
  }

  reset() {
    this.alignedSince = null;
  }
}

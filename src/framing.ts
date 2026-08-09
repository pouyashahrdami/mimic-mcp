/**
 * Measure WHERE the subject is, so cover-cropping and punch-ins aim at it.
 *
 * A 16:9 clip in a 9:16 frame loses two thirds of its width, and both
 * `backgroundPosition` and `zoom.focusX/focusY` default to the middle — which
 * is exactly wrong for the common shots (someone off-centre, a screen recording
 * whose action sits in one corner). This finds the subject the same way the
 * rest of the analysis works: from the pixels, not from a guess.
 *
 * Pure — takes decoded gray rasters, returns numbers.
 */

export interface EnergyProfile {
  /** Energy summed per column, left to right. */
  columns: number[];
  /** Energy summed per row, top to bottom. */
  rows: number[];
}

export interface Axis {
  /** Where the subject sits on this axis, 0..1. */
  center: number;
  /** Share of the energy clustered around that point — how sure we are. */
  concentration: number;
}

export interface Framing {
  focusX: number;
  focusY: number;
  /** 0..1. Low means the frame has no clear subject; keep the centre. */
  confidence: number;
  /** What the energy came from — motion when the shot has any, else detail. */
  basis: "motion" | "detail";
}

/** Mean per-pixel change below this reads as noise, not a moving subject. */
const MOTION_FLOOR = 1.2;
/** Ignore anything dimmer than this share of the peak when locating the subject. */
const PEAK_GATE = 0.25;
/** Energy within this distance of the centre counts as "clustered there". */
const CONCENTRATION_BAND = 0.15;
/** Below this confidence, aiming at the measurement is worse than centring. */
export const MIN_USABLE_CONFIDENCE = 0.35;

/**
 * Where a moving subject sits: accumulated frame-to-frame change, binned per
 * column and row. Motion is the strongest available subject cue without a model.
 */
export function motionProfile(
  frames: Uint8Array[],
  width: number,
  height: number
): EnergyProfile {
  const columns = new Array<number>(width).fill(0);
  const rows = new Array<number>(height).fill(0);

  for (let f = 1; f < frames.length; f++) {
    const prev = frames[f - 1];
    const curr = frames[f];
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const diff = Math.abs(curr[rowOffset + x] - prev[rowOffset + x]);
        columns[x] += diff;
        rows[y] += diff;
      }
    }
  }

  return { columns, rows };
}

/**
 * Where the detail is in a single frame — the fallback for a locked-off shot
 * with nothing moving, where sharp edges still mark the subject against a
 * flat or blurred background.
 */
export function detailProfile(
  frame: Uint8Array,
  width: number,
  height: number
): EnergyProfile {
  const columns = new Array<number>(width).fill(0);
  const rows = new Array<number>(height).fill(0);

  for (let y = 0; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width - 1; x++) {
      const here = frame[rowOffset + x];
      const gradient =
        Math.abs(frame[rowOffset + x + 1] - here) +
        Math.abs(frame[rowOffset + width + x] - here);
      columns[x] += gradient;
      rows[y] += gradient;
    }
  }

  return { columns, rows };
}

/**
 * The subject's position along one axis. The floor is subtracted first so an
 * even background can't drag the answer toward the middle, then everything
 * below a share of the peak is discarded so the result follows the subject
 * rather than the average of the whole frame.
 */
export function profileCentroid(values: number[]): Axis {
  if (values.length === 0) return { center: 0.5, concentration: 0 };

  const floor = Math.min(...values);
  const lifted = values.map((v) => v - floor);
  const peak = Math.max(...lifted);
  if (peak <= 0) return { center: 0.5, concentration: 0 };

  const gate = peak * PEAK_GATE;
  const weights = lifted.map((v) => (v >= gate ? v : 0));
  const total = weights.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return { center: 0.5, concentration: 0 };

  const positionOf = (i: number): number => (i + 0.5) / values.length;

  let weighted = 0;
  for (let i = 0; i < weights.length; i++) weighted += weights[i] * positionOf(i);
  const center = weighted / total;

  let near = 0;
  for (let i = 0; i < weights.length; i++) {
    if (Math.abs(positionOf(i) - center) <= CONCENTRATION_BAND) near += weights[i];
  }

  return { center, concentration: near / total };
}

/** Mean absolute change per pixel per frame pair — is anything moving at all? */
function meanMotion(profile: EnergyProfile, frameCount: number, pixels: number): number {
  if (frameCount < 2) return 0;
  const total = profile.columns.reduce((sum, v) => sum + v, 0);
  return total / (pixels * (frameCount - 1));
}

export function suggestFraming(
  frames: Uint8Array[],
  width: number,
  height: number
): Framing {
  if (frames.length === 0) {
    throw new Error("no frames decoded — the clip range is empty or unreadable");
  }

  const motion = motionProfile(frames, width, height);
  const moving = meanMotion(motion, frames.length, width * height) >= MOTION_FLOOR;
  const profile = moving
    ? motion
    : detailProfile(frames[Math.floor(frames.length / 2)], width, height);

  const x = profileCentroid(profile.columns);
  const y = profileCentroid(profile.rows);

  return {
    focusX: Math.round(x.center * 1000) / 1000,
    focusY: Math.round(y.center * 1000) / 1000,
    // Both axes have to be believable; a subject pinned horizontally but
    // smeared vertically is not something to aim a crop at.
    confidence: Math.round(Math.min(x.concentration, y.concentration) * 100) / 100,
    basis: moving ? "motion" : "detail",
  };
}

/** The recipe's `backgroundPosition` for a framing, or null when it's a guess. */
export function toBackgroundPosition(framing: Framing): string | null {
  if (framing.confidence < MIN_USABLE_CONFIDENCE) return null;
  return `${Math.round(framing.focusX * 100)}% ${Math.round(framing.focusY * 100)}%`;
}

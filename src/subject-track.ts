/**
 * Follow a moving subject across a shot, instead of aiming at where it was.
 *
 * `framing.ts` measures one position for a whole span, which is right for a
 * locked-off shot and wrong the moment anyone walks: cropping 16:9 to 9:16
 * throws away two thirds of the width, so a subject that drifts leaves frame
 * and stays out. This measures the position per window and turns the series
 * into keyframes the renderer can interpolate.
 *
 * The raw per-window measurements are too noisy to use directly — a centroid
 * wobbles a few percent frame to frame even on a still subject, and a crop that
 * follows that wobble looks worse than one that never moves. So the series is
 * gap-filled, smoothed, and speed-limited, and a shot whose subject barely
 * moves is reported as static rather than given a track that only jitters.
 *
 * Pure: takes measured positions, returns keyframes.
 */

export interface TrackPoint {
  /** Seconds from the start of the shot. */
  atSeconds: number;
  x: number;
  y: number;
  /** 0..1 from the framing measurement; low means "no clear subject here". */
  confidence: number;
}

export interface Keyframe {
  atSeconds: number;
  x: number;
  y: number;
}

/** Below this a window's measurement is noise and gets filled from its neighbours. */
export const MIN_TRACK_CONFIDENCE = 0.3;

/**
 * How fast the crop may travel, in frame-widths per second. A real subject
 * crossing frame takes a beat; anything faster is the measurement jumping
 * between two candidates, and following it reads as a camera whip.
 */
const MAX_UNITS_PER_SECOND = 0.35;

/** Window count for the moving average. Odd, so it stays centred. */
const SMOOTHING_WINDOW = 3;

/**
 * Total travel below this is a subject that never really moved — emit a static
 * position instead of a track, so the crop holds still.
 */
const STATIC_RANGE = 0.06;

/**
 * Replace unusable measurements with the nearest usable one. Holding the last
 * known position is what a camera operator does when they lose the subject;
 * interpolating across the gap would invent a movement nobody made.
 */
export function fillGaps(points: TrackPoint[]): TrackPoint[] {
  const usable = points.filter((p) => p.confidence >= MIN_TRACK_CONFIDENCE);
  if (usable.length === 0) return [];

  return points.map((point) => {
    if (point.confidence >= MIN_TRACK_CONFIDENCE) return point;
    // Nearest usable in time, preferring the one before (hold, don't predict).
    const nearest = usable.reduce((best, candidate) => {
      const dBest = Math.abs(best.atSeconds - point.atSeconds);
      const dCandidate = Math.abs(candidate.atSeconds - point.atSeconds);
      return dCandidate < dBest ? candidate : best;
    });
    return { ...point, x: nearest.x, y: nearest.y };
  });
}

/** Centred moving average — takes the wobble out without lagging the subject. */
export function smooth(points: TrackPoint[], window = SMOOTHING_WINDOW): Keyframe[] {
  const half = Math.floor(window / 2);
  return points.map((point, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(points.length, i + half + 1);
    const slice = points.slice(from, to);
    return {
      atSeconds: point.atSeconds,
      x: Math.round((slice.reduce((s, p) => s + p.x, 0) / slice.length) * 1000) / 1000,
      y: Math.round((slice.reduce((s, p) => s + p.y, 0) / slice.length) * 1000) / 1000,
    };
  });
}

/** Cap how far the crop can travel between keyframes. */
export function limitSpeed(
  keys: Keyframe[],
  maxUnitsPerSecond = MAX_UNITS_PER_SECOND
): Keyframe[] {
  if (keys.length === 0) return [];

  const limited: Keyframe[] = [keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const previous = limited[i - 1];
    const dt = Math.max(1e-6, keys[i].atSeconds - previous.atSeconds);
    const budget = maxUnitsPerSecond * dt;
    const clamp = (from: number, to: number): number => {
      const delta = to - from;
      if (Math.abs(delta) <= budget) return to;
      return Math.round((from + Math.sign(delta) * budget) * 1000) / 1000;
    };
    limited.push({
      atSeconds: keys[i].atSeconds,
      x: clamp(previous.x, keys[i].x),
      y: clamp(previous.y, keys[i].y),
    });
  }
  return limited;
}

function range(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

export interface TrackResult {
  /** Keyframes to interpolate, or null when the subject never really moved. */
  track: Keyframe[] | null;
  /** The single position to use instead, when `track` is null. */
  staticPosition: { x: number; y: number } | null;
  /** How far the subject travelled, in frame-widths/heights. */
  travelX: number;
  travelY: number;
  reason: string;
}

/**
 * Turn per-window framing measurements into something the recipe can use:
 * either a track worth following, or the one position to hold.
 */
export function buildTrack(points: TrackPoint[]): TrackResult {
  const filled = fillGaps(points);
  if (filled.length === 0) {
    return {
      track: null,
      staticPosition: null,
      travelX: 0,
      travelY: 0,
      reason:
        "No window in this shot had a clear subject — leave the crop centred rather than " +
        "aiming it at a guess.",
    };
  }

  const keys = limitSpeed(smooth(filled));
  const travelX = Math.round(range(keys.map((k) => k.x)) * 1000) / 1000;
  const travelY = Math.round(range(keys.map((k) => k.y)) * 1000) / 1000;

  if (keys.length < 2 || (travelX < STATIC_RANGE && travelY < STATIC_RANGE)) {
    const mean = (values: number[]): number =>
      Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000;
    return {
      track: null,
      staticPosition: { x: mean(keys.map((k) => k.x)), y: mean(keys.map((k) => k.y)) },
      travelX,
      travelY,
      reason:
        `The subject moved ${Math.max(travelX, travelY)} of a frame — below the ${STATIC_RANGE} ` +
        "worth following. A crop that chases a still subject only jitters, so hold this position.",
    };
  }

  return {
    track: keys,
    staticPosition: null,
    travelX,
    travelY,
    reason: `The subject travelled ${travelX} across and ${travelY} down the frame — worth following.`,
  };
}

/**
 * Where the crop should sit at `atSeconds`. Mirrored in the Remotion template,
 * which needs the same curve at render time; tested here.
 */
export function positionAt(track: Keyframe[], atSeconds: number): { x: number; y: number } {
  if (track.length === 0) return { x: 0.5, y: 0.5 };
  if (atSeconds <= track[0].atSeconds) return { x: track[0].x, y: track[0].y };

  const last = track[track.length - 1];
  if (atSeconds >= last.atSeconds) return { x: last.x, y: last.y };

  for (let i = 1; i < track.length; i++) {
    const b = track[i];
    if (atSeconds > b.atSeconds) continue;
    const a = track[i - 1];
    const span = b.atSeconds - a.atSeconds;
    const t = span <= 0 ? 0 : (atSeconds - a.atSeconds) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  return { x: last.x, y: last.y };
}

/** The recipe's `backgroundPosition` string for a point. */
export function toPositionString(point: { x: number; y: number }): string {
  return `${Math.round(point.x * 100)}% ${Math.round(point.y * 100)}%`;
}

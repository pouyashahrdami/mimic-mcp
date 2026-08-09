/**
 * Pure helpers for ffmpeg's two-pass `loudnorm`. Pass 1 measures the render and
 * prints JSON; pass 2 is handed those measurements and does a linear gain move
 * to the target. Parsing and filter-building live here so they're testable
 * without shelling out; `src/ffmpeg.ts` owns the actual passes.
 */

/** What every social platform normalizes to, so mixing to it avoids their re-gain. */
export const TARGET_LUFS = -14;
/** True-peak ceiling: -1 dBTP leaves headroom for lossy-codec overshoot. */
const TARGET_TRUE_PEAK = -1;
const TARGET_LRA = 11;

/** Below this, the audio is silence or near-silence and there's nothing to normalize. */
const SILENCE_LUFS = -70;

export interface LoudnessMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/**
 * Pull the measurement JSON out of pass 1's stderr. ffmpeg prints it after all
 * the usual banner noise, so we take the last balanced {...} block.
 */
export function parseLoudnorm(stderr: string): LoudnessMeasurement {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("loudnorm pass 1 printed no measurement JSON");
  }

  let raw: Record<string, string>;
  try {
    raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  } catch {
    throw new Error("loudnorm pass 1 printed malformed measurement JSON");
  }

  // loudnorm reports "-inf" for digital silence, which parses to -Infinity —
  // that's meaningful (it means "skip"), so it must survive parsing.
  const num = (key: string): number => {
    const value = raw[key];
    if (value == null) throw new Error(`loudnorm measurement is missing ${key}`);
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return value.trim().startsWith("-") ? -Infinity : Infinity;
    }
    return parsed;
  };

  return {
    inputI: num("input_i"),
    inputTp: num("input_tp"),
    inputLra: num("input_lra"),
    inputThresh: num("input_thresh"),
    targetOffset: num("target_offset"),
  };
}

/**
 * Whether normalizing this measurement is meaningful. A silent reel has nothing
 * to raise, and pushing digital silence toward -14 LUFS would only amplify
 * whatever dither noise is there.
 */
export function isNormalizable(measurement: LoudnessMeasurement): boolean {
  return Number.isFinite(measurement.inputI) && measurement.inputI > SILENCE_LUFS;
}

/** Pass 1: measure only, discarding output. */
export function measureFilter(): string {
  return `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=${TARGET_LRA}:print_format=json`;
}

/** Pass 2: apply, using pass 1's numbers so the move is a single linear gain. */
export function applyFilter(
  measurement: LoudnessMeasurement,
  targetLufs: number = TARGET_LUFS
): string {
  return [
    `loudnorm=I=${targetLufs}`,
    `TP=${TARGET_TRUE_PEAK}`,
    `LRA=${TARGET_LRA}`,
    `measured_I=${measurement.inputI}`,
    `measured_TP=${measurement.inputTp}`,
    `measured_LRA=${measurement.inputLra}`,
    `measured_thresh=${measurement.inputThresh}`,
    `offset=${measurement.targetOffset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");
}

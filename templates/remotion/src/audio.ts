/**
 * Pure audio-mixing math, kept out of the components so it can be tested
 * without rendering a frame. Remotion asks for a gain per frame; everything
 * here answers that question.
 */

/** How long the music takes to drop under (and climb back out of) narration. */
const DUCK_RAMP_SECONDS = 0.4;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

export interface DuckWindow {
  startFrame: number;
  endFrame: number;
  /** Gain multiplier while fully ducked. */
  to: number;
}

export interface MusicGainParams {
  frame: number;
  fps: number;
  /** Length of the whole reel, so the fade-out lands on its final frames. */
  durationInFrames: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  duck?: DuckWindow;
}

/**
 * Music gain at a given frame: base volume, shaped by the fades, then pulled
 * down under any narration. The duck ramps in BEFORE the voice starts and out
 * after it stops — dropping the bed instantly on the first syllable is the
 * thing that sounds like a machine did it.
 */
export function musicGain({
  frame,
  fps,
  durationInFrames,
  volume,
  fadeInSeconds,
  fadeOutSeconds,
  duck,
}: MusicGainParams): number {
  let gain = volume;

  if (fadeInSeconds > 0) {
    gain *= clamp01(frame / (fadeInSeconds * fps));
  }
  if (fadeOutSeconds > 0) {
    // Clamped, so this is 1 until the fade-out window actually begins.
    gain *= clamp01((durationInFrames - frame) / (fadeOutSeconds * fps));
  }

  if (duck) {
    const ramp = Math.max(1, Math.round(DUCK_RAMP_SECONDS * fps));
    const enter = clamp01((frame - (duck.startFrame - ramp)) / ramp);
    const exit = clamp01((duck.endFrame + ramp - frame) / ramp);
    const amount = Math.min(enter, exit);
    gain *= 1 + (duck.to - 1) * amount;
  }

  return clamp01(gain);
}

/**
 * The frame window the music should duck under, or undefined when there's
 * nothing to duck for. An open-ended voiceover (no measured duration) ducks
 * through to the end of the reel rather than guessing where the voice stops.
 */
export function duckWindow(
  voiceover: { startSeconds: number; durationSeconds?: number } | undefined,
  music: { duckUnderVoiceover: boolean; duckTo: number } | undefined,
  fps: number,
  durationInFrames: number
): DuckWindow | undefined {
  if (!voiceover || !music || !music.duckUnderVoiceover) return undefined;
  return {
    startFrame: Math.round(voiceover.startSeconds * fps),
    endFrame:
      voiceover.durationSeconds != null
        ? Math.round((voiceover.startSeconds + voiceover.durationSeconds) * fps)
        : durationInFrames,
    to: music.duckTo,
  };
}

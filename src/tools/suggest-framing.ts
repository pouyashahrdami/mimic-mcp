import { decodeGrayFrames, probe } from "../ffmpeg.js";
import {
  suggestFraming,
  toBackgroundPosition,
  MIN_USABLE_CONFIDENCE,
  type Framing,
} from "../framing.js";
import { mapLimit } from "../parallel.js";

/** Small enough to be fast, big enough to place a subject to a few percent. */
const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 64;
const ANALYSIS_FPS = 6;

export interface FramingSuggestion extends Framing {
  start: number;
  end: number;
  /** Ready to paste into the segment, or null when the measurement is weak. */
  backgroundPosition: string | null;
}

/**
 * Measure each span's framing. Shared by the tool and by draft_recipe, so a
 * drafted reel arrives already aimed at the subject.
 */
export async function measureFramingSpans(
  video: string,
  spans?: { start: number; end: number }[]
): Promise<FramingSuggestion[]> {
  const info = await probe(video);
  const ranges =
    spans && spans.length > 0 ? spans : [{ start: 0, end: info.videoSeconds }];

  for (const [i, span] of ranges.entries()) {
    if (span.end <= span.start) {
      throw new Error(`span ${i}: end (${span.end}) must be after start (${span.start})`);
    }
    if (span.start < 0 || span.end > info.videoSeconds + 0.5) {
      throw new Error(
        `span ${i}: ${span.start}..${span.end}s is outside the footage, which runs ` +
          `0..${Math.round(info.videoSeconds * 100) / 100}s`
      );
    }
  }

  return mapLimit(ranges, 3, async (span) => {
    const { frames } = await decodeGrayFrames(video, {
      width: ANALYSIS_WIDTH,
      height: ANALYSIS_HEIGHT,
      fps: ANALYSIS_FPS,
      start: span.start,
      duration: span.end - span.start,
    });
    const framing = suggestFraming(frames, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    return {
      ...framing,
      start: span.start,
      end: span.end,
      backgroundPosition: toBackgroundPosition(framing),
    } satisfies FramingSuggestion;
  });
}

/**
 * Measure where the subject sits, per span of footage, so cover-cropping and
 * punch-ins can aim at it. Without this both default to the middle of the
 * frame, which throws away the subject on any shot that isn't centred.
 */
export async function suggestFramingTool(
  video: string,
  spans?: { start: number; end: number }[]
): Promise<{ suggestions: FramingSuggestion[]; instructions: string }> {
  const suggestions = await measureFramingSpans(video, spans);

  const weak = suggestions.filter((s) => s.backgroundPosition === null).length;
  const detailOnly = suggestions.filter((s) => s.basis === "detail").length;

  return {
    suggestions,
    instructions:
      "Set each segment's `backgroundPosition` from its span so cover-cropping keeps " +
      "the subject in frame, and reuse focusX/focusY for that segment's `zoom` so a " +
      "punch-in moves toward the subject instead of the middle. " +
      (weak > 0
        ? `${weak} span(s) had no clear subject (confidence below ${MIN_USABLE_CONFIDENCE}) ` +
          "and returned a null position — leave those centred. "
        : "Every span had a clear subject. ") +
      (detailOnly > 0
        ? `${detailOnly} span(s) are locked-off shots measured by edge detail rather than ` +
          "motion, which a busy or textured BACKGROUND can dominate — check those frames " +
          "before trusting the position."
        : ""),
  };
}

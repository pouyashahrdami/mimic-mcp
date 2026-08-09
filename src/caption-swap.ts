/**
 * Replace a segment's caption and invalidate what depended on the old one.
 *
 * Two fields are indexed against the exact words that were there:
 * `wordTimings` (one offset per word, driving karaoke) and `emphasisWords`
 * (indices of words to paint). Swap the text and both silently point at the
 * wrong words — karaoke highlights whatever now occupies position 3, and a
 * stale emphasis index either paints the wrong word or fails validation.
 *
 * Shared by localization and hook variants, which are both "same reel,
 * different words" and hit this identically.
 *
 * Pure: takes a segment, returns a new one.
 */

import type { Recipe } from "./recipe.js";

type Segment = Recipe["segments"][number];

export function countWords(caption: string): number {
  return caption.trim().split(/\s+/).filter(Boolean).length;
}

export interface CaptionSwap {
  segment: Segment;
  /** The segment used karaoke and had to give it up. */
  lostKaraoke: boolean;
  /** Emphasis indices pointed past the new caption and were cleared. */
  droppedEmphasis: boolean;
}

export function swapCaption(
  segment: Segment,
  caption: string,
  wordTimings?: number[]
): CaptionSwap {
  const next = { ...segment, caption };
  const words = countWords(caption);

  let lostKaraoke = false;
  if (wordTimings && wordTimings.length === words) {
    next.wordTimings = wordTimings;
  } else if (segment.wordTimings) {
    delete next.wordTimings;
    lostKaraoke = segment.captionAnimation === "karaoke";
  }

  let droppedEmphasis = false;
  if (segment.emphasisWords && segment.emphasisWords.some((w) => w >= words)) {
    delete next.emphasisWords;
    droppedEmphasis = true;
  }

  return { segment: next, lostKaraoke, droppedEmphasis };
}

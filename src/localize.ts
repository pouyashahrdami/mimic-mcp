/**
 * Put the same reel out in another language.
 *
 * The translation itself comes from the agent — this owns the part that gets
 * silently wrong if you just swap the strings:
 *
 * - `wordTimings` are per-word offsets into a specific sentence. Translate the
 *   sentence and the word count changes, so karaoke highlights the wrong words
 *   for the rest of the segment. They have to be dropped, not carried.
 * - `emphasisWords` are indices into the caption. Same problem, and a stale
 *   index either paints the wrong word or fails validation.
 * - Languages are not the same length. German runs ~30% longer than English,
 *   so a caption that read comfortably now flashes past — which is measurable,
 *   and worth saying out loud rather than discovering on the render.
 *
 * Pure: takes a recipe and translated lines, returns a new recipe.
 */

import { countWords, swapCaption } from "./caption-swap.js";
import type { Recipe } from "./recipe.js";

export interface Translation {
  /** BCP-47 tag, e.g. "de" or "pt-BR". Used to name the outputs. */
  language: string;
  /** One line per segment, in order. Empty string keeps a segment captionless. */
  captions: string[];
  /**
   * Optional per-segment word offsets for the translated text. Supply these
   * (from transcribing a translated voiceover) to keep karaoke; without them
   * karaoke degrades to a plain caption rather than highlighting wrong words.
   */
  wordTimings?: (number[] | undefined)[];
}

export interface LocalizedRecipe {
  recipe: Recipe;
  notes: string[];
}

export function localizeRecipe(recipe: Recipe, translation: Translation): LocalizedRecipe {
  const { language, captions, wordTimings } = translation;

  if (!language.trim()) throw new Error("translation needs a language tag, e.g. \"de\"");
  if (captions.length !== recipe.segments.length) {
    throw new Error(
      `got ${captions.length} translated caption(s) for ${recipe.segments.length} segment(s) — ` +
        "pass one line per segment, in order, using an empty string for a segment that " +
        "should stay captionless"
    );
  }

  const notes: string[] = [];
  let lostKaraoke = 0;
  let droppedEmphasis = 0;
  let grew = 0;

  const segments = recipe.segments.map((segment, i) => {
    const caption = captions[i];
    const swapped = swapCaption(segment, caption, wordTimings?.[i]);
    if (swapped.lostKaraoke) lostKaraoke++;
    if (swapped.droppedEmphasis) droppedEmphasis++;

    const before = countWords(segment.caption);
    if (before > 0 && countWords(caption) > before * 1.25) grew++;

    return swapped.segment;
  });

  if (lostKaraoke > 0) {
    notes.push(
      `${lostKaraoke} segment(s) used karaoke and lost their word timings — translated text ` +
        "has a different word count, so the old offsets would highlight the wrong words. " +
        "They render as plain captions. Pass `word_timings` (transcribe a translated " +
        "voiceover) to keep karaoke."
    );
  }
  if (droppedEmphasis > 0) {
    notes.push(
      `${droppedEmphasis} segment(s) had emphasisWords pointing past the translated caption; ` +
        "they were cleared. Re-pick the words to emphasise in the new language."
    );
  }
  if (grew > 0) {
    notes.push(
      `${grew} caption(s) are more than 25% longer than the original. Segment timing did not ` +
        "change, so those now read faster — run critique_reel on this recipe before rendering."
    );
  }

  return { recipe: { ...recipe, segments }, notes };
}

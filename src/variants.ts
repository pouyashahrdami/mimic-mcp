/**
 * Same reel, different openings.
 *
 * The thing creators actually A/B is the first second and a half — the body
 * rarely changes between tests. Rebuilding a whole reel per hook is the wrong
 * shape twice over: it wastes a full render on frames that are byte-identical,
 * and it makes the variants differ in more than the one thing under test.
 *
 * So a variant is the same recipe with only its opening caption(s) replaced,
 * and it reports exactly which segments changed — which `render_reel` takes as
 * its `segments` argument, so a variant costs one segment instead of a reel.
 *
 * Pure: takes a recipe and hooks, returns recipes.
 */

import { swapCaption } from "./caption-swap.js";
import type { Recipe } from "./recipe.js";

export interface Variant {
  /** Filename-safe identifier: "hook-1", or a slug of the label. */
  id: string;
  /** The hook text this variant opens with. */
  hook: string;
  recipe: Recipe;
  /** Segment indices that differ from the original — pass to render_reel. */
  changedSegments: number[];
  notes: string[];
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

export interface VariantOptions {
  /**
   * Which segments the hook occupies. Defaults to the first — a hook spanning
   * two segments is replaced across both, with the same text on each.
   */
  segments?: number[];
  /** Use the hook text itself for the variant id instead of a number. */
  labelFromText?: boolean;
}

export function buildHookVariants(
  recipe: Recipe,
  hooks: string[],
  { segments = [0], labelFromText = false }: VariantOptions = {}
): Variant[] {
  if (hooks.length === 0) throw new Error("no hooks given — pass at least one alternative opening");

  const unique = new Set(segments);
  for (const index of unique) {
    if (!Number.isInteger(index) || index < 0 || index >= recipe.segments.length) {
      throw new Error(
        `segment ${index} is outside this reel, which has ${recipe.segments.length} segment(s)`
      );
    }
  }
  const targets = [...unique].sort((a, b) => a - b);

  return hooks.map((hook, i) => {
    const notes: string[] = [];
    let lostKaraoke = 0;

    const newSegments = recipe.segments.map((segment, index) => {
      if (!unique.has(index)) return segment;
      const swapped = swapCaption(segment, hook);
      if (swapped.lostKaraoke) lostKaraoke++;
      return swapped.segment;
    });

    if (lostKaraoke > 0) {
      notes.push(
        `${lostKaraoke} hook segment(s) used karaoke; their word timings were dropped because ` +
          "the new hook has a different word count. Re-time them if you keep this variant."
      );
    }

    return {
      id: labelFromText ? slugify(hook, `hook-${i + 1}`) : `hook-${i + 1}`,
      hook,
      recipe: { ...recipe, segments: newSegments },
      changedSegments: targets,
      notes,
    };
  });
}

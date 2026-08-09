/**
 * The marks that make a reel yours, kept across every reel.
 *
 * A preset carries the *look* of one reference — pacing, caption styles,
 * transitions. A brand kit carries the things that shouldn't change when you
 * copy a new reference at all: your logo, your handle, your type, your colors.
 * They compose: copy anyone's pacing, keep your face on it.
 *
 * Merging is additive and idempotent by default — applying a kit twice leaves
 * one logo, not two — and never overwrites a choice the recipe made on purpose
 * unless asked, because the recipe is the specific decision and the kit is the
 * standing one.
 *
 * Pure: takes a recipe and a kit, returns a new recipe.
 */

import { z } from "zod";
import { overlaySchema, type Recipe } from "./recipe.js";

export const brandKitSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  overlays: z
    .array(overlaySchema)
    .optional()
    .describe("Logo bug, handle, progress bar — added to every reel this kit is applied to."),
  caption: z
    .object({
      captionFont: z.string().optional(),
      captionColor: z.string().optional(),
      captionWeight: z.number().min(100).max(900).optional(),
      captionOutline: z
        .object({ color: z.string().default("#000"), widthPx: z.number().min(0).max(24).default(6) })
        .optional(),
      captionBackground: z.string().optional(),
      emphasisColor: z.string().optional(),
      highlightColor: z.string().optional(),
    })
    .optional()
    .describe("Caption defaults filled into any segment that hasn't chosen its own."),
  googleFonts: z
    .array(z.string())
    .optional()
    .describe("Families to load, so captionFont renders instead of silently falling back."),
});

export type BrandKit = z.infer<typeof brandKitSchema>;

/** What makes two overlays "the same mark", for the purpose of not doubling it. */
function overlayIdentity(overlay: NonNullable<Recipe["overlays"]>[number]): string {
  return [overlay.kind, overlay.file ?? "", overlay.text ?? "", overlay.corner].join("|");
}

export interface ApplyOptions {
  /**
   * Let the kit win over choices the recipe already made. Off by default: a
   * recipe that set a caption color set it for a reason.
   */
  overwrite?: boolean;
}

export interface AppliedKit {
  recipe: Recipe;
  /** What actually changed, so the agent can see the kit did something. */
  changes: string[];
}

export function applyBrandKit(
  recipe: Recipe,
  kit: BrandKit,
  { overwrite = false }: ApplyOptions = {}
): AppliedKit {
  const changes: string[] = [];

  const existing = recipe.overlays ?? [];
  const seen = new Set(existing.map(overlayIdentity));
  const added = (kit.overlays ?? []).filter((o) => !seen.has(overlayIdentity(o)));
  const overlays = [...existing, ...added];
  if (added.length > 0) {
    changes.push(`added ${added.length} overlay(s): ${added.map((o) => o.kind).join(", ")}`);
  }
  const alreadyThere = (kit.overlays ?? []).length - added.length;
  if (alreadyThere > 0) {
    changes.push(`${alreadyThere} overlay(s) were already on this reel and were left alone`);
  }

  const fonts = [...new Set([...(recipe.googleFonts ?? []), ...(kit.googleFonts ?? [])])];
  if (fonts.length > (recipe.googleFonts ?? []).length) {
    changes.push(`loaded font(s): ${kit.googleFonts?.join(", ")}`);
  }

  const captionDefaults = kit.caption ?? {};
  const touchedFields = new Set<string>();

  const segments = recipe.segments.map((segment) => {
    const merged = { ...segment };
    for (const [field, value] of Object.entries(captionDefaults)) {
      if (value === undefined) continue;
      const key = field as keyof typeof merged;
      if (!overwrite && merged[key] !== undefined) continue;
      // Zod's inferred segment type is a union of optionals; the kit's schema
      // guarantees each value matches its field, which the index signature
      // can't express.
      (merged as Record<string, unknown>)[field] = value;
      touchedFields.add(field);
    }
    return merged;
  });

  if (touchedFields.size > 0) {
    changes.push(
      `${overwrite ? "overwrote" : "filled in"} caption defaults: ${[...touchedFields].join(", ")}`
    );
  }

  if (changes.length === 0) {
    changes.push("nothing to apply — the reel already carries everything in this kit");
  }

  return {
    recipe: {
      ...recipe,
      segments,
      ...(overlays.length > 0 ? { overlays } : {}),
      ...(fonts.length > 0 ? { googleFonts: fonts } : {}),
    },
    changes,
  };
}

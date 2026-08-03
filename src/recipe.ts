import { z } from "zod";

/**
 * The style recipe is the contract between the two halves of the workflow:
 * the agent studies the reference reel and writes one of these; the
 * scaffolder turns it into a Remotion project without needing any further
 * judgment calls.
 */

export const segmentSchema = z.object({
  start: z.number().min(0).describe("Segment start, in seconds"),
  end: z.number().positive().describe("Segment end, in seconds"),
  caption: z.string().describe("Text shown during this segment"),
  captionStyle: z
    .enum(["hook", "tip", "plain"])
    .default("plain")
    .describe("hook = big center statement, tip = card near the bottom, plain = simple centered text"),
  image: z
    .string()
    .optional()
    .describe("Optional image (e.g. a screenshot) shown as a floating card with the caption below it"),
  transitionIn: z
    .enum(["cut", "fade", "slide"])
    .default("cut")
    .describe("How this segment's caption enters"),
});

export const recipeSchema = z.object({
  output: z.object({
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    fps: z.number().int().positive().default(30),
    durationSeconds: z.number().positive(),
  }),
  background: z.object({
    video: z.string().describe("Absolute path to the user's footage"),
    fit: z.enum(["cover", "contain"]).default("cover"),
    muted: z.boolean().default(true),
  }),
  music: z
    .object({
      file: z.string().describe("Absolute path to the soundtrack (e.g. from extract_music)"),
      volume: z.number().min(0).max(1).default(0.8),
    })
    .optional(),
  segments: z.array(segmentSchema).min(1),
});

export type Recipe = z.infer<typeof recipeSchema>;

/** Parse + sanity-check a recipe, with errors an agent can act on. */
export function parseRecipe(json: string): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("recipe is not valid JSON");
  }

  const recipe = recipeSchema.parse(raw);

  for (const [i, seg] of recipe.segments.entries()) {
    if (seg.end <= seg.start) {
      throw new Error(`segment ${i}: end (${seg.end}) must be after start (${seg.start})`);
    }
  }

  const last = recipe.segments[recipe.segments.length - 1];
  if (last.end > recipe.output.durationSeconds) {
    throw new Error(
      `last segment ends at ${last.end}s but output.durationSeconds is ${recipe.output.durationSeconds}s`
    );
  }

  return recipe;
}

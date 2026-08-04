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
  backgroundStart: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Seconds into the background video where THIS segment's footage starts. " +
        "Set different offsets per segment to cut a montage out of one long clip."
    ),
  backgroundVideo: z
    .string()
    .optional()
    .describe(
      "Absolute path to a different video for THIS segment's background. " +
        "Use to interleave multiple source clips (e.g. action shots alternating " +
        "with portrait shots). Falls back to background.video when omitted."
    ),
  backgroundPosition: z
    .string()
    .optional()
    .describe(
      "CSS object-position for this segment's background (e.g. \"50% 20%\"). " +
        "Use when cover-cropping cuts off the subject — a portrait clip in a " +
        "landscape frame crops to its middle unless you aim it."
    ),
  zoom: z
    .object({
      from: z.number().positive().default(1).describe("Starting scale (1 = no zoom)"),
      to: z.number().positive().default(1.3).describe("Ending scale (>1 = punch in, <from = pull out)"),
      focusX: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Horizontal focal point to zoom toward, 0=left … 1=right"),
      focusY: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Vertical focal point to zoom toward, 0=top … 1=bottom"),
    })
    .optional()
    .describe(
      "Animated Ken-Burns / punch-in zoom on THIS segment's background over its duration. " +
        "The classic screen-recording move: zoom into the part of the screen that matters " +
        "(set focusX/focusY to the active region). Each zoomed segment gets its own background layer."
    ),
  captionColor: z
    .string()
    .optional()
    .describe("CSS color overriding the default white caption"),
  captionSize: z
    .number()
    .positive()
    .optional()
    .describe("Font size in px overriding the caption style's default"),
  transitionIn: z
    .enum(["cut", "fade", "slide"])
    .default("cut")
    .describe("How this segment's caption enters"),
  sound: z
    .string()
    .optional()
    .describe(
      "Sound effect to play as this segment begins. Either a built-in name " +
        "(\"pop\", \"click\", \"whoosh\", \"riser\") or an absolute path to your own short audio file. " +
        "Punctuates cuts and transitions the way real reels do."
    ),
  soundVolume: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Volume for this segment's sound effect (0..1). Default 0.7."),
  captionAnimation: z
    .enum(["none", "karaoke", "typewriter"])
    .default("none")
    .describe(
      "How the caption text animates over the segment. " +
        "none = whole caption shown at once. " +
        "karaoke = words revealed/highlighted one-by-one in sync (the TikTok/Reels look). " +
        "typewriter = characters typed out left-to-right. " +
        "By default words are timed evenly across the segment; provide `wordTimings` for exact sync."
    ),
  highlightColor: z
    .string()
    .optional()
    .describe("Active-word color for karaoke captions (default: a bright accent). CSS color."),
  wordTimings: z
    .array(z.number().min(0))
    .optional()
    .describe(
      "Optional per-word start times in seconds, relative to the segment start, one per " +
        "whitespace-delimited word in the caption. When omitted, karaoke/typewriter spread the " +
        "words evenly across the segment. Use timings from a transcription for exact lip/beat sync."
    ),
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
    if (seg.wordTimings) {
      const wordCount = seg.caption.trim().split(/\s+/).filter(Boolean).length;
      if (seg.wordTimings.length !== wordCount) {
        throw new Error(
          `segment ${i}: wordTimings has ${seg.wordTimings.length} entries but the caption has ${wordCount} words`
        );
      }
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

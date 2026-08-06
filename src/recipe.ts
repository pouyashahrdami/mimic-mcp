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
  videoTransitionIn: z
    .object({
      kind: z
        .enum(["dissolve", "dip-to-black", "dip-to-white", "wipe", "slide"])
        .describe(
          "dissolve = crossfade from the previous segment's footage; dip = fade through " +
            "solid black/white; wipe = the new footage is revealed behind a sweeping edge; " +
            "slide = the new footage pushes in."
        ),
      durationSeconds: z
        .number()
        .positive()
        .max(2)
        .default(0.3)
        .describe("On-screen length of the transition (analyze_reference measures this)"),
      direction: z
        .enum(["left", "right", "up", "down"])
        .optional()
        .describe("For wipe/slide: which way the new footage moves in. Default right."),
    })
    .optional()
    .describe(
      "REAL footage transition from the previous segment — the video itself dissolves/" +
        "dips/wipes, not just the caption. Copy kind and durationSeconds straight from " +
        "analyze_reference's measured `transitions`. Needs per-segment backgrounds " +
        "(backgroundStart/backgroundVideo) to have two clips to blend, except dips, " +
        "which work over any background. Omit for a hard cut."
    ),
  zoom: z
    .object({
      from: z.number().positive().default(1).describe("Starting scale (1 = no zoom)"),
      to: z.number().positive().default(1.3).describe("Ending scale (>1 = punch in, <from = pull out)"),
      easing: z
        .enum(["linear", "easeIn", "easeOut", "easeInOut"])
        .default("linear")
        .describe(
          "How the zoom progresses over the segment. analyze_reference measures this " +
            "per shot (shots[].motion.easing) — copy it instead of guessing."
        ),
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
  speed: z
    .number()
    .positive()
    .max(16)
    .optional()
    .describe(
      "Playback rate for THIS segment's background footage. 2 = twice as fast — the " +
        "speed-ramp/timelapse move reels use to compress long takes so the edit keeps up " +
        "with the music. Default 1 (normal speed). The segment consumes " +
        "(end - start) * speed seconds of source footage from backgroundStart."
    ),
  captionPosition: z
    .enum(["top", "center", "bottom"])
    .optional()
    .describe(
      "Vertical band the caption sits in, overriding the style's default " +
        "(hook/plain center, tip bottom). Copy from analyze_reference's measured " +
        "captions[].band — POV-style reels often run top."
    ),
  captionColor: z
    .string()
    .optional()
    .describe("CSS color overriding the default white caption"),
  captionFont: z
    .string()
    .optional()
    .describe(
      "CSS font-family overriding the default sans-serif — e.g. " +
        "\"Georgia, 'Times New Roman', serif\" for the editorial-serif POV look."
    ),
  captionSize: z
    .number()
    .positive()
    .optional()
    .describe("Font size in px overriding the caption style's default"),
  captionWeight: z
    .number()
    .min(100)
    .max(900)
    .optional()
    .describe(
      "CSS font-weight overriding the caption style's default (the built-in looks are bold; " +
        "set 400 for the delicate editorial-serif reference style)."
    ),
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
    if (
      i === 0 &&
      seg.videoTransitionIn &&
      !seg.videoTransitionIn.kind.startsWith("dip-")
    ) {
      throw new Error(
        `segment 0: videoTransitionIn "${seg.videoTransitionIn.kind}" needs a previous ` +
          "segment to transition from — only dips work on the first segment"
      );
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

  const lastEnd = Math.max(...recipe.segments.map((s) => s.end));
  if (lastEnd > recipe.output.durationSeconds) {
    throw new Error(
      `last segment ends at ${lastEnd}s but output.durationSeconds is ${recipe.output.durationSeconds}s`
    );
  }

  return recipe;
}

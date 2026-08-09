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
  backgroundFill: z
    .string()
    .optional()
    .describe(
      "CSS background for THIS segment instead of footage — a solid color or gradient " +
        "(e.g. \"linear-gradient(160deg, #0f0c29, #302b63)\"). The from-scratch move: " +
        "designed backgrounds with no video shot. Zooms and transitions still apply."
    ),
  backgroundImage: z
    .string()
    .optional()
    .describe(
      "Absolute path to a still image used as THIS segment's full-bleed background — " +
        "a product screenshot, a designed frame, a photo. Rides the same zoom/transition " +
        "machinery as footage: add `zoom` for the Ken-Burns product-demo move."
    ),
  scene: z
    .string()
    .optional()
    .describe(
      "Absolute path to a Remotion scene component YOU write (.tsx, default-exporting a " +
        "React component that takes SceneProps from ../recipeSchema). The scene becomes " +
        "this segment's entire background layer — the full generative escape hatch for " +
        "animated UI mockups, motion graphics, charts, anything React can draw. " +
        "scaffold_reel copies the file into the project's src/scenes/ and rewires this " +
        "field to the scene's name. Captions, sounds, zoom and transitions still apply on top."
    ),
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
  captionOutline: z
    .object({
      color: z.string().default("#000").describe("CSS color of the outline"),
      widthPx: z.number().min(0).max(24).default(6).describe("Stroke width in px"),
    })
    .optional()
    .describe(
      "Contrasting outline drawn around the caption's letters — the hard black stroke " +
        "that keeps TikTok/Reels captions readable over ANY footage. Reach for this " +
        "instead of a drop shadow when the reference's text stays crisp over busy shots."
    ),
  captionInset: z
    .number()
    .min(0)
    .max(0.45)
    .optional()
    .describe(
      "How far a top/center-banded or bottom-banded caption sits from that edge, as a " +
        "fraction of the output HEIGHT. Defaults clear the platform chrome (TikTok's " +
        "caption bar starts around 0.82 from the top, its tab bar ends around 0.08). " +
        "Lower it only when copying a reference that deliberately runs text to the edge — " +
        "and check with review_render's `platform` that it stays readable."
    ),
  captionBackground: z
    .string()
    .optional()
    .describe(
      "CSS background painted as a rounded pill behind the caption (color or gradient, " +
        "e.g. \"rgba(0,0,0,0.7)\" or \"#ffe000\"). The subtitle-box look. " +
        "captionStyle \"tip\" already has one; this overrides it."
    ),
  emphasisWords: z
    .array(z.number().int().min(0))
    .optional()
    .describe(
      "Indices of words in `caption` (0-based, whitespace-split) to paint in " +
        "`emphasisColor` — the one-word-popped look reels use to land the point. " +
        "Works with captionAnimation none and karaoke."
    ),
  emphasisColor: z
    .string()
    .optional()
    .describe("CSS color for `emphasisWords` (default: the karaoke accent)."),
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
  background: z
    .object({
      video: z
        .string()
        .optional()
        .describe(
          "Absolute path to the user's footage. Omit for a from-scratch reel built on " +
            "fills, images, and scenes."
        ),
      fill: z
        .string()
        .optional()
        .describe(
          "CSS background (color or gradient) used for segments that specify no footage, " +
            "image, or fill of their own — the reel's base canvas when there's no video."
        ),
      fit: z.enum(["cover", "contain"]).default("cover"),
      muted: z.boolean().default(true),
    })
    .default({ fit: "cover", muted: true }),
  music: z
    .object({
      file: z.string().describe("Absolute path to the soundtrack (e.g. from extract_music)"),
      volume: z.number().min(0).max(1).default(0.8),
      startSeconds: z
        .number()
        .min(0)
        .default(0)
        .describe(
          "Seconds into the track where playback starts — skip a long intro and open " +
            "on the drop, the way reels use the hookiest 20 seconds of a song."
        ),
      fadeInSeconds: z.number().min(0).max(10).default(0).describe("Ramp the music up over this long"),
      fadeOutSeconds: z
        .number()
        .min(0)
        .max(10)
        .default(1.5)
        .describe(
          "Ramp the music down into the last seconds of the reel. Without this the " +
            "track is cut off mid-bar, which is the most audible tell of an auto-edit."
        ),
      duckUnderVoiceover: z
        .boolean()
        .default(true)
        .describe("Drop the music while the voiceover speaks. No effect without a voiceover."),
      duckTo: z
        .number()
        .min(0)
        .max(1)
        .default(0.25)
        .describe("Music gain multiplier while ducked (0.25 = a quarter as loud)."),
    })
    .optional(),
  voiceover: z
    .object({
      file: z.string().describe("Absolute path to the narration audio (e.g. from generate_voiceover)"),
      volume: z.number().min(0).max(1).default(1),
      startSeconds: z
        .number()
        .min(0)
        .default(0)
        .describe("Seconds into the REEL where the narration begins"),
      durationSeconds: z
        .number()
        .positive()
        .optional()
        .describe(
          "How long the narration runs (generate_voiceover reports it). Used to duck " +
            "the music only while it speaks; without it the music stays ducked to the end."
        ),
    })
    .optional()
    .describe(
      "A narration track that plays ALONGSIDE the music, which then ducks underneath it. " +
        "Use this for voiceovers rather than putting narration in music.file — that slot " +
        "silences the soundtrack."
    ),
  googleFonts: z
    .array(z.string())
    .optional()
    .describe(
      "Google Fonts families to load into the render, e.g. [\"Inter\", \"Bebas Neue\"]. " +
        "Without this a captionFont only renders if the font happens to be installed on " +
        "the machine — which it usually is not, so the reel silently falls back to " +
        "Helvetica. List the family here AND set it as a segment's captionFont. " +
        "Match the reference's type from analyze_reference's caption crops."
    ),
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
    const sources = [
      seg.backgroundVideo,
      seg.backgroundImage,
      seg.backgroundFill,
      seg.scene,
    ].filter((s) => s != null);
    if (sources.length > 1) {
      throw new Error(
        `segment ${i}: backgroundVideo, backgroundImage, backgroundFill and scene are ` +
          "mutually exclusive — pick the one background this segment should show"
      );
    }
    if (sources.length === 0 && !recipe.background.video && !recipe.background.fill) {
      throw new Error(
        `segment ${i}: no background anywhere — set backgroundFill, backgroundImage, ` +
          "backgroundVideo or scene on the segment, or background.video / background.fill " +
          'globally (an explicit backgroundFill of "black" is fine for a minimal look)'
      );
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
    const wordCount = seg.caption.trim().split(/\s+/).filter(Boolean).length;
    if (seg.wordTimings && seg.wordTimings.length !== wordCount) {
      throw new Error(
        `segment ${i}: wordTimings has ${seg.wordTimings.length} entries but the caption has ${wordCount} words`
      );
    }
    const strayEmphasis = seg.emphasisWords?.filter((w) => w >= wordCount);
    if (strayEmphasis && strayEmphasis.length > 0) {
      throw new Error(
        `segment ${i}: emphasisWords ${strayEmphasis.join(", ")} are out of range — ` +
          `the caption has ${wordCount} word(s), so indices run 0..${wordCount - 1}`
      );
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

import { z } from "zod";

/**
 * Zod schema for the recipe, mirrored from mimic-mcp. Wiring it into the
 * Composition (Root.tsx) makes Remotion Studio render a real editing UI for
 * every field — text inputs, dropdowns for enums, sliders for numbers — so
 * captions, timing, zooms and transitions are tweakable without code.
 */

export const videoTransitionSchema = z.object({
  kind: z.enum(["dissolve", "dip-to-black", "dip-to-white", "wipe", "slide"]),
  durationSeconds: z.number().positive().max(2).default(0.3),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
});

export const zoomSchema = z.object({
  from: z.number().positive().default(1),
  to: z.number().positive().default(1.3),
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).default("linear"),
});

export const captionOutlineSchema = z.object({
  color: z.string().default("#000"),
  widthPx: z.number().min(0).max(24).default(6),
});

export const segmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  caption: z.string(),
  captionStyle: z.enum(["hook", "tip", "plain"]).default("plain"),
  image: z.string().optional(),
  backgroundFill: z.string().optional(),
  backgroundImage: z.string().optional(),
  scene: z.string().optional(),
  backgroundStart: z.number().min(0).optional(),
  backgroundVideo: z.string().optional(),
  backgroundPosition: z.string().optional(),
  backgroundTrack: z
    .array(
      z.object({
        atSeconds: z.number().min(0),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
    )
    .min(2)
    .optional(),
  videoTransitionIn: videoTransitionSchema.optional(),
  zoom: zoomSchema.optional(),
  speed: z.number().positive().max(16).optional(),
  captionPosition: z.enum(["top", "center", "bottom"]).optional(),
  captionColor: z.string().optional(),
  captionFont: z.string().optional(),
  captionSize: z.number().positive().optional(),
  captionWeight: z.number().min(100).max(900).optional(),
  captionInset: z.number().min(0).max(0.45).optional(),
  captionOutline: captionOutlineSchema.optional(),
  captionBackground: z.string().optional(),
  emphasisWords: z.array(z.number().int().min(0)).optional(),
  emphasisColor: z.string().optional(),
  transitionIn: z.enum(["cut", "fade", "slide"]).default("cut"),
  sound: z.string().optional(),
  soundVolume: z.number().min(0).max(1).optional(),
  captionAnimation: z.enum(["none", "karaoke", "typewriter"]).default("none"),
  highlightColor: z.string().optional(),
  wordTimings: z.array(z.number().min(0)).optional(),
});

export const overlaySchema = z.object({
  kind: z.enum(["image", "text", "progressBar"]),
  file: z.string().optional(),
  text: z.string().optional(),
  corner: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
    .default("top-right"),
  edge: z.enum(["top", "bottom"]).default("bottom"),
  size: z.number().min(0.01).max(1).default(0.12),
  margin: z.number().min(0).max(0.4).default(0.05),
  color: z.string().default("#fff"),
  opacity: z.number().min(0).max(1).default(0.9),
  fromSeconds: z.number().min(0).optional(),
  toSeconds: z.number().positive().optional(),
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
      video: z.string().optional(),
      fill: z.string().optional(),
      fit: z.enum(["cover", "contain"]).default("cover"),
      muted: z.boolean().default(true),
    })
    .default({ fit: "cover", muted: true }),
  music: z
    .object({
      file: z.string(),
      volume: z.number().min(0).max(1).default(0.8),
      startSeconds: z.number().min(0).default(0),
      fadeInSeconds: z.number().min(0).max(10).default(0),
      fadeOutSeconds: z.number().min(0).max(10).default(1.5),
      duckUnderVoiceover: z.boolean().default(true),
      duckTo: z.number().min(0).max(1).default(0.25),
    })
    .optional(),
  voiceover: z
    .object({
      file: z.string(),
      volume: z.number().min(0).max(1).default(1),
      startSeconds: z.number().min(0).default(0),
      durationSeconds: z.number().positive().optional(),
    })
    .optional(),
  overlays: z.array(overlaySchema).optional(),
  googleFonts: z.array(z.string()).optional(),
  segments: z.array(segmentSchema).min(1),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type Segment = z.infer<typeof segmentSchema>;

/**
 * Props every custom scene component receives. A scene renders a segment's
 * entire background layer; use useCurrentFrame() (relative to the segment's
 * Sequence) with durationInFrames to animate.
 */
export type SceneProps = {
  segment: Segment;
  durationInFrames: number;
};
export type Overlay = z.infer<typeof overlaySchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type CaptionOutline = z.infer<typeof captionOutlineSchema>;
export type VideoTransition = z.infer<typeof videoTransitionSchema>;

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

export const segmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  caption: z.string(),
  captionStyle: z.enum(["hook", "tip", "plain"]).default("plain"),
  image: z.string().optional(),
  backgroundStart: z.number().min(0).optional(),
  backgroundVideo: z.string().optional(),
  backgroundPosition: z.string().optional(),
  videoTransitionIn: videoTransitionSchema.optional(),
  zoom: zoomSchema.optional(),
  speed: z.number().positive().max(16).optional(),
  captionColor: z.string().optional(),
  captionFont: z.string().optional(),
  captionSize: z.number().positive().optional(),
  transitionIn: z.enum(["cut", "fade", "slide"]).default("cut"),
  sound: z.string().optional(),
  soundVolume: z.number().min(0).max(1).optional(),
  captionAnimation: z.enum(["none", "karaoke", "typewriter"]).default("none"),
  highlightColor: z.string().optional(),
  wordTimings: z.array(z.number().min(0)).optional(),
});

export const recipeSchema = z.object({
  output: z.object({
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    fps: z.number().int().positive().default(30),
    durationSeconds: z.number().positive(),
  }),
  background: z.object({
    video: z.string(),
    fit: z.enum(["cover", "contain"]).default("cover"),
    muted: z.boolean().default(true),
  }),
  music: z
    .object({
      file: z.string(),
      volume: z.number().min(0).max(1).default(0.8),
    })
    .optional(),
  segments: z.array(segmentSchema).min(1),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type VideoTransition = z.infer<typeof videoTransitionSchema>;

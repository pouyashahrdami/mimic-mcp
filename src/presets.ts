import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseRecipe, type Recipe } from "./recipe.js";

/**
 * A style preset is the reusable *look* of a reel with the creator-specific
 * content removed: caption looks, animations, transitions, zoom moves and the
 * timing rhythm survive; footage paths, caption text and music files don't.
 * Apply one by writing a fresh recipe that fills the skeleton with new footage
 * and script.
 */

export const presetSegmentSchema = z.object({
  durationSeconds: z.number().positive(),
  captionStyle: z.enum(["hook", "tip", "plain"]),
  captionAnimation: z.enum(["none", "karaoke", "typewriter"]).optional(),
  captionPosition: z.enum(["top", "center", "bottom"]).optional(),
  highlightColor: z.string().optional(),
  captionColor: z.string().optional(),
  captionFont: z.string().optional(),
  captionSize: z.number().positive().optional(),
  captionWeight: z.number().min(100).max(900).optional(),
  transitionIn: z.enum(["cut", "fade", "slide"]).optional(),
  zoom: z
    .object({
      from: z.number().positive(),
      to: z.number().positive(),
      easing: z.enum(["linear", "easeIn", "easeOut", "easeInOut"]).optional(),
      focusX: z.number().min(0).max(1).optional(),
      focusY: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const presetSchema = z.object({
  name: z.string(),
  description: z.string(),
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  }),
  musicVolume: z.number().min(0).max(1).optional(),
  segments: z.array(presetSegmentSchema).min(1),
});

export type Preset = z.infer<typeof presetSchema>;

// dist/presets.js -> ../presets (the built-in library shipped with the server)
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "presets");

// User presets live next to the caller's project so they're easy to commit/share.
function userDir(workDir: string) {
  return path.join(workDir, ".mimic-mcp", "presets");
}

/** Strip a full recipe down to its portable style skeleton. */
export function extractPreset(recipe: Recipe, name: string, description: string): Preset {
  return {
    name,
    description,
    output: {
      width: recipe.output.width,
      height: recipe.output.height,
      fps: recipe.output.fps,
    },
    musicVolume: recipe.music?.volume,
    segments: recipe.segments.map((s) => ({
      durationSeconds: Math.round((s.end - s.start) * 100) / 100,
      captionStyle: s.captionStyle,
      captionAnimation: s.captionAnimation === "none" ? undefined : s.captionAnimation,
      captionPosition: s.captionPosition,
      highlightColor: s.highlightColor,
      captionColor: s.captionColor,
      captionFont: s.captionFont,
      captionSize: s.captionSize,
      captionWeight: s.captionWeight,
      transitionIn: s.transitionIn === "cut" ? undefined : s.transitionIn,
      zoom: s.zoom
        ? {
            from: s.zoom.from,
            to: s.zoom.to,
            easing: s.zoom.easing === "linear" ? undefined : s.zoom.easing,
            focusX: s.zoom.focusX,
            focusY: s.zoom.focusY,
          }
        : undefined,
    })),
  };
}

async function loadDir(dir: string): Promise<Preset[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const presets: Preset[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      presets.push(presetSchema.parse(raw));
    } catch {
      // Skip malformed presets rather than failing the whole listing.
    }
  }
  return presets;
}

export interface ListedPreset {
  name: string;
  description: string;
  segmentCount: number;
  source: "builtin" | "user";
}

/** All presets the agent can draw on: the shipped library plus the user's own. */
export async function listPresets(workDir: string): Promise<ListedPreset[]> {
  const builtin = (await loadDir(BUILTIN_DIR)).map((p) => ({ p, source: "builtin" as const }));
  const user = (await loadDir(userDir(workDir))).map((p) => ({ p, source: "user" as const }));
  return [...builtin, ...user].map(({ p, source }) => ({
    name: p.name,
    description: p.description,
    segmentCount: p.segments.length,
    source,
  }));
}

/** Return a single preset's full skeleton by name (user presets win over builtins). */
export async function getPreset(workDir: string, name: string): Promise<Preset> {
  const all = [...(await loadDir(userDir(workDir))), ...(await loadDir(BUILTIN_DIR))];
  const found = all.find((p) => p.name === name);
  if (!found) {
    const names = all.map((p) => p.name).join(", ") || "(none)";
    throw new Error(`No preset named "${name}". Available: ${names}`);
  }
  return found;
}

/** Extract a preset from a recipe JSON string and save it to the user library. */
export async function savePreset(
  recipeJson: string,
  name: string,
  description: string,
  workDir: string
): Promise<{ name: string; file: string }> {
  const recipe = parseRecipe(recipeJson);
  return writePreset(extractPreset(recipe, name, description), workDir);
}

/**
 * Write a preset to the user's library, refusing to clobber an existing one.
 * Shared by save_preset and by the creator-style learner, which builds its
 * preset from measurements rather than from a recipe.
 */
export async function writePreset(
  preset: Preset,
  workDir: string
): Promise<{ name: string; file: string }> {
  const { name } = preset;
  const dir = userDir(workDir);
  await mkdir(dir, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = path.join(dir, `${slug || "preset"}.json`);

  await access(file)
    .then(() => {
      throw new Error(`A preset file already exists at ${file}. Choose a different name.`);
    })
    .catch((err) => {
      if (err.message.startsWith("A preset file already exists")) throw err;
    });

  await writeFile(file, JSON.stringify(preset, null, 2));
  return { name, file };
}

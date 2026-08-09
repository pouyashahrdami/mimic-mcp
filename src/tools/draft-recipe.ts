import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { draftRecipe, type DraftOptions } from "../draft-recipe.js";
import { probe } from "../ffmpeg.js";
import type { StyleSpec } from "../style-spec.js";
import { analyzeReference } from "./analyze-reference.js";

export interface DraftRecipeInput {
  /** Path to a style-spec.json from analyze_reference. */
  styleSpec?: string;
  /** Reference video — analyzed (or read from its cached spec) when no spec path. */
  reference?: string;
  /** Caption lines, or a path to a .txt/.md with one line per caption. */
  script: string[] | string;
  footage?: string;
  backgroundFill?: string;
  music?: string;
  snapToBeats?: boolean;
  /** Where to write the drafted recipe. Defaults to <workDir>/recipe.json. */
  out?: string;
}

async function loadSpec(input: DraftRecipeInput, workDir: string): Promise<StyleSpec> {
  if (input.styleSpec) {
    return JSON.parse(await readFile(input.styleSpec, "utf8")) as StyleSpec;
  }
  if (input.reference) {
    const base = path.basename(input.reference, path.extname(input.reference));
    const cached = path.join(workDir, ".mimic-mcp", base, "style-spec.json");
    try {
      return JSON.parse(await readFile(cached, "utf8")) as StyleSpec;
    } catch {
      return (await analyzeReference(input.reference, workDir)).styleSpec;
    }
  }
  throw new Error("pass either styleSpec (a style-spec.json path) or reference (a video path)");
}

/** Script lines come inline or as a file — one caption per non-empty line. */
async function loadScript(script: string[] | string): Promise<string[]> {
  if (Array.isArray(script)) return script;
  if (/\.(txt|md)$/i.test(script)) {
    const text = await readFile(script, "utf8");
    return text.split(/\r?\n/);
  }
  return script.split(/\r?\n/);
}

export async function draftRecipeTool(
  input: DraftRecipeInput,
  workDir: string
): Promise<{ recipeFile: string; recipe: unknown; notes: string[]; instructions: string }> {
  const spec = await loadSpec(input, workDir);
  const script = await loadScript(input.script);

  const options: DraftOptions = {
    script,
    ...(input.footage ? { footageVideo: input.footage } : {}),
    ...(input.backgroundFill ? { backgroundFill: input.backgroundFill } : {}),
    ...(input.music ? { musicFile: input.music } : {}),
    ...(input.snapToBeats != null ? { snapToBeats: input.snapToBeats } : {}),
  };
  if (input.footage) {
    options.footageDurationSeconds = (await probe(input.footage)).durationSeconds;
  }

  const { recipe, notes } = draftRecipe(spec, options);

  const recipeFile = input.out ?? path.join(workDir, "recipe.json");
  await writeFile(recipeFile, JSON.stringify(recipe, null, 2));

  return {
    recipeFile,
    recipe,
    notes,
    instructions:
      "This is a DRAFT: every timing, transition, zoom and caption box came from the " +
      "measurement, so leave those alone unless a frame proves them wrong. Your job is the " +
      "content and the look — captions, fills/images/scenes, colors, fonts, sounds. Work " +
      "through `notes` first, then pass the recipe to scaffold_reel.",
  };
}

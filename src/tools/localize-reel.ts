import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { critiqueRecipe } from "../critique.js";
import { localizeRecipe, type Translation } from "../localize.js";
import { parseRecipe, recipeSchema, type Recipe } from "../recipe.js";
import { buildCues, toSrt, toVtt } from "../subtitles.js";

export interface LocalizedOutput {
  language: string;
  recipeFile: string;
  subtitleFiles: string[];
  recipe: Recipe;
  notes: string[];
  /** Readability score of the TRANSLATED reel — length changes break pacing. */
  readabilityScore: number;
  readabilityIssues: string[];
  instructions: string;
}

/**
 * Put a reel out in another language: swap the captions, keep the timing
 * honest, and write both a renderable recipe and subtitle sidecars.
 *
 * Outputs land beside the project (or under `.mimic-mcp/localized/` when given
 * a bare recipe), named by language tag.
 */
export async function localizeReel(
  input: { recipeJson?: string; project?: string },
  translation: Translation,
  workDir: string
): Promise<LocalizedOutput> {
  const { recipeJson, project } = input;
  if (!recipeJson && !project) throw new Error("Pass either recipe_json or project.");

  let json = recipeJson;
  let outDir = path.join(workDir, ".mimic-mcp", "localized");

  if (!json && project) {
    const projectPath = path.resolve(project);
    json = await readFile(path.join(projectPath, "recipe.json"), "utf8").catch(() => {
      throw new Error(
        `${project} doesn't look like a scaffolded reel project (no recipe.json). ` +
          "Run scaffold_reel first, or pass recipe_json instead."
      );
    });
    outDir = path.join(projectPath, "out");
  }

  const { recipe, notes } = localizeRecipe(parseRecipe(json as string), translation);

  // Re-validate: the swap can only produce a valid recipe, and proving it here
  // beats discovering it at render time.
  const validated = recipeSchema.parse(recipe);

  await mkdir(outDir, { recursive: true });
  const tag = translation.language.replace(/[^a-zA-Z0-9-]/g, "");

  const recipeFile = path.join(outDir, `recipe.${tag}.json`);
  await writeFile(recipeFile, JSON.stringify(validated, null, 2));

  const cues = buildCues(validated.segments);
  const subtitleFiles: string[] = [];
  if (cues.length > 0) {
    for (const [format, render] of [
      ["srt", toSrt],
      ["vtt", toVtt],
    ] as const) {
      const file = path.join(outDir, `reel.${tag}.${format}`);
      await writeFile(file, render(cues));
      subtitleFiles.push(file);
    }
  } else {
    notes.push("Every translated caption is empty, so no subtitle sidecar was written.");
  }

  const critique = critiqueRecipe(validated);

  return {
    language: translation.language,
    recipeFile,
    subtitleFiles,
    recipe: validated,
    notes,
    readabilityScore: critique.score,
    readabilityIssues: critique.issues
      .filter((i) => i.kind === "caption-too-fast" || i.kind === "caption-rushed")
      .map((i) => i.message),
    instructions:
      `Wrote a ${translation.language} recipe to ${recipeFile}` +
      (subtitleFiles.length > 0 ? ` and sidecars to ${subtitleFiles.join(", ")}. ` : ". ") +
      "Scaffold and render it as its own reel — the footage, music and timing are shared, " +
      "only the text changed. The readability score is measured on the TRANSLATED captions, " +
      "because languages are not the same length: a line that read comfortably in English " +
      "can flash past in German at the same segment timing. Fix those by lengthening the " +
      "segment or shortening the translation, not by translating more literally.",
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { critiqueRecipe, type Critique } from "../critique.js";
import { parseRecipe } from "../recipe.js";

export interface CritiqueResult extends Critique {
  source: string;
  instructions: string;
}

/**
 * Critique a reel with no reference to compare it against — the feedback the
 * from-scratch workflow has never had. Takes either a recipe JSON string or a
 * scaffolded project directory.
 */
export async function critiqueReel(
  input: { recipeJson?: string; project?: string }
): Promise<CritiqueResult> {
  const { recipeJson, project } = input;
  if (!recipeJson && !project) {
    throw new Error("Pass either recipe_json or project.");
  }

  let json = recipeJson;
  let source = "recipe_json";

  if (!json && project) {
    const recipeFile = path.join(path.resolve(project), "recipe.json");
    json = await readFile(recipeFile, "utf8").catch(() => {
      throw new Error(
        `${project} doesn't look like a scaffolded reel project (no recipe.json). ` +
          "Run scaffold_reel first, or pass recipe_json instead."
      );
    });
    source = recipeFile;
  }

  const critique = critiqueRecipe(parseRecipe(json as string));

  return {
    ...critique,
    source,
    instructions:
      "These are readability and pacing checks measured from the recipe alone — no reference " +
      "needed, so they work for a from-scratch reel. Each issue names the field to change. " +
      "They are heuristics with the numbers shown, so overrule one when you can see it is " +
      "wrong for this reel (a deliberate long hold on a hero shot, a caption you WANT " +
      "lingering). This does not look at the pixels: run review_render with `platform` to " +
      "catch captions the app's own UI would cover, and to see the frames.",
  };
}

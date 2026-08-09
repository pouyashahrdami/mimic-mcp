import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { critiqueRecipe } from "../critique.js";
import { parseRecipe } from "../recipe.js";
import { buildHookVariants } from "../variants.js";

export interface WrittenVariant {
  id: string;
  hook: string;
  recipeFile: string;
  changedSegments: number[];
  /** Reading-speed score for this hook — a long hook in a short segment flashes. */
  readabilityIssues: string[];
  notes: string[];
}

export interface HookVariantsResult {
  variants: WrittenVariant[];
  instructions: string;
}

/**
 * Write one recipe per alternative opening, changing nothing else.
 *
 * Outputs land beside the project (or under `.mimic-mcp/variants/` when given a
 * bare recipe), named by variant id.
 */
export async function hookVariants(
  input: { recipeJson?: string; project?: string },
  hooks: string[],
  workDir: string,
  { segments, labelFromText }: { segments?: number[]; labelFromText?: boolean } = {}
): Promise<HookVariantsResult> {
  const { recipeJson, project } = input;
  if (!recipeJson && !project) throw new Error("Pass either recipe_json or project.");

  let json = recipeJson;
  let outDir = path.join(workDir, ".mimic-mcp", "variants");

  if (!json && project) {
    const projectPath = path.resolve(project);
    json = await readFile(path.join(projectPath, "recipe.json"), "utf8").catch(() => {
      throw new Error(
        `${project} doesn't look like a scaffolded reel project (no recipe.json). ` +
          "Run scaffold_reel first, or pass recipe_json instead."
      );
    });
    outDir = path.join(projectPath, "out", "variants");
  }

  const built = buildHookVariants(parseRecipe(json as string), hooks, {
    segments,
    labelFromText,
  });

  await mkdir(outDir, { recursive: true });

  const variants: WrittenVariant[] = [];
  for (const variant of built) {
    const recipeFile = path.join(outDir, `recipe.${variant.id}.json`);
    await writeFile(recipeFile, JSON.stringify(variant.recipe, null, 2));

    const critique = critiqueRecipe(variant.recipe);
    variants.push({
      id: variant.id,
      hook: variant.hook,
      recipeFile,
      changedSegments: variant.changedSegments,
      readabilityIssues: critique.issues
        .filter(
          (issue) =>
            issue.segment != null &&
            variant.changedSegments.includes(issue.segment) &&
            issue.kind.startsWith("caption-")
        )
        .map((issue) => issue.message),
      notes: variant.notes,
    });
  }

  const changed = built[0].changedSegments;

  return {
    variants,
    instructions:
      `${variants.length} variant(s) written. Only segment(s) ${changed.join(", ")} differ — ` +
      `scaffold each recipe and call render_reel with \`segments: [${changed.join(", ")}]\` so a ` +
      "variant costs one segment instead of a whole reel, and lands in its own file. " +
      "Each variant's `readabilityIssues` covers only its changed segments: a hook that is " +
      "stronger but too long to read in the time available is not a better hook. Judge the " +
      "rendered openings side by side — this measures whether a hook is READABLE, not whether " +
      "it lands.",
  };
}

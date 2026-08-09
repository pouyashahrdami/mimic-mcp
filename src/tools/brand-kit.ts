import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyBrandKit, brandKitSchema, type BrandKit } from "../brand-kit.js";
import { parseRecipe } from "../recipe.js";

/** Kits live next to the caller's project so they're easy to commit and share. */
function kitDir(workDir: string): string {
  return path.join(workDir, ".mimic-mcp", "brand-kits");
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "kit";
}

export async function saveBrandKit(
  kitJson: string,
  workDir: string
): Promise<{ name: string; file: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(kitJson);
  } catch {
    throw new Error("brand kit is not valid JSON");
  }

  const kit = brandKitSchema.parse(raw);
  for (const [i, overlay] of (kit.overlays ?? []).entries()) {
    if (overlay.kind === "image" && !overlay.file) {
      throw new Error(`overlay ${i}: kind "image" needs a \`file\``);
    }
    if (overlay.kind === "text" && !overlay.text?.trim()) {
      throw new Error(`overlay ${i}: kind "text" needs \`text\``);
    }
  }

  const dir = kitDir(workDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug(kit.name)}.json`);
  // Overwriting is right here, unlike presets: a brand kit is one evolving
  // thing per brand, not a library of alternatives.
  await writeFile(file, JSON.stringify(kit, null, 2));
  return { name: kit.name, file };
}

export async function listBrandKits(
  workDir: string
): Promise<{ kits: { name: string; description: string; file: string }[] }> {
  const dir = kitDir(workDir);
  const files = await readdir(dir).catch(() => [] as string[]);

  const kits = [];
  for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, name);
    const parsed = brandKitSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    if (!parsed.success) continue;
    kits.push({ name: parsed.data.name, description: parsed.data.description, file });
  }
  return { kits };
}

async function loadKit(workDir: string, name: string): Promise<BrandKit> {
  const file = path.join(kitDir(workDir), `${slug(name)}.json`);
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(
      `No brand kit named "${name}" in ${kitDir(workDir)}. Save one with save_brand_kit first.`
    );
  });
  return brandKitSchema.parse(JSON.parse(raw));
}

export interface ApplyBrandKitResult {
  recipe: unknown;
  changes: string[];
  instructions: string;
}

/**
 * Stamp a saved kit onto a recipe. Additive and idempotent: applying twice
 * leaves one logo, and a choice the recipe made on purpose survives unless
 * `overwrite` says otherwise.
 */
export async function applyBrandKitTool(
  recipeJson: string,
  kitName: string,
  workDir: string,
  { overwrite = false }: { overwrite?: boolean } = {}
): Promise<ApplyBrandKitResult> {
  const kit = await loadKit(workDir, kitName);
  const { recipe, changes } = applyBrandKit(parseRecipe(recipeJson), kit, { overwrite });

  return {
    recipe,
    changes,
    instructions:
      `Applied "${kit.name}". Pass the returned recipe to scaffold_reel — it stages the ` +
      "overlay images into the project the same way it stages footage. Overlays draw above " +
      "everything including transitions, so a logo can't be covered by a dip. " +
      (overwrite
        ? "You asked it to overwrite, so segment choices the recipe had already made were replaced."
        : "Choices the recipe already made were left alone; pass overwrite to replace them."),
  };
}

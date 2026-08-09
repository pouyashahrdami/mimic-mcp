import { access, cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecipe, type Recipe } from "../recipe.js";

// dist/tools/scaffold-reel.js -> ../../templates/remotion
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "remotion"
);

// dist/tools/scaffold-reel.js -> ../../assets/sfx (shipped, synthesized effects)
const SFX_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "sfx"
);
const BUILTIN_SFX = new Set(["pop", "click", "whoosh", "riser"]);

/** Resolve a segment.sound value to a real file path (built-in name or custom path). */
function resolveSound(sound: string): string {
  return BUILTIN_SFX.has(sound) ? path.join(SFX_DIR, `${sound}.wav`) : sound;
}

async function assertExists(file: string, what: string) {
  try {
    await access(file);
  } catch {
    throw new Error(`${what} not found: ${file}`);
  }
}

/**
 * Turn a validated style recipe into a self-contained Remotion project:
 * template files copied in, media copied into public/, recipe.json rewritten
 * to reference the copies. The project stays hand-editable after this.
 */
export async function scaffoldReel(
  recipeJson: string,
  projectDir: string
): Promise<{ projectDir: string; nextStep: string }> {
  const recipe = parseRecipe(recipeJson);

  if (recipe.background.video) {
    await assertExists(recipe.background.video, "background video");
  }
  if (recipe.music) {
    await assertExists(recipe.music.file, "music file");
  }

  // Refuse to splat template files into a directory that already holds
  // something else. Re-scaffolding over an existing reel project is fine.
  const entries = await readdir(projectDir).catch(() => null);
  if (entries && entries.length > 0) {
    const isReelProject = await access(path.join(projectDir, "recipe.json"))
      .then(() => true)
      .catch(() => false);
    if (!isReelProject) {
      throw new Error(
        `${projectDir} already exists and isn't empty. Pick a fresh directory, ` +
          "or point at an existing scaffolded project to overwrite it."
      );
    }
  }

  await cp(TEMPLATE_DIR, projectDir, { recursive: true });

  const publicDir = path.join(projectDir, "public");
  await mkdir(publicDir, { recursive: true });

  // Copy media into public/ so the project renders anywhere, then point the
  // recipe at the copies (Remotion's staticFile resolves against public/).
  // Distinct sources sharing a basename get suffixed names instead of
  // clobbering each other, and a source reused across segments is copied once.
  const staged = new Map<string, string>();
  const usedNames = new Set<string>();
  async function stage(sourcePath: string): Promise<string> {
    const already = staged.get(sourcePath);
    if (already) return already;
    const ext = path.extname(sourcePath);
    const base = path.basename(sourcePath, ext);
    let name = `${base}${ext}`;
    for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}${ext}`;
    usedNames.add(name);
    staged.set(sourcePath, name);
    await cp(sourcePath, path.join(publicDir, name));
    return name;
  }

  const localized: Recipe = { ...recipe, background: { ...recipe.background } };
  if (recipe.background.video) {
    localized.background.video = await stage(recipe.background.video);
  }

  if (recipe.music) {
    localized.music = { ...recipe.music, file: await stage(recipe.music.file) };
  }

  if (recipe.voiceover) {
    localized.voiceover = { ...recipe.voiceover, file: await stage(recipe.voiceover.file) };
  }

  // Custom scenes are code, not media: they land in src/scenes/ (not public/)
  // and get a generated registry so Reel.tsx can resolve them by name.
  const scenesDir = path.join(projectDir, "src", "scenes");
  const stagedScenes = new Map<string, string>();
  const usedSceneNames = new Set<string>();
  async function stageScene(sourcePath: string): Promise<string> {
    const already = stagedScenes.get(sourcePath);
    if (already) return already;
    if (path.extname(sourcePath) !== ".tsx") {
      throw new Error(
        `scene must be a .tsx Remotion component (default export), got: ${sourcePath}`
      );
    }
    await assertExists(sourcePath, "scene component");
    const base = path.basename(sourcePath, ".tsx");
    let name = base;
    for (let n = 2; usedSceneNames.has(name); n++) name = `${base}-${n}`;
    usedSceneNames.add(name);
    stagedScenes.set(sourcePath, name);
    await cp(sourcePath, path.join(scenesDir, `${name}.tsx`));
    return name;
  }

  localized.segments = [];
  for (const segment of recipe.segments) {
    const local = { ...segment };
    if (segment.image) {
      await assertExists(segment.image, "segment image");
      local.image = await stage(segment.image);
    }
    if (segment.backgroundVideo) {
      await assertExists(segment.backgroundVideo, "segment background video");
      local.backgroundVideo = await stage(segment.backgroundVideo);
    }
    if (segment.backgroundImage) {
      await assertExists(segment.backgroundImage, "segment background image");
      local.backgroundImage = await stage(segment.backgroundImage);
    }
    if (segment.scene) {
      local.scene = await stageScene(segment.scene);
    }
    if (segment.sound) {
      const soundPath = resolveSound(segment.sound);
      await assertExists(soundPath, "segment sound effect");
      local.sound = await stage(soundPath);
    }
    localized.segments.push(local);
  }

  if (usedSceneNames.size > 0) {
    const names = [...usedSceneNames];
    await writeFile(
      path.join(scenesDir, "index.ts"),
      "// Generated by scaffold_reel — maps recipe `scene` names to components.\n" +
        'import type { ComponentType } from "react";\n' +
        'import type { SceneProps } from "../recipeSchema";\n' +
        names.map((n, i) => `import scene${i} from ${JSON.stringify(`./${n}`)};\n`).join("") +
        "\nexport const scenes: Record<string, ComponentType<SceneProps>> = {\n" +
        names.map((n, i) => `  ${JSON.stringify(n)}: scene${i},\n`).join("") +
        "};\n"
    );
  }

  await writeFile(
    path.join(projectDir, "recipe.json"),
    JSON.stringify(localized, null, 2)
  );

  return {
    projectDir,
    nextStep: `Project ready. Render with the render_reel tool, or preview with \`npm install && npm run studio\` inside ${projectDir}.`,
  };
}

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Render a scaffolded project to mp4. Installs the project's dependencies on
 * first run, which is the slow part — Remotion pulls a headless Chromium.
 */
export async function renderReel(projectDir: string): Promise<string> {
  await access(path.join(projectDir, "recipe.json")).catch(() => {
    throw new Error(
      `${projectDir} doesn't look like a scaffolded reel project (no recipe.json). Run scaffold_reel first.`
    );
  });

  const hasDeps = await access(path.join(projectDir, "node_modules"))
    .then(() => true)
    .catch(() => false);

  if (!hasDeps) {
    await run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: projectDir,
      maxBuffer: MAX_BUFFER,
    });
  }

  const outPath = path.join(projectDir, "out", "reel.mp4");
  await run("npx", ["remotion", "render", "Reel", outPath], {
    cwd: projectDir,
    maxBuffer: MAX_BUFFER,
  });

  return outPath;
}

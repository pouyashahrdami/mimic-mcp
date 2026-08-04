import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export type RenderQuality = "draft" | "final";

/**
 * Render a scaffolded project to mp4. Installs the project's dependencies on
 * first run, which is the slow part — Remotion pulls a headless Chromium.
 *
 * `quality: "draft"` renders at half resolution with a cheaper encode so the
 * review/re-render loop iterates in seconds; the layout, timing and captions
 * are identical, only the pixels are coarser. Use "final" for the deliverable.
 */
export async function renderReel(
  projectDir: string,
  quality: RenderQuality = "final"
): Promise<string> {
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

  const isDraft = quality === "draft";
  const outPath = path.join(projectDir, "out", isDraft ? "reel-draft.mp4" : "reel.mp4");

  const args = ["remotion", "render", "Reel", outPath];
  if (isDraft) {
    // Half the linear resolution (~quarter the pixels) and a cheap, fast encode.
    // crf 28 is well past visually-lossless but plenty to judge layout/timing.
    args.push("--scale=0.5", "--crf=28");
  }

  await run("npx", args, { cwd: projectDir, maxBuffer: MAX_BUFFER });

  return outPath;
}

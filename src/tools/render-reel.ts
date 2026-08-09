import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeLoudness, probe } from "../ffmpeg.js";

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
/**
 * Where a render lands, as an absolute path. The renderer runs with the project
 * as its cwd, so a relative projectDir would otherwise be applied twice and the
 * mp4 would appear at project/project/out — somewhere review_render can't find it.
 */
export function renderOutputPath(projectDir: string, quality: RenderQuality): string {
  return path.join(
    path.resolve(projectDir),
    "out",
    quality === "draft" ? "reel-draft.mp4" : "reel.mp4"
  );
}

export async function renderReel(
  projectDir: string,
  quality: RenderQuality = "final",
  { normalizeAudio = true }: { normalizeAudio?: boolean } = {}
): Promise<string> {
  const projectPath = path.resolve(projectDir);

  await access(path.join(projectPath, "recipe.json")).catch(() => {
    throw new Error(
      `${projectDir} doesn't look like a scaffolded reel project (no recipe.json). Run scaffold_reel first.`
    );
  });

  const hasDeps = await access(path.join(projectPath, "node_modules"))
    .then(() => true)
    .catch(() => false);

  if (!hasDeps) {
    await run("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: projectPath,
      maxBuffer: MAX_BUFFER,
    });
  }

  const outPath = renderOutputPath(projectPath, quality);

  const args = ["remotion", "render", "Reel", outPath];
  if (quality === "draft") {
    // Half the linear resolution (~quarter the pixels) and a cheap, fast encode.
    // crf 28 is well past visually-lossless but plenty to judge layout/timing.
    args.push("--scale=0.5", "--crf=28");
  }

  await run("npx", args, { cwd: projectPath, maxBuffer: MAX_BUFFER });

  // Deliverables get mixed to the loudness every platform normalizes to, so
  // they aren't quietly re-gained (or left noticeably quiet) after upload.
  // Drafts skip it: it's a finishing step, and draft renders are for looking.
  if (normalizeAudio && quality === "final" && (await probe(outPath)).hasAudio) {
    await normalizeLoudness(outPath);
  }

  return outPath;
}

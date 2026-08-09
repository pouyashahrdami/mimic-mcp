import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeLoudness, probe } from "../ffmpeg.js";
import { recipeSchema, type Recipe } from "../recipe.js";

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export type RenderQuality = "draft" | "final";

/** The project's own recipe — the source of truth for segment timing and fps. */
async function loadProjectRecipe(
  projectPath: string,
  displayDir: string
): Promise<Recipe> {
  const recipeFile = path.join(projectPath, "recipe.json");
  const raw = await readFile(recipeFile, "utf8").catch(() => {
    throw new Error(
      `${displayDir} doesn't look like a scaffolded reel project (no recipe.json). Run scaffold_reel first.`
    );
  });
  return recipeSchema.parse(JSON.parse(raw));
}

/** Remotion pulls a headless Chromium on first install — the slow first render. */
async function ensureDeps(projectPath: string): Promise<void> {
  const hasDeps = await access(path.join(projectPath, "node_modules"))
    .then(() => true)
    .catch(() => false);
  if (hasDeps) return;
  await run("npm", ["install", "--no-fund", "--no-audit"], {
    cwd: projectPath,
    maxBuffer: MAX_BUFFER,
  });
}

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
 *
 * A partial render gets its own filename: it is a work-in-progress view, and
 * must never overwrite the finished reel review_render and the user look for.
 */
export function renderOutputPath(
  projectDir: string,
  quality: RenderQuality,
  segments?: number[]
): string {
  const name =
    segments && segments.length > 0
      ? `reel-segments-${[...segments].sort((a, b) => a - b).join("-")}.mp4`
      : quality === "draft"
        ? "reel-draft.mp4"
        : "reel.mp4";
  return path.join(path.resolve(projectDir), "out", name);
}

export interface FrameRange {
  /** Inclusive first frame. */
  from: number;
  /** Inclusive last frame. */
  to: number;
}

/**
 * The frame span covering a set of segments, so a fix to segment 4 can be
 * re-rendered on its own instead of paying for the whole reel every round.
 * Non-contiguous indices render as one span across them — the renderer takes a
 * single range, and the gap is usually worth seeing anyway.
 */
export function segmentFrameRange(
  segments: { start: number; end: number }[],
  indices: number[],
  fps: number
): FrameRange {
  if (indices.length === 0) {
    throw new Error("no segments given — pass at least one segment index to render");
  }
  const bad = indices.filter(
    (i) => !Number.isInteger(i) || i < 0 || i >= segments.length
  );
  if (bad.length > 0) {
    throw new Error(
      `segment index ${bad.join(", ")} out of range — the recipe has ${segments.length} ` +
        `segment(s), so indices run 0..${segments.length - 1}`
    );
  }

  const chosen = indices.map((i) => segments[i]);
  const from = Math.round(Math.min(...chosen.map((s) => s.start)) * fps);
  // -1 because the range is inclusive and a segment's end is the next one's start.
  const to = Math.max(from, Math.round(Math.max(...chosen.map((s) => s.end)) * fps) - 1);
  return { from, to };
}

export async function renderReel(
  projectDir: string,
  quality: RenderQuality = "final",
  {
    normalizeAudio = true,
    segments,
  }: { normalizeAudio?: boolean; segments?: number[] } = {}
): Promise<string> {
  const projectPath = path.resolve(projectDir);

  const recipe = await loadProjectRecipe(projectPath, projectDir);
  await ensureDeps(projectPath);

  const outPath = renderOutputPath(projectPath, quality, segments);

  const args = ["remotion", "render", "Reel", outPath];
  if (quality === "draft") {
    // Half the linear resolution (~quarter the pixels) and a cheap, fast encode.
    // crf 28 is well past visually-lossless but plenty to judge layout/timing.
    args.push("--scale=0.5", "--crf=28");
  }
  const isPartial = segments != null && segments.length > 0;
  if (isPartial) {
    const { from, to } = segmentFrameRange(recipe.segments, segments, recipe.output.fps);
    args.push(`--frames=${from}-${to}`);
  }

  await run("npx", args, { cwd: projectPath, maxBuffer: MAX_BUFFER });

  // Deliverables get mixed to the loudness every platform normalizes to, so
  // they aren't quietly re-gained (or left noticeably quiet) after upload.
  // Drafts and partial renders skip it: it's a finishing step, and normalizing
  // a fragment would set its level from material the full reel doesn't have.
  if (
    normalizeAudio &&
    quality === "final" &&
    !isPartial &&
    (await probe(outPath)).hasAudio
  ) {
    await normalizeLoudness(outPath);
  }

  return outPath;
}

/**
 * Render one frame to a PNG — the cheapest possible look at a layout change.
 * Defaults to the middle of the given segment, where its caption is fully on.
 */
export async function renderStill(
  projectDir: string,
  { segment, atSeconds }: { segment?: number; atSeconds?: number } = {}
): Promise<string> {
  const projectPath = path.resolve(projectDir);
  const recipe = await loadProjectRecipe(projectPath, projectDir);

  let seconds: number;
  if (atSeconds != null) {
    seconds = atSeconds;
  } else if (segment != null) {
    const { from, to } = segmentFrameRange(recipe.segments, [segment], recipe.output.fps);
    seconds = (from + to) / 2 / recipe.output.fps;
  } else {
    throw new Error("pass either segment (an index) or at_seconds to pick the frame");
  }

  if (seconds < 0 || seconds > recipe.output.durationSeconds) {
    throw new Error(
      `${seconds}s is outside the reel, which runs 0..${recipe.output.durationSeconds}s`
    );
  }

  const frame = Math.round(seconds * recipe.output.fps);
  const outPath = path.join(projectPath, "out", `still-${frame}.png`);

  await ensureDeps(projectPath);
  await run("npx", ["remotion", "still", "Reel", outPath, `--frame=${frame}`], {
    cwd: projectPath,
    maxBuffer: MAX_BUFFER,
  });

  return outPath;
}

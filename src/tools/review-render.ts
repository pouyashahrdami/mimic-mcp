import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractFrame, probe } from "../ffmpeg.js";
import { mapLimit } from "../parallel.js";
import { recipeSchema } from "../recipe.js";
import {
  checkSafeArea,
  PLATFORMS,
  PLATFORM_NAMES,
  type SafeAreaIssue,
} from "../safe-area.js";
import { diffSpecs, type SpecDiff } from "../spec-diff.js";
import type { StyleSpec } from "../style-spec.js";
import { analyzeReference } from "./analyze-reference.js";

/**
 * The reference's style spec, reusing the one a previous review round measured
 * when it's still current. The reference never changes across the review →
 * fix recipe → re-render loop, so re-running the full analysis (cut detection,
 * OCR, beats) on it every round only burns time; the render's analysis is
 * always fresh.
 */
async function referenceStyleSpec(
  referenceVideo: string,
  reviewDir: string
): Promise<StyleSpec> {
  const base = path.basename(referenceVideo, path.extname(referenceVideo));
  // "reel" is the render's own analysis dir — a reference named reel.mp4
  // would collide with it, so analyze fresh rather than trust the cache.
  if (base !== "reel") {
    const specFile = path.join(reviewDir, ".mimic-mcp", base, "style-spec.json");
    try {
      const [specStat, videoStat] = await Promise.all([
        stat(specFile),
        stat(referenceVideo),
      ]);
      if (specStat.mtimeMs > videoStat.mtimeMs) {
        return JSON.parse(await readFile(specFile, "utf8")) as StyleSpec;
      }
    } catch {
      // No cached spec yet — fall through to a full analysis.
    }
  }
  return (await analyzeReference(referenceVideo, reviewDir)).styleSpec;
}

export interface ReviewFrame {
  segment: number;
  caption: string;
  atSeconds: number;
  renderedFrame: string;
  referenceFrame?: string;
}

/**
 * Review a render two ways: side-by-side frames per segment for visual
 * judgment, and — when a reference video is given — a MEASURED fidelity
 * report: the render goes through the same analyzer as the reference and the
 * two style specs are diffed numerically (cut timing, transition kinds,
 * motion, caption timing/position/size), each deviation naming the recipe
 * field to fix.
 */
export async function reviewRender(
  projectDir: string,
  referenceVideo?: string,
  platformName?: string
): Promise<{
  frames: ReviewFrame[];
  fidelity?: SpecDiff;
  safeArea?: { platform: string; issues: SafeAreaIssue[] };
  instructions: string;
}> {
  const platform = platformName ? PLATFORMS[platformName] : undefined;
  if (platformName && !platform) {
    throw new Error(
      `unknown platform "${platformName}" — expected one of: ${PLATFORM_NAMES.join(", ")}`
    );
  }

  const outVideo = path.join(projectDir, "out", "reel.mp4");
  await access(outVideo).catch(() => {
    throw new Error(`No render found at ${outVideo}. Run render_reel first.`);
  });

  const recipe = recipeSchema.parse(
    JSON.parse(await readFile(path.join(projectDir, "recipe.json"), "utf8"))
  );

  const reviewDir = path.join(projectDir, "out", "review");
  await mkdir(reviewDir, { recursive: true });

  const referenceDuration = referenceVideo
    ? (await probe(referenceVideo)).durationSeconds
    : 0;

  const frames = await mapLimit(recipe.segments, 4, async (segment, i) => {
    const mid = (segment.start + segment.end) / 2;

    const renderedFrame = path.join(reviewDir, `segment-${i}-render.jpg`);
    await extractFrame(outVideo, mid, renderedFrame);

    let referenceFrame: string | undefined;
    if (referenceVideo) {
      // Same relative position, so a 10s render lines up with a 30s reference.
      const refTime = (mid / recipe.output.durationSeconds) * referenceDuration;
      referenceFrame = path.join(reviewDir, `segment-${i}-reference.jpg`);
      await extractFrame(referenceVideo, refTime, referenceFrame);
    }

    return {
      segment: i,
      caption: segment.caption,
      atSeconds: Math.round(mid * 100) / 100,
      renderedFrame,
      referenceFrame,
    } satisfies ReviewFrame;
  });

  // The measured half of the review: analyze the render with the exact same
  // pipeline as the reference and diff the resulting specs. The render's own
  // spec also carries the caption boxes the safe-area check needs, so one
  // analysis serves both.
  let fidelity: SpecDiff | undefined;
  let safeArea: { platform: string; issues: SafeAreaIssue[] } | undefined;
  let renderSpec: StyleSpec | undefined;

  if (referenceVideo || platform) {
    renderSpec = (await analyzeReference(outVideo, reviewDir)).styleSpec;
  }
  if (referenceVideo && renderSpec) {
    fidelity = diffSpecs(await referenceStyleSpec(referenceVideo, reviewDir), renderSpec);
  }
  if (platform && renderSpec?.captions) {
    safeArea = {
      platform: platform.label,
      issues: checkSafeArea(renderSpec.captions, platform),
    };
  }

  const fidelityNote = fidelity
    ? `Fidelity score: ${fidelity.score}/100 (measured, not eyeballed). ` +
      (fidelity.issues.length > 0
        ? "Fix the `fidelity.issues` list first — each names the recipe field to change. "
        : "No measured deviations. ")
    : "";

  const safeAreaNote = platform
    ? safeArea
      ? safeArea.issues.length > 0
        ? `${safeArea.issues.length} caption(s) sit under ${safeArea.platform}'s own UI — ` +
          "see `safeArea.issues`. The reel can score 100 on fidelity and still ship with " +
          "its text behind the caption bar, so fix these before delivering. "
        : `Nothing collides with ${safeArea.platform}'s UI. `
      : "Safe-area check skipped: it reads the render's OCR caption track, which needs " +
        "the macOS Vision pass. Judge caption placement from the frames instead. "
    : "";

  const visualNote = referenceVideo
    ? "Then open each rendered frame next to its reference frame and compare like an editor: " +
      "caption size and position, card size and position, pacing, overall look. " +
      "If something is off, edit recipe.json inside the project and call render_reel again. " +
      "One or two fix rounds is normal; stop when the score holds and the frames look right."
    : "Open each rendered frame and critique it against your own design intent, like an art " +
      "director: clear type hierarchy, one focal point per page, nothing clipped, colors that " +
      "hold together across pages. Fix recipe.json (or the scene files in src/scenes/) and " +
      "call render_reel again. One or two fix rounds is normal.";

  return {
    frames,
    ...(fidelity ? { fidelity } : {}),
    ...(safeArea ? { safeArea } : {}),
    instructions: fidelityNote + safeAreaNote + visualNote,
  };
}

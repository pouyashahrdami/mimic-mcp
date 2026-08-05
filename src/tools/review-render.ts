import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractFrame, probe } from "../ffmpeg.js";
import { mapLimit } from "../parallel.js";
import { recipeSchema } from "../recipe.js";
import { diffSpecs, type SpecDiff } from "../spec-diff.js";
import { analyzeReference } from "./analyze-reference.js";

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
  referenceVideo?: string
): Promise<{ frames: ReviewFrame[]; fidelity?: SpecDiff; instructions: string }> {
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
  // pipeline as the reference and diff the resulting specs.
  let fidelity: SpecDiff | undefined;
  if (referenceVideo) {
    const refAnalysis = await analyzeReference(referenceVideo, reviewDir);
    const renderAnalysis = await analyzeReference(outVideo, reviewDir);
    fidelity = diffSpecs(refAnalysis.styleSpec, renderAnalysis.styleSpec);
  }

  const fidelityNote = fidelity
    ? `Fidelity score: ${fidelity.score}/100 (measured, not eyeballed). ` +
      (fidelity.issues.length > 0
        ? "Fix the `fidelity.issues` list first — each names the recipe field to change. "
        : "No measured deviations. ")
    : "";

  return {
    frames,
    ...(fidelity ? { fidelity } : {}),
    instructions:
      fidelityNote +
      "Then open each rendered frame next to its reference frame and compare like an editor: " +
      "caption size and position, card size and position, pacing, overall look. " +
      "If something is off, edit recipe.json inside the project and call render_reel again. " +
      "One or two fix rounds is normal; stop when the score holds and the frames look right.",
  };
}

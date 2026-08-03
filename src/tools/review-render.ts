import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractFrame, probe } from "../ffmpeg.js";
import { recipeSchema } from "../recipe.js";

export interface ReviewFrame {
  segment: number;
  caption: string;
  atSeconds: number;
  renderedFrame: string;
  referenceFrame?: string;
}

/**
 * Pull one frame per segment out of the rendered reel — and, when a reference
 * video is given, the frame at the same relative position in the reference —
 * so the agent can put them side by side and critique its own work.
 */
export async function reviewRender(
  projectDir: string,
  referenceVideo?: string
): Promise<{ frames: ReviewFrame[]; instructions: string }> {
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

  const frames: ReviewFrame[] = [];
  for (const [i, segment] of recipe.segments.entries()) {
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

    frames.push({
      segment: i,
      caption: segment.caption,
      atSeconds: Math.round(mid * 100) / 100,
      renderedFrame,
      referenceFrame,
    });
  }

  return {
    frames,
    instructions:
      "Open each rendered frame next to its reference frame and compare like an editor: " +
      "caption size and position, card size and position, pacing, overall look. " +
      "If something is off, edit recipe.json inside the project and call render_reel again. " +
      "One or two fix rounds is normal; stop when it holds up.",
  };
}

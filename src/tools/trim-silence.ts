import { mkdir } from "node:fs/promises";
import path from "node:path";
import { trimSilence, type SilenceTrimResult } from "../ffmpeg.js";

/**
 * Preprocess talking-head footage by cutting the silent gaps, producing a
 * tighter jump-cut clip the agent can then use as background in a recipe.
 * Output lands in `.reels-maker/<video-name>/<name>-tight.mp4` next to the cwd.
 */
export async function trimSilenceTool(
  videoPath: string,
  workDir: string,
  options: { thresholdDb?: number; minSilenceSeconds?: number } = {}
): Promise<SilenceTrimResult & { nextStep: string }> {
  const base = path.basename(videoPath, path.extname(videoPath));
  const outDir = path.join(workDir, ".reels-maker", base);
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${base}-tight.mp4`);

  const result = await trimSilence(
    videoPath,
    outPath,
    options.thresholdDb,
    options.minSilenceSeconds
  );

  return {
    ...result,
    nextStep:
      `Removed ${result.removedSeconds}s of silence (${result.originalSeconds}s → ${result.trimmedSeconds}s). ` +
      `Use ${outPath} as your footage (background.video) when building the recipe.`,
  };
}

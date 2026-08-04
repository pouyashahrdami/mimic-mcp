import { mkdir } from "node:fs/promises";
import path from "node:path";
import { extractAudio, probe } from "../ffmpeg.js";

/**
 * Pull the soundtrack out of a video into `.mimic-mcp/` as an .m4a.
 * Returns the absolute path to the extracted file.
 */
export async function extractMusic(
  videoPath: string,
  workDir: string
): Promise<string> {
  const info = await probe(videoPath);
  if (!info.hasAudio) {
    throw new Error(`${videoPath} has no audio track to extract`);
  }

  const outDir = path.join(workDir, ".mimic-mcp");
  await mkdir(outDir, { recursive: true });

  const outPath = path.join(
    outDir,
    `${path.basename(videoPath, path.extname(videoPath))}-audio.m4a`
  );
  await extractAudio(videoPath, outPath);
  return outPath;
}

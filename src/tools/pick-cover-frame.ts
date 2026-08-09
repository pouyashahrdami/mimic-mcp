import { mkdir } from "node:fs/promises";
import path from "node:path";
import { decodeGrayFrames, extractFrame, probe } from "../ffmpeg.js";
import {
  frameStats,
  rankCoverFrames,
  scoreCoverFrame,
  type ScoredFrame,
} from "../frame-quality.js";

/** Enough pixels to tell a sharp frame from a smeared one. */
const ANALYSIS_WIDTH = 128;
const ANALYSIS_HEIGHT = 72;

/** Candidates to consider across the reel. More costs a longer decode. */
const DEFAULT_CANDIDATES = 24;
const MAX_CANDIDATES = 120;

export interface CoverFrameResult {
  /** Full-resolution still of the winning frame. */
  coverFile: string;
  atSeconds: number;
  score: number;
  /** Every candidate, best first — so a different pick can be made by eye. */
  candidates: ScoredFrame[];
  instructions: string;
}

/**
 * Pick the frame to lead with. The cover is seen at thumbnail size before
 * anything else and platforms otherwise default to frame 0, which on a reel
 * that opens on a dip-to-black is a black square.
 *
 * Output lands in `.mimic-mcp/<video-name>/<name>-cover.jpg` next to the cwd.
 */
export async function pickCoverFrame(
  videoPath: string,
  workDir: string,
  { candidates = DEFAULT_CANDIDATES }: { candidates?: number } = {}
): Promise<CoverFrameResult> {
  if (candidates < 2 || candidates > MAX_CANDIDATES) {
    throw new Error(`candidates must be between 2 and ${MAX_CANDIDATES}`);
  }

  const info = await probe(videoPath);
  if (info.videoSeconds <= 0) {
    throw new Error(`${videoPath} has no video frames to choose from`);
  }

  // Sample evenly across the reel at a fixed rate rather than seeking to each
  // candidate: one decode pass beats N seeks.
  const fps = candidates / info.videoSeconds;
  const { frames } = await decodeGrayFrames(videoPath, {
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
    fps,
  });

  if (frames.length === 0) {
    throw new Error(`Decoded no frames from ${videoPath} — is it a valid video?`);
  }

  const scored: ScoredFrame[] = frames.map((frame, i) => {
    const stats = frameStats(frame, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    return {
      atSeconds: Math.round((i / fps) * 100) / 100,
      stats,
      ...scoreCoverFrame(stats),
    };
  });

  const ranked = rankCoverFrames(scored);
  const best = ranked[0];

  const base = path.basename(videoPath, path.extname(videoPath));
  const outDir = path.join(workDir, ".mimic-mcp", base);
  await mkdir(outDir, { recursive: true });
  const coverFile = path.join(outDir, `${base}-cover.jpg`);
  await extractFrame(videoPath, best.atSeconds, coverFile);

  return {
    coverFile,
    atSeconds: best.atSeconds,
    score: best.score,
    candidates: ranked,
    instructions:
      `Best frame at ${best.atSeconds}s, written full-resolution to ${coverFile}. ` +
      "Scored on exposure, contrast and edge detail — what survives being shrunk to a " +
      "thumbnail. It does NOT know what the frame shows, so look at it: a sharp, punchy " +
      "frame of the back of someone's head still wins on the numbers. `candidates` lists " +
      "every frame considered, best first, if you want to pick a different one by eye.",
  };
}

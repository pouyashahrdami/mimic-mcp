import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Test-only helpers that synthesize tiny media files with ffmpeg so the
 * detectors can be tested against known ground truth. Excluded from the build.
 */

export interface ColorSegment {
  color: string;
  seconds: number;
}

/** Concatenate flat color clips into one video — hard cuts at known times. */
export async function makeCutVideo(
  outPath: string,
  segments: ColorSegment[],
  { size = "160x288", fps = 30 } = {}
): Promise<void> {
  const inputs = segments.flatMap((s) => [
    "-f", "lavfi",
    "-i", `color=c=${s.color}:s=${size}:d=${s.seconds}:r=${fps}`,
  ]);
  const labels = segments.map((_, i) => `[${i}:v]`).join("");
  await run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", `${labels}concat=n=${segments.length}:v=1:a=0[v]`,
    "-map", "[v]",
    outPath,
  ]);
}

/**
 * Audio file with sharp sine "clicks" at the given times over near-silence —
 * a beat grid with known ground truth.
 */
export async function makeClickTrack(
  outPath: string,
  clickTimes: number[],
  durationSeconds: number
): Promise<void> {
  const clicks = clickTimes
    .map(
      (t, i) =>
        `sine=frequency=880:duration=0.05[c${i}];` +
        `[c${i}]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[d${i}]`
    )
    .join(";");
  const mixIn = clickTimes.map((_, i) => `[d${i}]`).join("");
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=22050:cl=stereo:d=${durationSeconds}`,
    "-filter_complex",
    `${clicks};[0:a]${mixIn}amix=inputs=${clickTimes.length + 1}:normalize=0[a]`,
    "-map", "[a]",
    "-t", String(durationSeconds),
    outPath,
  ]);
}

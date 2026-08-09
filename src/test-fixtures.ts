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

/**
 * Concatenate flat color clips into one video — hard cuts at known times.
 * `audioSeconds` adds a silent audio track of that length; longer than the
 * video, it reproduces the common real-world case where the container
 * duration outruns the last video frame.
 */
export async function makeCutVideo(
  outPath: string,
  segments: ColorSegment[],
  { size = "160x288", fps = 30, audioSeconds = 0 } = {}
): Promise<void> {
  const inputs = segments.flatMap((s) => [
    "-f", "lavfi",
    "-i", `color=c=${s.color}:s=${size}:d=${s.seconds}:r=${fps}`,
  ]);
  const audioInputs = audioSeconds
    ? ["-f", "lavfi", "-i", `anullsrc=r=22050:cl=stereo:d=${audioSeconds}`]
    : [];
  const labels = segments.map((_, i) => `[${i}:v]`).join("");
  await run("ffmpeg", [
    "-y",
    ...inputs,
    ...audioInputs,
    "-filter_complex", `${labels}concat=n=${segments.length}:v=1:a=0[v]`,
    "-map", "[v]",
    ...(audioSeconds ? ["-map", `${segments.length}:a`] : []),
    outPath,
  ]);
}

/**
 * Static background with a small box that changes color every `secondsEach` —
 * an on-screen graphic swapping while the camera holds (the stats-card look).
 */
export async function makeOverlayVideo(
  outPath: string,
  boxColors: string[],
  secondsEach: number,
  { size = "160x288", fps = 30 } = {}
): Promise<void> {
  const total = boxColors.length * secondsEach;
  const boxes = boxColors
    .map(
      (c, i) =>
        `drawbox=x=30:y=60:w=80:h=40:c=${c}:t=fill:` +
        `enable='between(t,${i * secondsEach},${(i + 1) * secondsEach})'`
    )
    .join(",");
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=gray:s=${size}:d=${total}:r=${fps}`,
    "-vf", boxes,
    outPath,
  ]);
}

/** Two color clips joined by an xfade dissolve starting at `offsetSeconds`. */
export async function makeFadeVideo(
  outPath: string,
  {
    colorA = "black",
    colorB = "white",
    offsetSeconds = 2,
    fadeSeconds = 0.3,
    size = "160x288",
    fps = 30,
  } = {}
): Promise<void> {
  const aSeconds = offsetSeconds + fadeSeconds;
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${colorA}:s=${size}:d=${aSeconds}:r=${fps}`,
    "-f", "lavfi",
    "-i", `color=c=${colorB}:s=${size}:d=2:r=${fps}`,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${fadeSeconds}:offset=${offsetSeconds}[v]`,
    "-map", "[v]",
    outPath,
  ]);
}

/**
 * Flat-color video over a continuous tone that goes silent for each of `gaps` —
 * the shape silencedetect is built to find, with known ground truth.
 */
export async function makeVideoWithSilentGaps(
  outPath: string,
  gaps: { start: number; end: number }[],
  durationSeconds: number,
  { size = "160x288", fps = 30 } = {}
): Promise<void> {
  const mute = gaps
    .map((g) => `volume=enable='between(t,${g.start},${g.end})':volume=0`)
    .join(",");
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=blue:s=${size}:d=${durationSeconds}:r=${fps}`,
    "-f", "lavfi",
    "-i", `sine=frequency=440:duration=${durationSeconds}`,
    ...(mute ? ["-af", mute] : []),
    "-t", String(durationSeconds),
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

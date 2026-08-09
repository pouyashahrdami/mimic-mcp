import { execFile } from "node:child_process";
import { readdir, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { estimateBpm, frameChangeSamples, pickSceneCuts, type SceneCut } from "./analysis.js";
import {
  applyFilter,
  isNormalizable,
  measureFilter,
  parseLoudnorm,
  TARGET_LUFS,
  type LoudnessMeasurement,
} from "./loudness.js";

const run = promisify(execFile);

// ffmpeg writes filter/progress output to stderr, so we keep both streams.
const MAX_BUFFER = 64 * 1024 * 1024;

export class FfmpegMissingError extends Error {
  constructor(binary: string) {
    super(
      `${binary} not found on PATH. Install it first (macOS: \`brew install ffmpeg\`).`
    );
  }
}

async function exec(binary: "ffmpeg" | "ffprobe", args: string[]) {
  try {
    return await run(binary, args, { maxBuffer: MAX_BUFFER });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FfmpegMissingError(binary);
    }
    throw err;
  }
}

export interface VideoInfo {
  /** Container duration — the longest stream, often the audio. */
  durationSeconds: number;
  /**
   * Duration of the video stream itself. Can be shorter than the container
   * when the audio runs longer; frames only exist up to here.
   */
  videoSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioCodec?: string;
}

export async function probe(videoPath: string): Promise<VideoInfo> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);

  const data = JSON.parse(stdout);
  const video = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!video) {
    throw new Error(`No video stream found in ${videoPath}`);
  }
  const audio = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");

  // avg_frame_rate comes as a fraction like "30000/1001"
  const [num, den] = String(video.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;

  const durationSeconds = Number(data.format?.duration ?? 0);
  return {
    durationSeconds,
    videoSeconds: Number(video.duration ?? durationSeconds) || durationSeconds,
    width: Number(video.width),
    height: Number(video.height),
    fps: Math.round(fps * 100) / 100,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
  };
}

/** Duration (seconds) of any media file, including audio-only ones. */
export async function mediaDuration(mediaPath: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    mediaPath,
  ]);
  return Number(String(stdout).trim());
}

// Analysis raster: every frame is downscaled to this tiny grayscale vector.
// Small enough that even an hour of footage fits in memory, big enough that
// an on-screen card still covers several grid cells.
const ANALYSIS_WIDTH = 48;
const ANALYSIS_HEIGHT = 27;
const MAX_ANALYSIS_FPS = 30;

// Motion estimation needs more pixels than cut detection: a slow punch-in
// moves edge content by fractions of a pixel per frame, and gradient flow
// resolves sub-pixel shifts better with more samples.
const MOTION_WIDTH = 96;
const MOTION_HEIGHT = 54;

export interface GrayFrames {
  frames: Uint8Array[];
  width: number;
  height: number;
  fps: number;
}

/** Decode a stretch of video into tiny grayscale rasters, one per frame. */
export async function decodeGrayFrames(
  videoPath: string,
  {
    width,
    height,
    fps,
    start,
    duration,
  }: { width: number; height: number; fps: number; start?: number; duration?: number }
): Promise<GrayFrames> {
  const args = ["-hide_banner"];
  // Fast seek before -i; fine here because we re-decode from the keyframe.
  if (start !== undefined) args.push("-ss", String(start));
  args.push("-i", videoPath);
  if (duration !== undefined) args.push("-t", String(duration));
  args.push(
    "-vf", `fps=${fps},scale=${width}:${height},format=gray`,
    "-f", "rawvideo",
    "-"
  );

  const { stdout } = await run("ffmpeg", args, {
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new FfmpegMissingError("ffmpeg");
    throw err;
  });

  const frameBytes = width * height;
  const raw = stdout as unknown as Buffer;
  const frames: Uint8Array[] = [];
  for (let off = 0; off + frameBytes <= raw.length; off += frameBytes) {
    frames.push(new Uint8Array(raw.buffer, raw.byteOffset + off, frameBytes));
  }
  return { frames, width, height, fps };
}

/**
 * Decode a single shot at motion-estimation resolution. Callers feed the
 * result through accumulateMotion/summarizeShotMotion from analysis.ts.
 */
export async function decodeShotForMotion(
  videoPath: string,
  startSeconds: number,
  endSeconds: number,
  videoFps: number
): Promise<GrayFrames> {
  const fps = Math.min(videoFps || MAX_ANALYSIS_FPS, MAX_ANALYSIS_FPS);
  return decodeGrayFrames(videoPath, {
    width: MOTION_WIDTH,
    height: MOTION_HEIGHT,
    fps,
    start: startSeconds,
    duration: endSeconds - startSeconds,
  });
}

/**
 * Detect scene changes by decoding EVERY frame to a small grayscale vector
 * and diffing consecutive frames (see frameChangeSamples) — nothing between
 * samples can be missed, and swaps animated over a few frames register at
 * full strength. Detections are adaptively thresholded, merged within
 * ~0.15s, and classified cut / fade / overlay from how much of the frame
 * changed and how the change decayed.
 */
export async function detectSceneCuts(videoPath: string): Promise<SceneCut[]> {
  const info = await probe(videoPath);
  const fps = Math.min(info.fps || MAX_ANALYSIS_FPS, MAX_ANALYSIS_FPS);
  const { frames } = await decodeGrayFrames(videoPath, {
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
    fps,
  });
  return pickSceneCuts(
    frameChangeSamples(frames, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, fps)
  );
}

export interface BeatAnalysis {
  /** Onset (beat/hit) timestamps in seconds. */
  beats: number[];
  /** Tempo estimated by autocorrelating the onsets, or null if aperiodic. */
  bpm: number | null;
}

/**
 * Estimate musical onsets ("beats") by tracking short-window RMS energy and
 * flagging the moments energy jumps — percussive hits, downbeats, drops. This
 * is a transient/onset detector, not a full tempo tracker, but it's enough for
 * an agent to snap segment cuts onto the beat. Pure ffmpeg, no extra deps.
 *
 * `windowSeconds` sets the time resolution; `riseDb` is how much louder a window
 * must be than the previous to count as an onset.
 */
export async function detectBeats(
  videoPath: string,
  windowSeconds = 0.046,
  riseDb = 3
): Promise<BeatAnalysis> {
  // asetnsamples can't take seconds, so convert the window to a sample count at
  // a fixed rate we also force with aresample.
  const sampleRate = 22050;
  const nSamples = Math.max(1, Math.round(windowSeconds * sampleRate));

  const { stderr } = await exec("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-af",
    `aresample=${sampleRate},asetnsamples=n=${nSamples}:p=0,` +
      `astats=metadata=1:reset=1,` +
      `ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    "-f", "null",
    "-",
  ]);

  // ametadata prints a `pts_time:<t>` line, then a `lavfi.astats.Overall.RMS_level=<db>`
  // line per window. Pair them up into (time, energy) samples.
  const times: number[] = [];
  const levels: number[] = [];
  let pendingTime: number | null = null;
  for (const line of stderr.split("\n")) {
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      pendingTime = Number(timeMatch[1]);
      continue;
    }
    const rmsMatch = line.match(/RMS_level=(-?[\d.]+|-inf)/);
    if (rmsMatch && pendingTime != null) {
      // Silence reports as "-inf"; floor it so flux math stays finite.
      const db = rmsMatch[1] === "-inf" ? -120 : Number(rmsMatch[1]);
      times.push(pendingTime);
      levels.push(db);
      pendingTime = null;
    }
  }

  // An onset = a window whose energy rose by >= the threshold over the previous
  // one and is a local peak of that rise (so a single hit yields one beat, not
  // a run).
  const onsetsAt = (threshold: number): number[] => {
    const found: number[] = [];
    for (let i = 1; i < levels.length; i++) {
      const rise = levels[i] - levels[i - 1];
      const nextRise = i + 1 < levels.length ? levels[i + 1] - levels[i] : 0;
      if (rise >= threshold && rise >= nextRise) {
        found.push(Math.round(times[i] * 100) / 100);
      }
    }
    return found;
  };

  // Heavily compressed tracks (most reel music) barely move in RMS, so a fixed
  // threshold under-fires. Start at riseDb and relax by 0.5dB until the onset
  // density looks like an actual beat grid (~1.5/s covers 90+ BPM) or we hit
  // the floor.
  const durationSeconds = times.length ? times[times.length - 1] : 0;
  let beats = onsetsAt(riseDb);
  for (let t = riseDb - 0.5; t >= 1 && beats.length < durationSeconds * 1.5; t -= 0.5) {
    beats = onsetsAt(t);
  }

  return { beats, bpm: estimateBpm(beats) };
}

export interface SilenceTrimResult {
  outPath: string;
  originalSeconds: number;
  trimmedSeconds: number;
  removedSeconds: number;
  cutsRemoved: number;
}

/**
 * Remove silent gaps from a video, concatenating the spoken parts into a
 * jump-cut edit — the tedious pass every talking-head creator does by hand.
 *
 * `thresholdDb` is the loudness below which audio counts as silence (-30 is a
 * good default for speech); `minSilenceSeconds` is how long a gap must be before
 * it's cut, and `padSeconds` leaves a little breathing room around each kept
 * chunk so words aren't clipped.
 */
export async function trimSilence(
  videoPath: string,
  outPath: string,
  thresholdDb = -30,
  minSilenceSeconds = 0.5,
  padSeconds = 0.05
): Promise<SilenceTrimResult> {
  const info = await probe(videoPath);
  if (!info.hasAudio) {
    throw new Error("Video has no audio track, so there's no silence to detect.");
  }

  // silencedetect prints silence_start / silence_end|silence_duration to stderr.
  const { stderr } = await exec("ffmpeg", [
    "-i", videoPath,
    "-af", `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSeconds}`,
    "-f", "null",
    "-",
  ]);

  const starts: number[] = [];
  const ends: number[] = [];
  for (const m of stderr.matchAll(/silence_start:\s*([\d.]+)/g)) starts.push(Number(m[1]));
  for (const m of stderr.matchAll(/silence_end:\s*([\d.]+)/g)) ends.push(Number(m[1]));

  // Invert the silent ranges into the spoken ranges we want to keep.
  const keep: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < starts.length; i++) {
    const sStart = starts[i];
    const sEnd = ends[i] ?? info.durationSeconds;
    if (sStart - cursor > 0.01) {
      keep.push({ start: Math.max(0, cursor - padSeconds), end: sStart + padSeconds });
    }
    cursor = sEnd;
  }
  if (info.durationSeconds - cursor > 0.01) {
    keep.push({ start: Math.max(0, cursor - padSeconds), end: info.durationSeconds });
  }

  if (keep.length === 0) {
    throw new Error("The whole clip registered as silence — try a lower thresholdDb.");
  }

  // Build a filter_complex that trims each kept range from video+audio and
  // concatenates the pieces back into one continuous clip.
  const parts: string[] = [];
  const concatIn: string[] = [];
  keep.forEach((k, i) => {
    parts.push(
      `[0:v]trim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
    );
    concatIn.push(`[v${i}][a${i}]`);
  });
  const filter =
    parts.join(";") +
    ";" +
    concatIn.join("") +
    `concat=n=${keep.length}:v=1:a=1[outv][outa]`;

  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "[outa]",
    outPath,
  ]);

  const trimmed = await probe(outPath);
  return {
    outPath,
    originalSeconds: Math.round(info.durationSeconds * 100) / 100,
    trimmedSeconds: Math.round(trimmed.durationSeconds * 100) / 100,
    removedSeconds: Math.round((info.durationSeconds - trimmed.durationSeconds) * 100) / 100,
    cutsRemoved: starts.length,
  };
}

export type ReframeMode = "crop" | "pad";

/**
 * Re-frame a video to a new width/height. "crop" scales to cover then center-
 * crops (fills the frame, loses edges); "pad" fits the whole frame inside a
 * blurred, scaled-up copy of itself (keeps everything, adds cinematic bars).
 */
export async function reframe(
  videoPath: string,
  outPath: string,
  width: number,
  height: number,
  mode: ReframeMode = "crop"
): Promise<void> {
  const filter =
    mode === "crop"
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},setsar=1`
      : // Blurred fill behind the letterboxed original — the "no crop" look.
        `split=2[bg][fg];` +
        `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},boxblur=luma_radius=40:luma_power=1[bgb];` +
        `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1`;

  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vf", filter,
    "-c:a", "copy",
    outPath,
  ]);
}

/**
 * Render a filmstrip contact sheet: `plan.frameTimes.length` tiles sampled
 * evenly across the span, tiled into a `plan.cols` x `plan.rows` grid in one
 * JPEG. One image shows a whole motion arc — far easier to read punch-ins,
 * pans, and transitions from than separated stills.
 */
export async function extractFilmstrip(
  videoPath: string,
  start: number,
  outPath: string,
  plan: { fps: number; frameTimes: number[]; cols: number; rows: number },
  tileWidth = 270
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-ss", String(start),
    "-i", videoPath,
    "-vf",
    `fps=${plan.fps},scale=${tileWidth}:-1,tile=${plan.cols}x${plan.rows}`,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
  ]);
}

/**
 * Dump frames at `fps` into numbered JPEGs for OCR. Full resolution — small
 * caption text needs the pixels. Returns each frame's timestamp and path.
 */
export async function extractFramesForOcr(
  videoPath: string,
  outDir: string,
  fps: number,
  maxFrames: number
): Promise<{ time: number; file: string }[]> {
  const pattern = path.join(outDir, "ocr-%04d.jpg");
  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vf", `fps=${fps}`,
    "-frames:v", String(maxFrames),
    "-q:v", "3",
    pattern,
  ]);
  const files = (await readdir(outDir))
    .filter((f) => /^ocr-\d{4}\.jpg$/.test(f))
    .sort();
  return files.map((f, i) => ({
    time: Math.round((i / fps) * 100) / 100,
    file: path.join(outDir, f),
  }));
}

/** Crop a region (normalized bbox, top-left origin) out of one frame. */
export async function extractCrop(
  videoPath: string,
  atSeconds: number,
  bbox: { x: number; y: number; w: number; h: number },
  outPath: string
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-ss", String(atSeconds),
    "-i", videoPath,
    "-vf",
    `crop=iw*${bbox.w.toFixed(4)}:ih*${bbox.h.toFixed(4)}:iw*${bbox.x.toFixed(4)}:ih*${bbox.y.toFixed(4)}`,
    "-frames:v", "1",
    "-q:v", "2",
    outPath,
  ]);
}

export async function extractFrame(
  videoPath: string,
  atSeconds: number,
  outPath: string
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-ss", String(atSeconds),
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
  ]);
}

/** Extract the audio track, re-encoded to AAC so the container is predictable. */
export async function extractAudio(
  videoPath: string,
  outPath: string
): Promise<void> {
  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-vn",
    "-c:a", "aac",
    "-b:a", "192k",
    outPath,
  ]);
}

/**
 * Normalize a rendered video's audio to broadcast/streaming loudness in place,
 * two-pass so the gain move is measured rather than dynamic (one-pass loudnorm
 * pumps on sparse material like a voiceover over a quiet bed).
 *
 * The video stream is copied, not re-encoded, so this costs an audio pass and
 * nothing else. Returns the measurement when it normalized, or null when the
 * reel is silent and there was nothing to do.
 */
export async function normalizeLoudness(
  videoPath: string,
  targetLufs: number = TARGET_LUFS
): Promise<LoudnessMeasurement | null> {
  const { stderr } = await exec("ffmpeg", [
    "-i", videoPath,
    "-af", measureFilter(),
    "-f", "null",
    "-",
  ]);

  const measurement = parseLoudnorm(stderr);
  if (!isNormalizable(measurement)) return null;

  // Write beside the target and swap, so an interrupted second pass can never
  // leave a half-written mp4 where the finished render used to be.
  const tmpPath = `${videoPath}.loudnorm${path.extname(videoPath)}`;
  await exec("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-af", applyFilter(measurement, targetLufs),
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    tmpPath,
  ]);
  await rename(tmpPath, videoPath);

  return measurement;
}

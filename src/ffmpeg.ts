import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
  durationSeconds: number;
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

  return {
    durationSeconds: Number(data.format?.duration ?? 0),
    width: Number(video.width),
    height: Number(video.height),
    fps: Math.round(fps * 100) / 100,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name,
  };
}

/**
 * Detect hard cuts by scoring frame-to-frame difference. Returns timestamps
 * (seconds) where a new shot starts. `threshold` is ffmpeg's scene score
 * (0..1); 0.3 catches typical hard cuts without firing on fast motion.
 */
export async function detectSceneCuts(
  videoPath: string,
  threshold = 0.3
): Promise<number[]> {
  const { stderr } = await exec("ffmpeg", [
    "-i", videoPath,
    "-vf", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null",
    "-",
  ]);

  const cuts: number[] = [];
  for (const match of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    cuts.push(Number(match[1]));
  }
  return cuts;
}

export interface BeatAnalysis {
  /** Onset (beat/hit) timestamps in seconds. */
  beats: number[];
  /** Estimated tempo from the median gap between onsets, or null if too few. */
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

  // An onset = a window whose energy rose by >= riseDb over the previous one and
  // is a local peak of that rise (so a single hit yields one beat, not a run).
  const beats: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    const rise = levels[i] - levels[i - 1];
    const nextRise = i + 1 < levels.length ? levels[i + 1] - levels[i] : 0;
    if (rise >= riseDb && rise >= nextRise) {
      beats.push(Math.round(times[i] * 100) / 100);
    }
  }

  // Estimate tempo from the median inter-onset interval (robust to outliers).
  let bpm: number | null = null;
  if (beats.length >= 4) {
    const gaps = beats.slice(1).map((b, i) => b - beats[i]).filter((g) => g > 0.1);
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      const medianGap = gaps[Math.floor(gaps.length / 2)];
      bpm = Math.round(60 / medianGap);
    }
  }

  return { beats, bpm };
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

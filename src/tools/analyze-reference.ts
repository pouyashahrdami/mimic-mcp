import { mkdir } from "node:fs/promises";
import path from "node:path";
import { detectBeats, detectSceneCuts, extractFrame, probe } from "../ffmpeg.js";

// More frames than this stops being "study the style" and starts being noise.
const MAX_KEYFRAMES = 12;

export interface ReferenceAnalysis {
  video: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sceneCuts: number[];
  averageShotSeconds: number;
  beats: number[];
  bpm: number | null;
  keyframes: { atSeconds: number; file: string }[];
  notes: string[];
}

/**
 * Probe the reference reel, find its cuts, and dump keyframes so the calling
 * agent can look at what each shot actually contains. Output lands in
 * `.reels-maker/<video-name>/` next to the cwd.
 */
export async function analyzeReference(
  videoPath: string,
  workDir: string
): Promise<ReferenceAnalysis> {
  const info = await probe(videoPath);
  const cuts = await detectSceneCuts(videoPath);
  const { beats, bpm } = info.hasAudio
    ? await detectBeats(videoPath)
    : { beats: [], bpm: null };

  const outDir = path.join(
    workDir,
    ".reels-maker",
    path.basename(videoPath, path.extname(videoPath))
  );
  await mkdir(outDir, { recursive: true });

  // Sample the middle of each shot — cut frames themselves are often mid-transition.
  const shotStarts = [0, ...cuts];
  const shotEnds = [...cuts, info.durationSeconds];
  let sampleTimes = shotStarts.map((s, i) => (s + shotEnds[i]) / 2);

  if (sampleTimes.length > MAX_KEYFRAMES) {
    const step = sampleTimes.length / MAX_KEYFRAMES;
    sampleTimes = Array.from(
      { length: MAX_KEYFRAMES },
      (_, i) => sampleTimes[Math.floor(i * step)]
    );
  }

  const keyframes = [];
  for (const t of sampleTimes) {
    const file = path.join(outDir, `frame-${t.toFixed(2)}s.jpg`);
    await extractFrame(videoPath, t, file);
    keyframes.push({ atSeconds: Math.round(t * 100) / 100, file });
  }

  const shotCount = cuts.length + 1;
  const averageShotSeconds =
    Math.round((info.durationSeconds / shotCount) * 100) / 100;

  const notes: string[] = [];
  if (averageShotSeconds < 0.4 && cuts.length > 6) {
    notes.push(
      "Extremely rapid cuts detected. This is either camera motion fooling the detector " +
        "OR a genuine beat-synced flash montage (common in motivational reels). " +
        "Check the keyframes: if they show clearly different scenes, it's a real montage — " +
        "recreate it with short segments using different backgroundStart offsets."
    );
  }
  if (cuts.length === 0) {
    notes.push(
      "No hard cuts detected — the reference is likely a single continuous shot, or uses only soft transitions."
    );
  }
  if (!info.hasAudio) {
    notes.push("Reference has no audio track, so extract_music will fail on it.");
  }
  if (beats.length >= 4) {
    notes.push(
      `Detected ${beats.length} musical onsets${bpm ? ` (~${bpm} BPM)` : ""}. ` +
        "For a beat-synced feel, align your segment start/end times to the `beats` timestamps " +
        "rather than spacing cuts evenly."
    );
  }

  return {
    video: videoPath,
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    sceneCuts: cuts.map((c) => Math.round(c * 100) / 100),
    averageShotSeconds,
    beats,
    bpm,
    keyframes,
    notes,
  };
}

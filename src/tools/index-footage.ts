import { mkdir, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { planFilmstrip, shotsFromCuts } from "../analysis.js";
import {
  decodeGrayFrames,
  detectSceneCuts,
  extractFilmstrip,
  probe,
} from "../ffmpeg.js";
import {
  assignShots,
  gradeShot,
  measureShotSignals,
  USABLE_SCORE,
  type IndexedShot,
  type ShotAssignment,
  type ShotNeed,
} from "../footage-index.js";
import { suggestFraming, toBackgroundPosition, type Framing } from "../framing.js";
import { mapLimit } from "../parallel.js";

/** Big enough to read a subject's position and whether the edges survived. */
const ANALYSIS_WIDTH = 128;
const ANALYSIS_HEIGHT = 72;
const ANALYSIS_FPS = 8;

const FFMPEG_CONCURRENCY = 4;

/**
 * Past this the index stops being something an agent can hold in context. The
 * cap is on shots rather than clips so one long clip can't crowd out the rest.
 */
const MAX_INDEXED_SHOTS = 120;

/** Below this a "shot" is a detection artifact, not footage anyone can cut to. */
const MIN_SHOT_SECONDS = 0.25;

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi",
]);

export interface IndexedShotDetail extends IndexedShot {
  framing: Framing;
  /** Ready to paste into the segment, or null when the subject isn't clear. */
  backgroundPosition: string | null;
  /** Contact sheet of the shot, when one was requested. */
  filmstrip: string | null;
}

export interface IndexedClip {
  file: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  shots: number;
}

export interface FootageIndexResult {
  clips: IndexedClip[];
  shots: IndexedShotDetail[];
  /** Present only when `needs` was passed: which shot fills which segment. */
  assignments: ShotAssignment[] | null;
  notes: string[];
  instructions: string;
}

/** Expand directories into the video files inside them, one level deep. */
async function collectClips(inputs: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const input of inputs) {
    const info = await stat(input).catch(() => {
      throw new Error(`${input} does not exist`);
    });

    if (!info.isDirectory()) {
      files.push(path.resolve(input));
      continue;
    }

    const entries = await readdir(input, { withFileTypes: true });
    const videos = entries
      .filter((e) => e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.resolve(input, e.name))
      .sort();

    if (videos.length === 0) {
      throw new Error(
        `${input} holds no video files (looked for ${[...VIDEO_EXTENSIONS].join(", ")})`
      );
    }
    files.push(...videos);
  }

  if (files.length === 0) throw new Error("no footage given");
  return files;
}

/**
 * Split every clip into shots and measure each one, so the agent picks from a
 * ranked library instead of being handed the right clip in advance.
 *
 * Filmstrips land in `.mimic-mcp/footage/` under the work dir.
 */
export async function indexFootage(
  inputs: string[],
  workDir: string,
  { needs, filmstrips = true }: { needs?: ShotNeed[]; filmstrips?: boolean } = {}
): Promise<FootageIndexResult> {
  const files = await collectClips(inputs);
  const notes: string[] = [];

  const outDir = path.join(workDir, ".mimic-mcp", "footage");
  if (filmstrips) await mkdir(outDir, { recursive: true });

  const clips: IndexedClip[] = [];
  const pending: { clip: string; id: string; start: number; end: number; fps: number }[] = [];

  // Cut detection decodes the whole video, so clips go one at a time; the
  // per-shot measurement below is what gets fanned out.
  for (const file of files) {
    const info = await probe(file);
    const cuts = await detectSceneCuts(file);
    const shots = shotsFromCuts(
      cuts.filter((c) => c.type !== "overlay").map((c) => c.time),
      info.videoSeconds
    ).filter((s) => s.end - s.start >= MIN_SHOT_SECONDS);

    const name = path.basename(file, path.extname(file));
    shots.forEach((s, i) => {
      pending.push({ clip: file, id: `${name}#${i + 1}`, start: s.start, end: s.end, fps: info.fps });
    });

    clips.push({
      file,
      durationSeconds: Math.round(info.videoSeconds * 100) / 100,
      width: info.width,
      height: info.height,
      fps: info.fps,
      hasAudio: info.hasAudio,
      shots: shots.length,
    });
  }

  if (pending.length === 0) {
    throw new Error(
      `No shot in ${files.length} clip(s) ran longer than ${MIN_SHOT_SECONDS}s — ` +
        "the footage is either empty or unreadable."
    );
  }

  let selected = pending;
  if (selected.length > MAX_INDEXED_SHOTS) {
    // Evenly spaced rather than the first N, so a late clip still gets seen.
    const step = selected.length / MAX_INDEXED_SHOTS;
    selected = Array.from(
      { length: MAX_INDEXED_SHOTS },
      (_, i) => pending[Math.floor(i * step)]
    );
    notes.push(
      `${pending.length} shots found; indexed an evenly spaced ${MAX_INDEXED_SHOTS} of them. ` +
        "Pass fewer clips at a time to index every shot."
    );
  }

  const shots = await mapLimit(selected, FFMPEG_CONCURRENCY, async (s) => {
    const { frames } = await decodeGrayFrames(s.clip, {
      width: ANALYSIS_WIDTH,
      height: ANALYSIS_HEIGHT,
      fps: ANALYSIS_FPS,
      start: s.start,
      duration: s.end - s.start,
    });

    const signals = measureShotSignals(frames, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const framing = suggestFraming(frames, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

    let filmstrip: string | null = null;
    if (filmstrips) {
      const plan = planFilmstrip(s.start, s.end, s.fps);
      if (plan) {
        const file = path.join(outDir, `${s.id.replace("#", "-shot")}.jpg`);
        await extractFilmstrip(s.clip, s.start, file, plan);
        filmstrip = file;
      }
    }

    return {
      id: s.id,
      clip: s.clip,
      start: Math.round(s.start * 100) / 100,
      end: Math.round(s.end * 100) / 100,
      seconds: Math.round((s.end - s.start) * 100) / 100,
      signals,
      quality: gradeShot(signals),
      framing,
      backgroundPosition: toBackgroundPosition(framing),
      filmstrip,
    } satisfies IndexedShotDetail;
  });

  shots.sort((a, b) => b.quality.score - a.quality.score);

  const weak = shots.filter((s) => s.quality.score < USABLE_SCORE);
  if (weak.length > 0) {
    notes.push(
      `${weak.length} of ${shots.length} shots scored below ${USABLE_SCORE} — ` +
        `look at their filmstrips before using them (${weak
          .slice(0, 5)
          .map((s) => `${s.id}: ${s.quality.flaws.join("/")}`)
          .join(", ")}).`
    );
  }

  const assignments = needs && needs.length > 0 ? assignShots(shots, needs) : null;
  if (assignments) {
    const short = assignments.filter((a) => a.shortBySeconds > 0).length;
    if (short > 0) {
      notes.push(
        `${short} segment(s) have no shot long enough to cover them — see each ` +
          "assignment's reason."
      );
    }
  }

  return {
    clips,
    shots,
    assignments,
    notes,
    instructions:
      "Shots are ranked best-first. Each one's `clip` + `start`/`end` go straight into a " +
      "segment as `backgroundVideo` + `backgroundStart`, and its `backgroundPosition` keeps " +
      "the subject in frame when the clip is cropped to vertical. `quality.flaws` names what " +
      "is measurably wrong with a shot (exposure, flatness, lost detail, shake) and " +
      "`quality.motionKind` says whether it is locked off, moving, or shaky — reach for a " +
      "locked shot under a long caption and a moving one for a hook. " +
      (assignments
        ? "`assignments` already picks one shot per segment you asked for; each entry's " +
          "`reason` says why."
        : "Pass `needs` (your segment durations) to have shots assigned to segments.") +
      " Look at the filmstrips before committing — the score measures what a shot is bad at, " +
      "not whether it shows the right thing.",
  };
}

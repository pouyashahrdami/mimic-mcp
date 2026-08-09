/**
 * Edit talking-head footage by what was SAID, not by where it went quiet.
 *
 * `trim_silence` is the crude version of this: it can only see gaps. A
 * word-level transcript can see the "um" that isn't a gap, the sentence you
 * want gone, and — once the cuts are made — where every surviving word landed,
 * which is what lets the captions come from the actual take instead of from a
 * script retyped by hand.
 *
 * Pure: takes timed words, returns spans and numbers.
 */

import { buildCues, type CueSegment } from "./subtitles.js";

export interface TimedWord {
  start: number;
  end: number;
  word: string;
}

export type CutReason = "disfluency" | "crutch" | "phrase";

export interface CutSpan {
  start: number;
  end: number;
  reason: CutReason;
  /** What was said there, so the agent can sanity-check the cut list. */
  text: string;
}

/**
 * Non-words. Cutting these is safe in a way that cutting real words is not —
 * they carry no meaning and every creator wants them gone.
 */
const DISFLUENCIES = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhhh", "erm", "er", "err",
  "hmm", "hm", "mmm", "mm", "ah", "ahh", "eh", "uhm",
]);

/**
 * Real words used as filler. Cutting them changes the sentence — "I literally
 * ran" is not "I ran" — so this is opt-in rather than on by default.
 */
const CRUTCH_PHRASES = [
  "you know", "i mean", "sort of", "kind of", "like",
  "basically", "actually", "literally", "honestly", "obviously",
];

/** Lowercase and strip the punctuation whisper attaches, so "Um," matches "um". */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

function tokenize(phrase: string): string[] {
  return phrase.split(/\s+/).map(normalizeWord).filter(Boolean);
}

/**
 * Every run of words matching `phrase`, as spans. Matching is normalized, so
 * the caller passes "you know" and it finds "You know," mid-sentence.
 */
export function findPhrase(
  words: TimedWord[],
  phrase: string,
  reason: CutReason = "phrase"
): CutSpan[] {
  const tokens = tokenize(phrase);
  if (tokens.length === 0) return [];

  const spans: CutSpan[] = [];
  for (let i = 0; i + tokens.length <= words.length; i++) {
    const window = words.slice(i, i + tokens.length);
    if (!window.every((w, j) => normalizeWord(w.word) === tokens[j])) continue;
    spans.push({
      start: window[0].start,
      end: window[window.length - 1].end,
      reason,
      text: window.map((w) => w.word).join(" "),
    });
    // Don't let one match's tail start the next.
    i += tokens.length - 1;
  }
  return spans;
}

export function findDisfluencies(words: TimedWord[]): CutSpan[] {
  return words
    .filter((w) => DISFLUENCIES.has(normalizeWord(w.word)))
    .map((w) => ({ start: w.start, end: w.end, reason: "disfluency" as const, text: w.word }));
}

export interface CutPlanOptions {
  /** Cut "um"/"uh"/"erm". On by default — they are not words. */
  removeDisfluencies?: boolean;
  /** Cut "like"/"basically"/"you know". Off by default — these change meaning. */
  removeCrutchWords?: boolean;
  /** Exact phrases to cut wherever they are said, e.g. a flubbed sentence. */
  removePhrases?: string[];
}

/** Merge overlapping or touching spans, keeping the first reason. */
function mergeSpans(spans: CutSpan[]): CutSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: CutSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      if (!last.text.endsWith(span.text)) last.text = `${last.text} ${span.text}`;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

export function planCuts(words: TimedWord[], options: CutPlanOptions = {}): CutSpan[] {
  const { removeDisfluencies = true, removeCrutchWords = false, removePhrases = [] } = options;

  const spans: CutSpan[] = [];
  if (removeDisfluencies) spans.push(...findDisfluencies(words));
  if (removeCrutchWords) {
    for (const phrase of CRUTCH_PHRASES) spans.push(...findPhrase(words, phrase, "crutch"));
  }
  for (const phrase of removePhrases) spans.push(...findPhrase(words, phrase));

  return mergeSpans(spans);
}

export interface KeepRange {
  start: number;
  end: number;
  /** Where this range lands on the trimmed timeline. */
  outStart: number;
}

/**
 * A cut this short costs a frame to make and buys nothing, and ffmpeg has to
 * seek for each one — so slivers are left in.
 */
const MIN_CUT_SECONDS = 0.06;
/** Keeping less than this between two cuts leaves an audible click, not a word. */
const MIN_KEEP_SECONDS = 0.04;

/**
 * Invert cut spans into the ranges to keep, with their positions on the
 * trimmed timeline. `margin` leaves a sliver of each cut in place so the words
 * either side aren't clipped — whisper's boundaries land on the vowel, not on
 * the silence around it.
 */
export function buildKeepRanges(
  cuts: CutSpan[],
  durationSeconds: number,
  margin = 0.03
): KeepRange[] {
  const effective = mergeSpans(cuts)
    .map((c) => ({
      start: Math.max(0, c.start + margin),
      end: Math.min(durationSeconds, c.end - margin),
    }))
    .filter((c) => c.end - c.start >= MIN_CUT_SECONDS);

  const keeps: KeepRange[] = [];
  let cursor = 0;
  let out = 0;

  const push = (start: number, end: number): void => {
    if (end - start < MIN_KEEP_SECONDS) return;
    keeps.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      outStart: Math.round(out * 1000) / 1000,
    });
    out += end - start;
  };

  for (const cut of effective) {
    push(cursor, cut.start);
    cursor = cut.end;
  }
  push(cursor, durationSeconds);

  return keeps;
}

export function trimmedDuration(keeps: KeepRange[]): number {
  return Math.round(keeps.reduce((sum, k) => sum + (k.end - k.start), 0) * 1000) / 1000;
}

/**
 * Where a source timestamp lands after the cuts, or null when it was cut out.
 * Boundaries resolve to the range that contains them, so a word starting
 * exactly at a keep's end belongs to the next range, not this one.
 */
export function remapTime(keeps: KeepRange[], time: number): number | null {
  for (const keep of keeps) {
    if (time >= keep.start && time < keep.end) {
      return Math.round((keep.outStart + (time - keep.start)) * 1000) / 1000;
    }
  }
  return null;
}

/**
 * A word is gone if its middle landed in a cut. Testing the middle rather than
 * the start matters: `margin` deliberately leaves the edges of every cut in
 * place to protect the neighbouring words, which also leaves the cut word's own
 * start inside a kept range — so a filler that IS cut from the video would
 * otherwise still show up in the captions.
 */
function wasCut(word: TimedWord, cuts: CutSpan[]): boolean {
  const middle = (word.start + word.end) / 2;
  return cuts.some((cut) => middle >= cut.start && middle < cut.end);
}

/** The surviving words, re-timed onto the trimmed clip. */
export function remapWords(
  keeps: KeepRange[],
  words: TimedWord[],
  cuts: CutSpan[] = []
): TimedWord[] {
  const remapped: TimedWord[] = [];
  for (const word of words) {
    if (wasCut(word, cuts)) continue;
    const start = remapTime(keeps, word.start);
    if (start === null) continue;
    // A word straddling a cut keeps its own length rather than being stretched
    // across the join.
    const end = remapTime(keeps, word.end);
    remapped.push({
      start,
      end: end !== null && end > start ? end : Math.round((start + (word.end - word.start)) * 1000) / 1000,
      word: word.word,
    });
  }
  return remapped;
}

export interface SpeechSegment {
  start: number;
  end: number;
  caption: string;
  /** Word starts relative to this segment — drops straight into the recipe. */
  wordTimings: number[];
}

/**
 * Group timed words into recipe segments whose captions are what was actually
 * said. The line breaks come from the subtitle cue builder, so burned-in
 * captions and the .srt sidecar split at the same places.
 */
export function captionsFromWords(words: TimedWord[]): SpeechSegment[] {
  if (words.length === 0) return [];

  const base = words[0].start;
  const cueSegment: CueSegment = {
    start: base,
    end: words[words.length - 1].end,
    caption: words.map((w) => w.word).join(" "),
    wordTimings: words.map((w) => Math.round((w.start - base) * 1000) / 1000),
  };

  // Each cue starts on a word boundary, so the nearest word to a cue's start is
  // where that line begins. Matching on time rather than counting tokens keeps
  // this correct even if a transcript word contains whitespace.
  const nearestWord = (time: number): number => {
    let best = 0;
    for (let i = 1; i < words.length; i++) {
      if (Math.abs(words[i].start - time) < Math.abs(words[best].start - time)) best = i;
    }
    return best;
  };

  const cues = buildCues([cueSegment]);
  const starts = [...new Set(cues.map((cue) => nearestWord(cue.start)))].sort((a, b) => a - b);

  return starts.map((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] : words.length;
    const line = words.slice(from, to);
    return {
      start: line[0].start,
      end: line[line.length - 1].end,
      caption: line.map((w) => w.word).join(" "),
      wordTimings: line.map((w) => Math.round((w.start - line[0].start) * 1000) / 1000),
    };
  });
}

/**
 * Turn a recipe's captions into a real subtitle track.
 *
 * The reel burns its captions into the pixels, which is what makes it look
 * right — but that leaves the text unreadable to platforms: no accessibility,
 * no search, no auto-translate. The recipe already knows every line and when it
 * is on screen, so a sidecar costs nothing but formatting.
 *
 * Pure: takes segments, returns strings.
 */

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CueSegment {
  start: number;
  end: number;
  caption: string;
  /** Per-word offsets from the segment start, when a transcription supplied them. */
  wordTimings?: number[];
}

/** Reading limits — beyond these a cue is on screen too long to track. */
const MAX_WORDS_PER_CUE = 7;
const MAX_SECONDS_PER_CUE = 3.5;
/** A silence this long is a sentence break, so never span a cue across it. */
const PAUSE_SECONDS = 0.8;

function pad(n: number, width = 2): string {
  return String(Math.floor(n)).padStart(width, "0");
}

/** `seconds` as HH:MM:SS + separator + milliseconds. */
function timestamp(seconds: number, msSeparator: "," | "."): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  // Rounding 1.9996 up to a full second must carry, not print :000.
  const whole = Math.floor(clamped) + (ms === 1000 ? 1 : 0);
  const printedMs = ms === 1000 ? 0 : ms;
  return (
    `${pad(whole / 3600)}:${pad((whole % 3600) / 60)}:${pad(whole % 60)}` +
    `${msSeparator}${pad(printedMs, 3)}`
  );
}

/**
 * Split one segment into readable cues. With word timings the split lands on
 * the real word boundaries; without them the words are spread evenly, which is
 * still better than one wall of text sitting on screen for eight seconds.
 */
function cuesForSegment(segment: CueSegment): Cue[] {
  const words = segment.caption.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const span = segment.end - segment.start;
  const timings = segment.wordTimings;
  const hasTimings = timings != null && timings.length === words.length;

  // Segment-relative start of each word: measured when a transcription gave us
  // timings, evenly spread otherwise.
  const startOf = (i: number): number =>
    i >= words.length ? span : hasTimings ? timings[i] : (i / words.length) * span;

  // A cue normally runs until the next word begins — but it must not sit on
  // screen through a silence, so a long trailing gap is cut short.
  const cueEnd = (to: number): number => {
    const natural = startOf(to);
    const lastWord = startOf(to - 1);
    return hasTimings && natural - lastWord > PAUSE_SECONDS
      ? lastWord + PAUSE_SECONDS
      : natural;
  };

  const breaks: number[] = [0];
  for (let i = 1; i < words.length; i++) {
    const from = breaks[breaks.length - 1];
    const tooManyWords = i - from >= MAX_WORDS_PER_CUE;
    // Measure where the cue would END if it took word i, not where word i
    // starts — otherwise the last word pushes the cue past the limit.
    const tooLong = cueEnd(i + 1) - startOf(from) > MAX_SECONDS_PER_CUE;
    // A real silence is a better cue boundary than any length limit.
    const afterPause = hasTimings && startOf(i) - startOf(i - 1) >= PAUSE_SECONDS;
    if (tooManyWords || tooLong || afterPause) breaks.push(i);
  }

  return breaks
    .map((from, n) => {
      const to = n + 1 < breaks.length ? breaks[n + 1] : words.length;
      return {
        start: segment.start + startOf(from),
        end: segment.start + cueEnd(to),
        text: words.slice(from, to).join(" "),
      };
    })
    .filter((cue) => cue.end > cue.start);
}

export function buildCues(segments: CueSegment[]): Cue[] {
  return segments.flatMap(cuesForSegment).sort((a, b) => a.start - b.start);
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map((cue, i) =>
        [
          String(i + 1),
          `${timestamp(cue.start, ",")} --> ${timestamp(cue.end, ",")}`,
          cue.text,
        ].join("\n")
      )
      .join("\n\n") + "\n"
  );
}

export function toVtt(cues: Cue[]): string {
  return (
    "WEBVTT\n\n" +
    cues
      .map((cue) =>
        [`${timestamp(cue.start, ".")} --> ${timestamp(cue.end, ".")}`, cue.text].join("\n")
      )
      .join("\n\n") +
    "\n"
  );
}

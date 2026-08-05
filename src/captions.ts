/**
 * Pure logic for turning per-frame OCR samples into a measured caption track:
 * which text is on screen, when it appears and disappears, where it sits, and
 * what its type looks like (size, case). No Vision/ffmpeg imports — testable.
 */

export interface OcrLine {
  text: string;
  confidence: number;
  /** Normalized bbox, top-left origin, 0..1 of the frame. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameOcr {
  time: number;
  lines: OcrLine[];
}

export interface CaptionEvent {
  text: string;
  start: number;
  end: number;
  /** Median bbox across the event's samples (normalized, top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vertical band the caption lives in. */
  band: "top" | "center" | "bottom";
  /** True when every letter is uppercase (the shouty reel look). */
  uppercase: boolean;
  /** Single line height as a fraction of frame height — the font-size proxy. */
  lineHeight: number;
}

const normalize = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

interface OpenEvent {
  key: string;
  text: string;
  start: number;
  lastSeen: number;
  xs: number[];
  ys: number[];
  ws: number[];
  hs: number[];
}

/**
 * Group OCR'd lines across frames into caption events. A line belongs to the
 * same event as long as its normalized text keeps re-appearing without a gap
 * longer than `maxGapSeconds` (OCR flickers on video compression; one missed
 * sample shouldn't split an event). Watermark-like text that never changes is
 * still reported — the agent can see it spans the whole video and ignore it.
 */
export function buildCaptionTrack(
  frames: FrameOcr[],
  { minConfidence = 0.3, maxGapSeconds = 0.9, minDurationSeconds = 0.15 } = {}
): CaptionEvent[] {
  const open = new Map<string, OpenEvent>();
  const closed: OpenEvent[] = [];

  const sorted = [...frames].sort((a, b) => a.time - b.time);
  for (const frame of sorted) {
    const seen = new Set<string>();
    for (const line of frame.lines) {
      if (line.confidence < minConfidence) continue;
      const key = normalize(line.text);
      if (!key) continue;
      seen.add(key);
      const existing = open.get(key);
      if (existing && frame.time - existing.lastSeen <= maxGapSeconds) {
        existing.lastSeen = frame.time;
        existing.xs.push(line.x);
        existing.ys.push(line.y);
        existing.ws.push(line.w);
        existing.hs.push(line.h);
      } else {
        if (existing) closed.push(existing);
        open.set(key, {
          key,
          text: line.text.trim(),
          start: frame.time,
          lastSeen: frame.time,
          xs: [line.x],
          ys: [line.y],
          ws: [line.w],
          hs: [line.h],
        });
      }
    }
    // Expire events whose text has been gone too long.
    for (const [key, ev] of open) {
      if (!seen.has(key) && frame.time - ev.lastSeen > maxGapSeconds) {
        closed.push(ev);
        open.delete(key);
      }
    }
  }
  closed.push(...open.values());

  return closed
    .filter((ev) => ev.lastSeen - ev.start >= minDurationSeconds)
    .map((ev) => {
      const y = median(ev.ys);
      const h = median(ev.hs);
      const centerY = y + h / 2;
      const hasLetters = /[a-zA-Z]/.test(ev.text);
      return {
        text: ev.text,
        start: Math.round(ev.start * 100) / 100,
        end: Math.round(ev.lastSeen * 100) / 100,
        x: Math.round(median(ev.xs) * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        w: Math.round(median(ev.ws) * 1000) / 1000,
        h: Math.round(h * 1000) / 1000,
        band: centerY < 1 / 3 ? "top" : centerY < 2 / 3 ? "center" : "bottom",
        uppercase: hasLetters && ev.text === ev.text.toUpperCase(),
        lineHeight: Math.round(h * 1000) / 1000,
      } satisfies CaptionEvent;
    })
    .sort((a, b) => a.start - b.start);
}

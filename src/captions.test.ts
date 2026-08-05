import { describe, expect, it } from "vitest";
import { buildCaptionTrack, type FrameOcr } from "./captions.js";

const line = (
  text: string,
  overrides: Partial<{ confidence: number; x: number; y: number; w: number; h: number }> = {}
) => ({
  text,
  confidence: 1,
  x: 0.3,
  y: 0.7,
  w: 0.4,
  h: 0.04,
  ...overrides,
});

describe("buildCaptionTrack", () => {
  it("merges consecutive sightings of the same text into one event", () => {
    const frames: FrameOcr[] = [0, 0.4, 0.8, 1.2].map((time) => ({
      time,
      lines: [line("hello world")],
    }));
    const track = buildCaptionTrack(frames);
    expect(track).toHaveLength(1);
    expect(track[0].start).toBe(0);
    expect(track[0].end).toBe(1.2);
    expect(track[0].text).toBe("hello world");
  });

  it("bridges a single missed OCR sample instead of splitting the event", () => {
    const frames: FrameOcr[] = [
      { time: 0, lines: [line("stay")] },
      { time: 0.4, lines: [] },
      { time: 0.8, lines: [line("stay")] },
    ];
    const track = buildCaptionTrack(frames);
    expect(track).toHaveLength(1);
    expect(track[0].end).toBe(0.8);
  });

  it("splits into a new event after a long gap", () => {
    const frames: FrameOcr[] = [
      { time: 0, lines: [line("again")] },
      { time: 0.4, lines: [line("again")] },
      { time: 3, lines: [line("again")] },
      { time: 3.4, lines: [line("again")] },
    ];
    const track = buildCaptionTrack(frames);
    expect(track).toHaveLength(2);
    expect(track[0].end).toBe(0.4);
    expect(track[1].start).toBe(3);
  });

  it("keeps simultaneous distinct texts as separate events", () => {
    const frames: FrameOcr[] = [0, 0.4].map((time) => ({
      time,
      lines: [
        line("BIG HOOK", { y: 0.2 }),
        line("@watermark", { y: 0.9, h: 0.015 }),
      ],
    }));
    const track = buildCaptionTrack(frames);
    expect(track).toHaveLength(2);
    const hook = track.find((t) => t.text === "BIG HOOK")!;
    expect(hook.band).toBe("top");
    expect(hook.uppercase).toBe(true);
    const mark = track.find((t) => t.text === "@watermark")!;
    expect(mark.band).toBe("bottom");
    expect(mark.uppercase).toBe(false);
  });

  it("drops low-confidence noise and blink-length events", () => {
    const frames: FrameOcr[] = [
      { time: 0, lines: [line("garble", { confidence: 0.1 })] },
      { time: 0.4, lines: [line("flash")] },
      { time: 0.8, lines: [] },
      { time: 1.2, lines: [] },
    ];
    // "garble" is under confidence; "flash" appears in exactly one sample.
    expect(buildCaptionTrack(frames)).toHaveLength(0);
  });

  it("reports the median geometry as the event's box", () => {
    const frames: FrameOcr[] = [
      { time: 0, lines: [line("steady", { y: 0.7 })] },
      { time: 0.4, lines: [line("steady", { y: 0.71 })] },
      { time: 0.8, lines: [line("steady", { y: 0.9 })] },
    ];
    const track = buildCaptionTrack(frames);
    expect(track[0].y).toBeCloseTo(0.71, 5);
    expect(track[0].lineHeight).toBeCloseTo(0.04, 5);
  });
});

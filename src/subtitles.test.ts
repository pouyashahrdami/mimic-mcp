import { describe, expect, it } from "vitest";
import { buildCues, toSrt, toVtt } from "./subtitles.js";

describe("buildCues", () => {
  it("emits one cue for a short caption", () => {
    expect(buildCues([{ start: 0, end: 2, caption: "three word caption" }])).toEqual([
      { start: 0, end: 2, text: "three word caption" },
    ]);
  });

  it("skips segments with no caption", () => {
    // draft_recipe leaves captionless segments empty on purpose.
    expect(buildCues([{ start: 0, end: 2, caption: "   " }])).toEqual([]);
  });

  it("splits a long caption into readable cues", () => {
    const cues = buildCues([
      {
        start: 0,
        end: 8,
        caption: "one two three four five six seven eight nine ten eleven twelve",
      },
    ]);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.text.split(" ").length).toBeLessThanOrEqual(7);
      expect(cue.end - cue.start).toBeLessThanOrEqual(3.5001);
    }
    expect(cues.map((c) => c.text).join(" ")).toBe(
      "one two three four five six seven eight nine ten eleven twelve"
    );
  });

  it("splits on real word boundaries when timings are available", () => {
    const cues = buildCues([
      {
        start: 10,
        end: 18,
        caption: "a b c d e f g h",
        wordTimings: [0, 0.2, 0.4, 0.6, 4, 4.2, 4.4, 4.6],
      },
    ]);
    expect(cues[0].start).toBe(10);
    // The second cue starts where its first word actually lands, not at the midpoint.
    expect(cues[1].start).toBe(14);
  });

  it("never overlaps neighbouring cues or outruns the segment", () => {
    const cues = buildCues([
      { start: 0, end: 6, caption: "one two three four five six seven eight nine ten" },
    ]);
    for (let i = 0; i < cues.length - 1; i++) {
      expect(cues[i].end).toBeLessThanOrEqual(cues[i + 1].start);
    }
    expect(cues[cues.length - 1].end).toBeLessThanOrEqual(6);
  });

  it("orders cues across segments by time", () => {
    const cues = buildCues([
      { start: 4, end: 6, caption: "second" },
      { start: 0, end: 2, caption: "first" },
    ]);
    expect(cues.map((c) => c.text)).toEqual(["first", "second"]);
  });
});

describe("toSrt", () => {
  it("numbers cues from 1 and uses comma milliseconds", () => {
    const srt = toSrt([{ start: 1.5, end: 3.25, text: "hello" }]);
    expect(srt).toBe("1\n00:00:01,500 --> 00:00:03,250\nhello\n");
  });

  it("formats past a minute and an hour", () => {
    const srt = toSrt([{ start: 3661.001, end: 3662, text: "late" }]);
    expect(srt).toContain("01:01:01,001 --> 01:01:02,000");
  });

  it("carries a rounded-up millisecond into the next second", () => {
    expect(toSrt([{ start: 1.9996, end: 2.5, text: "x" }])).toContain("00:00:02,000 -->");
  });

  it("separates cues with a blank line", () => {
    const srt = toSrt([
      { start: 0, end: 1, text: "a" },
      { start: 1, end: 2, text: "b" },
    ]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\na\n\n2\n00:00:01,000 --> 00:00:02,000\nb\n");
  });
});

describe("toVtt", () => {
  it("starts with the WEBVTT header and uses dot milliseconds", () => {
    const vtt = toVtt([{ start: 1.5, end: 3.25, text: "hello" }]);
    expect(vtt).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nhello\n");
  });
});

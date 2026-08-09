import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderOutputPath, segmentFrameRange } from "./tools/render-reel.js";

describe("renderOutputPath", () => {
  it("resolves a relative project dir instead of nesting it under itself", () => {
    const out = renderOutputPath("./proj", "final");
    expect(path.isAbsolute(out)).toBe(true);
    expect(out).toBe(path.join(process.cwd(), "proj", "out", "reel.mp4"));
    expect(out).not.toContain(path.join("proj", "proj"));
  });

  it("names the draft render separately so it never clobbers the deliverable", () => {
    expect(path.basename(renderOutputPath("/tmp/proj", "draft"))).toBe("reel-draft.mp4");
    expect(path.basename(renderOutputPath("/tmp/proj", "final"))).toBe("reel.mp4");
  });

  it("leaves an absolute project dir alone", () => {
    expect(renderOutputPath("/tmp/proj", "final")).toBe("/tmp/proj/out/reel.mp4");
  });

  it("gives a partial render its own name so it can't clobber the deliverable", () => {
    const partial = renderOutputPath("/tmp/proj", "final", [2, 3]);
    expect(path.basename(partial)).toBe("reel-segments-2-3.mp4");
    expect(partial).not.toBe(renderOutputPath("/tmp/proj", "final"));
  });

  it("names a partial render the same however the indices are ordered", () => {
    expect(renderOutputPath("/tmp/proj", "final", [3, 2])).toBe(
      renderOutputPath("/tmp/proj", "final", [2, 3])
    );
  });
});

describe("segmentFrameRange", () => {
  const segments = [
    { start: 0, end: 2 },
    { start: 2, end: 3.5 },
    { start: 3.5, end: 6 },
  ];

  it("covers one segment, ending just before the next begins", () => {
    expect(segmentFrameRange(segments, [1], 30)).toEqual({ from: 60, to: 104 });
  });

  it("spans from the first chosen segment to the last", () => {
    expect(segmentFrameRange(segments, [0, 2], 30)).toEqual({ from: 0, to: 179 });
  });

  it("is order-independent", () => {
    expect(segmentFrameRange(segments, [2, 0], 30)).toEqual(
      segmentFrameRange(segments, [0, 2], 30)
    );
  });

  it("rejects an out-of-range index with the valid range", () => {
    expect(() => segmentFrameRange(segments, [3], 30)).toThrow(/indices run 0\.\.2/);
    expect(() => segmentFrameRange(segments, [-1], 30)).toThrow(/out of range/);
  });

  it("rejects an empty selection rather than rendering everything", () => {
    expect(() => segmentFrameRange(segments, [], 30)).toThrow(/at least one segment/);
  });

  it("never returns a backwards range for a sub-frame segment", () => {
    const { from, to } = segmentFrameRange([{ start: 1, end: 1.001 }], [0], 30);
    expect(to).toBeGreaterThanOrEqual(from);
  });
});

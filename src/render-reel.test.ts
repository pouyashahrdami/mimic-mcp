import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderOutputPath } from "./tools/render-reel.js";

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
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldReel } from "./tools/scaffold-reel.js";

let tmp: string;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("scaffoldReel", () => {
  it("keeps distinct same-named sources apart and copies a reused source once", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const dirA = path.join(tmp, "shoot-a");
    const dirB = path.join(tmp, "shoot-b");
    await mkdir(dirA);
    await mkdir(dirB);
    const mainVideo = path.join(dirA, "clip.mp4");
    const otherVideo = path.join(dirB, "clip.mp4");
    await writeFile(mainVideo, "footage A");
    await writeFile(otherVideo, "footage B");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(
      JSON.stringify({
        output: { durationSeconds: 10 },
        background: { video: mainVideo },
        segments: [
          { start: 0, end: 5, caption: "one", backgroundVideo: otherVideo },
          { start: 5, end: 10, caption: "two", backgroundVideo: otherVideo },
        ],
      }),
      projectDir
    );

    const localized = JSON.parse(
      await readFile(path.join(projectDir, "recipe.json"), "utf8")
    );
    expect(localized.background.video).toBe("clip.mp4");
    expect(localized.segments[0].backgroundVideo).toBe("clip-2.mp4");
    // The reused source resolves to the same staged copy, not a third file.
    expect(localized.segments[1].backgroundVideo).toBe("clip-2.mp4");

    const publicDir = path.join(projectDir, "public");
    expect(await readFile(path.join(publicDir, "clip.mp4"), "utf8")).toBe("footage A");
    expect(await readFile(path.join(publicDir, "clip-2.mp4"), "utf8")).toBe("footage B");
  });

  it("scaffolds a from-scratch recipe: no video, staged background image", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const shot = path.join(tmp, "shot.png");
    await writeFile(shot, "screenshot");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(
      JSON.stringify({
        output: { durationSeconds: 10 },
        segments: [
          { start: 0, end: 5, caption: "one", backgroundFill: "#0f0c29" },
          { start: 5, end: 10, caption: "two", backgroundImage: shot },
        ],
      }),
      projectDir
    );

    const localized = JSON.parse(
      await readFile(path.join(projectDir, "recipe.json"), "utf8")
    );
    expect(localized.background.video).toBeUndefined();
    expect(localized.segments[0].backgroundFill).toBe("#0f0c29");
    expect(localized.segments[1].backgroundImage).toBe("shot.png");
    expect(
      await readFile(path.join(projectDir, "public", "shot.png"), "utf8")
    ).toBe("screenshot");
  });

  it("stages custom scenes into src/scenes and regenerates the registry", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const dirA = path.join(tmp, "a");
    const dirB = path.join(tmp, "b");
    await mkdir(dirA);
    await mkdir(dirB);
    const heroA = path.join(dirA, "Hero.tsx");
    const heroB = path.join(dirB, "Hero.tsx");
    await writeFile(heroA, "export default () => null; // A");
    await writeFile(heroB, "export default () => null; // B");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(
      JSON.stringify({
        output: { durationSeconds: 15 },
        segments: [
          { start: 0, end: 5, caption: "one", scene: heroA },
          { start: 5, end: 10, caption: "two", scene: heroB },
          { start: 10, end: 15, caption: "three", scene: heroA },
        ],
      }),
      projectDir
    );

    const localized = JSON.parse(
      await readFile(path.join(projectDir, "recipe.json"), "utf8")
    );
    expect(localized.segments[0].scene).toBe("Hero");
    expect(localized.segments[1].scene).toBe("Hero-2");
    // Reused source resolves to the same staged scene, not a third copy.
    expect(localized.segments[2].scene).toBe("Hero");

    const scenesDir = path.join(projectDir, "src", "scenes");
    expect(await readFile(path.join(scenesDir, "Hero.tsx"), "utf8")).toContain("// A");
    expect(await readFile(path.join(scenesDir, "Hero-2.tsx"), "utf8")).toContain("// B");
    const registry = await readFile(path.join(scenesDir, "index.ts"), "utf8");
    expect(registry).toContain('import scene0 from "./Hero"');
    expect(registry).toContain('import scene1 from "./Hero-2"');
    expect(registry).toContain('"Hero": scene0');
    expect(registry).toContain('"Hero-2": scene1');
  });

  it("rejects a scene that isn't a .tsx file", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const scene = path.join(tmp, "Hero.jsx");
    await writeFile(scene, "export default () => null;");
    await expect(
      scaffoldReel(
        JSON.stringify({
          output: { durationSeconds: 5 },
          segments: [{ start: 0, end: 5, caption: "x", scene }],
        }),
        path.join(tmp, "project")
      )
    ).rejects.toThrow(".tsx");
  });

  it("refuses a non-empty target that isn't a reel project, allows re-scaffolding one", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "scaffold-test-"));
    const video = path.join(tmp, "clip.mp4");
    await writeFile(video, "footage");
    const recipeJson = JSON.stringify({
      output: { durationSeconds: 10 },
      background: { video },
      segments: [{ start: 0, end: 5, caption: "hi" }],
    });

    const occupied = path.join(tmp, "occupied");
    await mkdir(occupied);
    await writeFile(path.join(occupied, "notes.txt"), "not a reel project");
    await expect(scaffoldReel(recipeJson, occupied)).rejects.toThrow("isn't empty");

    const projectDir = path.join(tmp, "project");
    await scaffoldReel(recipeJson, projectDir);
    await expect(scaffoldReel(recipeJson, projectDir)).resolves.toBeTruthy();
  });
});

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { reframe, type ReframeMode } from "../ffmpeg.js";

// The formats worth cross-posting a vertical reel to. Values are [w, h].
const PRESETS: Record<string, [number, number]> = {
  reels: [1080, 1920], // 9:16 — TikTok / Reels / Shorts
  square: [1080, 1080], // 1:1 — classic feed post
  feed: [1080, 1350], // 4:5 — tallest allowed feed post
  youtube: [1920, 1080], // 16:9 — landscape / YouTube
};

export interface ExportedVariant {
  format: string;
  width: number;
  height: number;
  file: string;
}

/**
 * Produce cross-post variants of a rendered reel at common aspect ratios.
 * Output lands beside the source as `<name>-<format>.mp4`.
 */
export async function exportVariants(
  videoPath: string,
  formats: string[],
  mode: ReframeMode = "crop"
): Promise<{ variants: ExportedVariant[]; nextStep: string }> {
  const unknown = formats.filter((f) => !(f in PRESETS));
  if (unknown.length) {
    throw new Error(
      `Unknown format(s): ${unknown.join(", ")}. Choose from: ${Object.keys(PRESETS).join(", ")}.`
    );
  }

  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const outDir = path.join(dir, "variants");
  await mkdir(outDir, { recursive: true });

  const variants: ExportedVariant[] = [];
  for (const format of formats) {
    const [width, height] = PRESETS[format];
    const file = path.join(outDir, `${base}-${format}.mp4`);
    await reframe(videoPath, file, width, height, mode);
    variants.push({ format, width, height, file });
  }

  return {
    variants,
    nextStep: `Exported ${variants.length} variant(s) to ${outDir}. Post each to its matching platform.`,
  };
}

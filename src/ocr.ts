import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FrameOcr, OcrLine } from "./captions.js";

const run = promisify(execFile);

// dist/ocr.js -> ../assets/ocr/ocr.swift
const OCR_HELPER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "ocr",
  "ocr.swift"
);

interface HelperResult {
  file: string;
  observations: OcrLine[];
}

/**
 * OCR a batch of extracted frames with Apple's Vision framework (via a Swift
 * helper script — one process for the whole batch). Returns null when swift
 * isn't available (non-macOS or no toolchain), so callers can degrade to
 * frames-only analysis instead of failing.
 */
export async function tryOcrFrames(
  frames: { time: number; file: string }[]
): Promise<FrameOcr[] | null> {
  if (frames.length === 0) return [];
  try {
    const { stdout } = await run(
      "swift",
      [OCR_HELPER, ...frames.map((f) => f.file)],
      { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 }
    );
    const results = JSON.parse(stdout) as HelperResult[];
    const byFile = new Map(results.map((r) => [r.file, r.observations]));
    return frames.map((f) => ({
      time: f.time,
      lines: byFile.get(f.file) ?? [],
    }));
  } catch {
    return null;
  }
}

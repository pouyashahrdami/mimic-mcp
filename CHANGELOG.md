# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-06

The initial `0.1.0` feature set — the full analyze → recipe → scaffold → render →
self-review loop and everything around it.

### Added

- **Reference analysis** (`analyze_reference`) — measured scene cuts via every-frame
  vector diffing, transitions fingerprinted as cut/dissolve/dip/wipe with durations,
  in-shot motion (zoom/pan magnitude + fitted easing), on-screen graphic-swap
  detection, an OCR'd caption track, and beat/BPM detection. Emits filmstrip contact
  sheets per shot and native-fps burst strips per transition.
- **A machine-readable StyleSpec** as the analysis contract.
- **Transcription** (`transcribe_reference`) — word-level timings for script structure
  and karaoke captions (needs a local whisper CLI).
- **Music extraction** (`extract_music`) — rip the reference's audio track.
- **Optional aubio beat tracking** with an autocorrelation BPM estimate.
- **Footage prep** — `trim_silence` (jump-cut talking-head footage) and
  `generate_voiceover` (macOS `say` TTS).
- **The style recipe** — a validated JSON contract describing segments, captions,
  animations, transitions, zoom, sound, and music.
- **Build & render** — `scaffold_reel` (generate a Remotion project from a recipe),
  `render_reel` (draft/final mp4), and `open_in_studio` (Remotion Studio handoff).
- **Self-review** (`review_render`) — re-runs the render through the same analyzer and
  diffs the two StyleSpecs into a 0–100 fidelity score with actionable issues.
- **Cross-posting** (`export_variants`) — re-frame into 9:16, 1:1, 4:5, 16:9.
- **Reusable presets** — `list_presets` / `get_preset` / `save_preset`, plus shipped
  built-ins.
- **Recipe styling** — per-segment Ken-Burns zoom, background video/offset for
  multi-clip montages, image cards, sound effects, speed ramps, caption font/color/
  size/position overrides, karaoke and typewriter caption animations.
- **MCP server** over stdio with a `mimic-mcp` slash prompt walking the agent through
  the workflow.
- **vitest** test harness.

[Unreleased]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pouyashahrdami/mimic-mcp/releases/tag/v0.1.0

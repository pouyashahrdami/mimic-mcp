# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`draft_recipe`** — projects a measured StyleSpec into a first-pass recipe instead
  of leaving the agent to hand-author timing: one segment per measured shot,
  transition kinds and durations copied verbatim from the fingerprints, in-shot zoom
  with its fitted easing, caption band/size/style from the OCR track, and segment
  boundaries snapped onto the beat grid (the first consumer of the measured beats).
  Returns `notes` naming the judgment calls it deliberately left to the agent.

- **Caption chrome** — `captionOutline` (a contrasting stroke around the letters, the
  thing that keeps captions readable over busy footage), `captionBackground` (a rounded
  pill behind the text), and `emphasisWords` / `emphasisColor` (pop individual words in
  an accent color, with `captionAnimation` `none` or `karaoke`).
- A test asserting the server's recipe schema and the Remotion template's mirrored copy
  stay field-for-field identical — they had drifted apart with nothing to catch it.

### Fixed

- `render_reel` applied a **relative** project directory twice (it also passes the
  project as the renderer's cwd), writing the mp4 to `project/project/out/` and
  returning a path that `review_render` could not find. Paths are resolved once now.
- Karaoke captions never wrapped: the per-word spans were emitted with no whitespace
  between them, leaving the line no break opportunity, so a long caption ran off the
  frame instead of onto a second line.

### Changed

- The `mimic-mcp` workflow prompt now routes through `draft_recipe` and tells the
  agent to edit content and look rather than re-author measured timing.

## [0.2.0] - 2026-08-07

### Added

- **From-scratch reels — footage is now optional.** A segment's background can be a
  CSS fill (`backgroundFill`, color or gradient), a full-bleed still
  (`backgroundImage`, riding the same zoom/transition machinery as footage), or a
  **custom scene**: an agent-authored Remotion component (`scene`) that
  `scaffold_reel` stages into the project's `src/scenes/` with a generated registry.
  All sources mix freely with footage segments in one recipe.
- **`generate-scratch` prompt** — the from-scratch workflow (script + optional
  assets/reference/style direction): storyboard pages, design fills/images/scenes,
  scaffold, render, and self-review with no reference required.
- `review_render` now tailors its guidance to reference-free reviews.

### Changed

- `background` (and `background.video`) is optional in the recipe; validation
  requires each segment to resolve to *some* background and rejects segments mixing
  background sources.

## [0.1.0] - 2026-08-06

The initial `0.1.0` feature set — the full analyze → recipe → scaffold → render →
self-review loop and everything around it. Published to npm as
[`mimic-reels-mcp`](https://www.npmjs.com/package/mimic-reels-mcp) (the unscoped
`mimic-mcp` name was already taken on the registry).

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

[Unreleased]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pouyashahrdami/mimic-mcp/releases/tag/v0.1.0

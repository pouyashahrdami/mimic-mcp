# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-08-09

The your-footage release. The reference side of this project was measured in detail
while the user's own material arrived as "here's a folder, good luck" — so the agent
had to be handed exactly the right clip, already trimmed, and every reel built from
someone else's reference came out looking like theirs. This closes both gaps, and adds
the feedback loop a reel with no reference could never get.

### Added

- **`index_footage`** — turns a folder of clips into a ranked shot library. Splits every
  clip into shots and grades each one on what a shot can be bad at (exposure, flatness,
  surviving edge detail, camera shake) into a 0–1 score with named flaws, plus subject
  position and a filmstrip. Shake is measured from the *direction* the frames travelled
  rather than from how much changed: a constant-amplitude wobble moves the same number
  of pixels per frame as a steady pan and is invisible to a magnitude-only measure. Pass
  your segment durations as `needs` and it assigns a shot per segment, filling the
  longest need first so a short segment can't strand a long one, and reporting the
  shortfall instead of silently picking something too short.

- **`edit_by_transcript`** — cuts footage by what was *said*, which `trim_silence` cannot
  see: the "um" that isn't a gap, and the flubbed sentence you remove by quoting it
  rather than hunting its timecode. Crutch words (`like`, `basically`, `you know`) are
  opt-in, since cutting them changes the sentence. Returns every cut with what was said
  there, plus captions from the actual take, re-timed onto the edited clip with
  segment-relative word timings. `dry_run` plans without encoding.

- **`critique_reel`** — scores a reel against *itself*. `review_render` answers "does
  this match the reference?", which is the wrong question when there isn't one, so a
  from-scratch reel had no automated feedback at all. Measures what makes any reel
  unreadable regardless of style: captions going past faster than anyone reads them, an
  opening that says nothing in the first 1.5s, text with no outline or pill to separate
  it from the footage, uniform segment lengths, dead air, over-long holds, a landscape
  output. Every issue names the recipe field to change and carries the number behind it.

- **`track_subject`** and the segment field **`backgroundTrack`** — follows a subject
  that moves instead of aiming at where it was. `suggest_framing` gives one fixed point
  per span, which is right for a locked-off shot and loses anyone who walks, since
  cropping 16:9 into 9:16 throws away two thirds of the width. Measurements are
  gap-filled by holding the last known position (interpolating would invent a movement
  nobody made), smoothed, and speed-limited so a glitched window cannot become a whip
  pan. A subject that barely moved comes back as a single position rather than a track
  that would only jitter; a shot with no clear subject comes back as neither.

- **A brand layer** — the recipe gains `overlays` (image / text / progressBar), drawn
  last so a logo bug or handle cannot be covered by a dip or transition, and sized off
  the frame's own width so one recipe brands a 9:16 reel and a 1:1 crop identically.
  `scaffold_reel` stages overlay images into `public/` like any other media.
  **`save_brand_kit`** / **`list_brand_kits`** / **`apply_brand_kit`** store a standing
  set of those marks plus caption defaults and fonts. A preset carries the look of one
  reference; a brand kit carries what shouldn't change when you copy a new reference at
  all, so the two compose. Merging is additive and idempotent — applying twice leaves
  one logo — and the recipe wins over the kit unless you pass `overwrite`.

- **`analyze_creator`** — learns a style from a body of work instead of one reel. A
  single reference cannot tell you which of its choices were the style and which were
  that video's subject. Reports distributions rather than averages (shot length
  p25..p75, transition frequencies, caption band and case, tempo) plus a `consistency`
  score, because the failure mode is silently averaging several different styles into
  one nobody made. Optionally saves a preset built from the middle of the measurements.

- **`localize_reel`** — the same reel in another language. Owns what goes silently wrong
  when you just swap the strings: `wordTimings` are offsets into a *specific sentence*,
  so a translated line karaokes the wrong words (dropped unless new ones are supplied);
  stale `emphasisWords` are cleared; and because languages are not the same length, the
  translated reel is re-scored for reading speed — a line that read comfortably in
  English can flash past in German at the same segment timing. Writes a renderable
  recipe plus `.srt`/`.vtt` per language.

- **`hook_variants`** — one recipe per alternative opening with nothing else touched.
  The first second and a half is what creators actually A/B, and rebuilding a whole reel
  per hook both spends a render on byte-identical frames and lets the variants differ in
  more than the thing under test. Each variant reports which segments changed, so
  `render_reel`'s `segments` makes a variant cost one segment instead of a reel, and
  each is re-scored for reading speed over its own changed segments.

- **`pick_cover_frame`** — chooses the thumbnail by measuring every candidate on
  exposure, contrast and edge detail. Platforms otherwise default to frame 0, which on a
  reel that opens with a dip-to-black is a black square. Returns the full ranking so a
  different frame can be chosen by eye.

- `captionInset` — how far a top- or bottom-banded caption sits from that edge, as a
  fraction of the output height. Lower it when copying a reference that deliberately
  runs text to the edge.

### Changed

- The jump-cut filter moved into `ffmpeg.concatRanges`, now shared by `trim_silence` and
  `edit_by_transcript` and covered end to end.
- Single-frame statistics moved into `frame-quality.ts`, shared by shot grading and
  cover-frame picking. The two want opposite verdicts from the same numbers — one asks
  what is wrong with a frame, the other which is most arresting — so the stats are
  shared and the scoring is not.
- Caption-swap invalidation moved into `caption-swap.ts`, shared by localization and
  hook variants, which are both "same reel, different words" and break identically.
- `writePreset` split out of `savePreset`, so a preset built from measurements takes the
  same collision-safe path as one extracted from a recipe.

### Fixed

- **Bottom captions shipped underneath the platform's caption bar.** The template inset
  them by a fixed 220px, which is a fifth of a 960-tall frame but only a ninth of a
  1920-tall one — so the default drifted with the output size and, at the standard
  1080x1920, ended at y=0.885, inside TikTok's and Instagram's caption bars. Insets are
  now a fraction of frame height, defaulting clear of the chrome on all three supported
  platforms. Found by `review_render`'s own safe-area check.

- **Scene-cut detection was blind to color.** Frames were decoded to grayscale, so a cut
  between two shots of equal brightness but different color registered as no change at
  all — luminance is a convex combination of the channels, and it can collapse a
  dramatic color change to nothing. The diff now runs per channel and takes the largest,
  which is always at least the grayscale difference, so it can only add sensitivity. A
  reference whose cut was missed produced one long shot, which `draft_recipe` then
  projected into a single segment with no transition; the same reference now yields both
  shots and the measured dissolve between them. The adaptive median+MAD threshold
  absorbs the extra chroma noise — a clip that is half per-frame random noise still
  reports zero cuts.

## [0.3.0] - 2026-08-08

The measurement release: the analysis the server was already doing now drives the
recipe instead of being handed to the agent as reading material, and the reel that
comes out the other end is a finished deliverable rather than a bare mp4.

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
- **Real typography** — a top-level `googleFonts` list loads those families into the
  render (via `@remotion/google-fonts`, held with `delayRender` until the webfonts are
  ready) so `captionFont` finally renders the font it names. Previously a matched
  reference font silently fell back to Helvetica unless it happened to be installed on
  the render machine, which capped how close any reel could get. An unknown family
  cancels the render with the near-misses listed instead of rendering the wrong face.

- **A real audio mix.** A `voiceover` track that plays *alongside* the music, with the
  music **ducking underneath it** automatically (ramping in before the first syllable
  and out after the last, rather than snapping on the voice). Music also gained
  `startSeconds` (open on the drop instead of the intro), `fadeInSeconds` and
  `fadeOutSeconds` (default 1.5s — the track no longer cuts off mid-bar, the most
  audible tell of an auto-edit). Previously narration had to go in `music.file`, so a
  reel could have narration or music but never both.

- **Loudness normalization.** Final renders are mixed to −14 LUFS with two-pass
  `loudnorm` (measure, then a single linear gain move — one-pass pumps on sparse
  material like a voiceover over a quiet bed). The video stream is copied rather than
  re-encoded, so it costs one audio pass. Silent reels are detected and left alone
  instead of having their noise floor amplified. Opt out with `normalize_audio: false`.

- **Safe-area checking** — `review_render` takes a `platform` (`tiktok`, `instagram`,
  `youtube-shorts`) and reports captions the app's own chrome would sit on top of: the
  bottom caption bar, the right action rail, the top tab bar. Measured from the
  render's OCR caption track against conservative per-platform rectangles, each issue
  naming the recipe field to change. Nothing else in the pipeline knew those regions
  existed — a reel could score 100/100 on fidelity and still ship with its text behind
  the caption bar.

- **A cheaper fix loop.** `render_reel` takes `segments: [3, 4]` to render only those
  segments (into their own `out/reel-segments-3-4.mp4`, so a work-in-progress view can
  never overwrite the deliverable, and skipping loudness normalization since a fragment
  shouldn't set its level from material the reel doesn't have). New `render_still`
  renders a single frame to PNG for layout questions that don't need an encode at all.

- **Subtitle sidecars** — `export_captions` writes `.srt` / `.vtt` next to the render.
  The reel burns captions into the pixels, which is what makes it look right but leaves
  the text invisible to platforms. Long captions are split into readable cues by word
  count and duration, landing on measured word boundaries when the recipe has
  `wordTimings`, and never holding a cue across a pause.

- **Measured framing** — `suggest_framing` finds where the subject sits in footage, per
  span, so `backgroundPosition` aims a cover-crop at it and `zoom.focusX/focusY` punch in
  toward it instead of the frame's middle. Motion is the cue where the shot has any;
  a locked-off shot falls back to edge detail, which a textured background can dominate,
  so those spans are flagged. Below a confidence floor it returns no position rather
  than a guess. `draft_recipe` runs the same measurement over the footage per segment,
  so a drafted reel arrives with its crops and punch-ins already aimed; segments running
  past the end of shorter footage are simply left centred. Opt out with
  `measure_framing: false`.

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

[Unreleased]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.4.0...HEAD

[0.4.0]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pouyashahrdami/mimic-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pouyashahrdami/mimic-mcp/releases/tag/v0.1.0

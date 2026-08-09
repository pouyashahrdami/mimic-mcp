# Architecture

A map of how a reel gets made, so you know where a change belongs. For contribution
mechanics see [CONTRIBUTING.md](CONTRIBUTING.md); for agent-facing rules,
[AGENTS.md](AGENTS.md).

## The data flow

```
reference reel ──analyze_reference──▶ StyleSpec ──┐
                                                  │  draft_recipe projects the
your footage + script ────────────────────────────┤  measurement; the agent edits
                                                  ▼  content and look on top
                                          style recipe (JSON)
                                                  │ scaffold_reel
                                                  ▼
                                       Remotion project ──render_reel──▶ mp4
                                                  │
                                     review_render │ (re-analyze the mp4)
                                                  ▼
                              StyleSpec(render) ─diff─ StyleSpec(reference)
                                                  │
                                                  ▼
                                    fidelity score + issues ──▶ fix recipe, re-render
```

The two contracts hold the halves together:

- **StyleSpec** (`src/style-spec.ts`) — the *measured* description of a video: cuts,
  fingerprinted transitions, in-shot motion, caption track, beats. Both the reference
  and the render are reduced to one, so "does the render match?" becomes arithmetic, not
  a visual judgment call (`src/spec-diff.ts`).
- **The style recipe** (`src/recipe.ts`) — the JSON the agent authors from what it saw.
  It's the contract between "agent understands the reference" and "code renders the
  video"; the scaffolder turns it into a Remotion project with no further judgment.

Footage is optional: a segment's background can instead be a CSS fill, a full-bleed
still image, or a **custom scene** — a Remotion component the agent writes, which
`scaffold_reel` stages into the project's `src/scenes/` alongside a generated
registry (`src/scenes/index.ts`) that `Reel.tsx` resolves scene names against. That
makes the left leg of the diagram optional too: the `generate-scratch` prompt runs
the same scaffold → render → review loop with the agent as art director instead of
a reference as ground truth (review still works, minus the measured diff).

## Module map

| Area | Files | Responsibility |
|------|-------|----------------|
| MCP entry | `src/index.ts` | Registers every tool + the slash prompt over stdio. |
| Tools | `src/tools/*.ts` | One file per MCP tool — the I/O boundary that wires pure logic to ffmpeg/whisper/Remotion. |
| Analysis (pure) | `src/analysis.ts` (scene cuts, transition fingerprints, motion/easing, beats), `src/captions.ts` (OCR caption track), `src/framing.ts` (subject location) | ffmpeg-free math over extracted frames/samples. Unit-tested without media. The colocated `scene-cuts.test.ts` / `transitions.test.ts` / `motion.test.ts` / `beats.test.ts` all exercise `analysis.ts` — the tests are split by concern, the module is not. |
| Subject tracking (pure) | `src/subject-track.ts` | Turns per-window framing measurements into keyframes: gap-filling, smoothing, speed-limiting, and the decision that a shot is static enough to hold one position instead. `positionAt` is mirrored in `Reel.tsx`, which needs the same curve at render time; it is unit-tested here. |
| Frame quality (pure) | `src/frame-quality.ts` | One frame's exposure/contrast/detail, and the cover-frame score built on them. Shot grading asks what's *wrong* with a frame; cover picking asks which is most *arresting* — same stats, opposite verdicts, so the stats live here and both callers score them their own way. |
| Footage triage (pure) | `src/footage-index.ts` | Grades a shot from its measured signals (exposure, flatness, detail, shake) and assigns shots to the segment durations a recipe needs. The user's-footage counterpart to the reference analysis above. |
| Transcript editing (pure) | `src/transcript-edit.ts` | Plans cuts from word-level timings (disfluencies, crutch words, quoted phrases), inverts them into keep ranges, re-times the surviving words onto the edited clip, and groups them into caption segments via `subtitles.ts` so burned-in captions and the sidecar split identically. |
| Contracts | `src/style-spec.ts`, `recipe.ts` | The measured StyleSpec and the authored recipe schemas. |
| Projection | `src/draft-recipe.ts` | Turns a StyleSpec + script into a first-pass recipe — the arithmetic half of recipe authoring, so the agent only makes the judgment calls. Pure; unit-tested. |
| Review | `src/spec-diff.ts`, `src/safe-area.ts`, `src/critique.ts` | Diffs two StyleSpecs into a 0–100 score with recipe-field-level issues, and flags captions the target platform's own UI would cover. `critique.ts` is the reference-free half: readability and pacing heuristics measured from the recipe alone, which is the only automated feedback a from-scratch reel can get. |
| Delivery (pure) | `src/subtitles.ts`, `src/loudness.ts` | Subtitle cue building/formatting, and `loudnorm` measurement parsing + filter construction for the −14 LUFS mix. |
| External wrappers | `src/ffmpeg.ts`, `whisper.ts`, `aubio.ts`, `tts.ts`, `ocr.ts` | Shell out to local binaries; fail loud or degrade cleanly when one is missing. |
| Agent-facing text | `src/prompt.ts` | The `mimic-mcp` and `generate-scratch` workflow prompts exposed as slash commands. |
| Creator style (pure) | `src/creator-style.ts` | Aggregates several StyleSpecs into distributions and habits, plus a `consistency` score, and projects the middle of them into a preset. Deliberately reports ranges rather than averages — one reel is a sample of a style, not the style. |
| Presets | `src/presets.ts`, `presets/*.json` | Reusable content-free looks. See [presets/README.md](presets/README.md). |
| Render target | `templates/remotion/` | Files `scaffold_reel` copies/generates into a new Remotion project, including `templates/remotion/src/audio.ts` (music gain curve: fades + ducking under narration). |
| Concurrency | `src/parallel.ts` | `mapLimit` — bounded-concurrency fan-out, order-preserving. |

## The key convention: pure logic, thin I/O

The analysis, caption, framing, subtitle and loudness modules are deliberately
**ffmpeg-free and Vision-free** — they take already-extracted frames, OCR samples or
tool output and do math on them. The `src/tools/*` and
`src/{ffmpeg,whisper,ocr,tts,aubio}.ts` wrappers own the messy I/O. That split is why
those modules have thorough unit tests with no media fixtures.

When you add behavior, keep the decision logic in a pure module with a colocated
`*.test.ts`, and keep the wrapper that feeds it thin. New tools go in `src/tools/` and
get registered in `src/index.ts`.

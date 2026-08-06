# Architecture

A map of how a reel gets made, so you know where a change belongs. For contribution
mechanics see [CONTRIBUTING.md](CONTRIBUTING.md); for agent-facing rules,
[AGENTS.md](AGENTS.md).

## The data flow

```
reference reel ──analyze_reference──▶ StyleSpec ──┐
                                                  │  (the agent reads both,
your footage + script ────────────────────────────┤   writes the recipe)
                                                  ▼
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

## Module map

| Area | Files | Responsibility |
|------|-------|----------------|
| MCP entry | `src/index.ts` | Registers every tool + the slash prompt over stdio. |
| Tools | `src/tools/*.ts` | One file per MCP tool — the I/O boundary that wires pure logic to ffmpeg/whisper/Remotion. |
| Analysis (pure) | `src/analysis.ts`, `scene-cuts.ts`, `transitions.ts`, `motion.ts`, `beats.ts`, `captions.ts` | ffmpeg-free math over extracted frames/samples — scene cuts, transition fingerprints, motion/easing, beats, caption track. Unit-tested without media. |
| Contracts | `src/style-spec.ts`, `recipe.ts` | The measured StyleSpec and the authored recipe schemas. |
| Review | `src/spec-diff.ts` | Diffs two StyleSpecs into a 0–100 score with recipe-field-level issues. |
| External wrappers | `src/ffmpeg.ts`, `whisper.ts`, `aubio.ts`, `tts.ts`, `ocr.ts` | Shell out to local binaries; fail loud or degrade cleanly when one is missing. |
| Presets | `src/presets.ts`, `presets/*.json` | Reusable content-free looks. See [presets/README.md](presets/README.md). |
| Render target | `templates/remotion/` | Files `scaffold_reel` copies/generates into a new Remotion project. |
| Concurrency | `src/parallel.ts` | `mapLimit` — bounded-concurrency fan-out, order-preserving. |

## The key convention: pure logic, thin I/O

The analysis and caption modules are deliberately **ffmpeg-free and Vision-free** — they
take already-extracted frames or OCR samples and do math. The `src/tools/*` and
`src/{ffmpeg,whisper,ocr,tts,aubio}.ts` wrappers own the messy I/O. That split is why
`analysis.ts` and `captions.ts` have thorough unit tests with no media fixtures.

When you add behavior, keep the decision logic in a pure module with a colocated
`*.test.ts`, and keep the wrapper that feeds it thin. New tools go in `src/tools/` and
get registered in `src/index.ts`.

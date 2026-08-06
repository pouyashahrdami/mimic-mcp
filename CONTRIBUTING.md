# Contributing to mimic-mcp

Thanks for helping out. This is a small, focused project — the bar is "does it make the analyze → recipe → render → self-review loop better?" Bug reports, presets, and PRs are all welcome.

## Getting set up

Requires **Node 18+** and **ffmpeg/ffprobe** on your PATH (`brew install ffmpeg`).

```bash
git clone https://github.com/pouyashahrdami/mimic-mcp
cd mimic-mcp
npm install
npm run build   # tsc, strict — must pass before any commit
npm test        # vitest
```

Some tools have optional native dependencies (a local whisper CLI for transcription, `aubio` for real beat tracking, macOS Vision for OCR). They degrade with a clear error when missing — see the README's Install section.

## Easiest first contribution: a preset

A preset is a reusable *look* with no content — caption styles, animations, transitions, zoom, timing. They live in [`presets/`](presets/) as JSON, one file per preset. Copy an existing one (e.g. [`bold-hook-tips.json`](presets/bold-hook-tips.json)), tweak the fields, and open a PR. The preset schema is validated on load, so `npm test` will tell you if a field is off.

## Project shape

- `src/index.ts` — MCP server entry (stdio transport).
- `src/tools/` — one file per MCP tool.
- `src/recipe.ts` — the style-recipe schema (the JSON contract between analysis and rendering).
- `templates/remotion/` — files that `scaffold_reel` copies/generates into a new Remotion project.
- `presets/` — shipped style presets.
- `src/*.test.ts` — colocated vitest tests.

## Code style

- TypeScript, strict mode. No `any` unless truly unavoidable (comment why).
- Comments explain *why*, not *what* — sparse and useful.
- Small functions, clear names. No speculative abstraction.
- Errors fail loud: validate inputs at tool boundaries, return actionable messages to the calling agent.
- Add a test when the logic is non-trivial; don't test trivial glue.

## Commits & PRs

- Conventional commit subjects: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Imperative mood, no fluff.
- `npm run build` and `npm test` must pass before you commit.
- Keep PRs focused — one concern per PR is much easier to review.
- Describe *what* changed and *why*, and how you verified it (which tool you ran against what footage).

## Reporting bugs

Open an issue with: what you ran (the tool + inputs), what you expected, what happened, and your OS / Node / ffmpeg versions. A short reference clip or recipe that reproduces the problem helps enormously.

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).

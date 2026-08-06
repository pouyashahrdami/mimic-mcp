# Rules for AI agents working on this repo

This file is loaded by Claude Code, Codex, and other agents. Follow it exactly.

## Commits

- Conventional commit subjects: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Imperative mood, no fluff.
- Commit at the end of every meaningful stage of work — don't batch a day of changes into one commit.
- **Never add `Co-Authored-By`, `Generated with`, or any AI attribution trailers to commits.**
  The human maintainer is the author; the agent is a tool acting in a role, not a co-author.
  This is a hard rule with no exceptions.

## Code style

- TypeScript, strict mode. No `any` unless truly unavoidable (comment why).
- Comments explain *why*, not *what*. Write them like a human maintainer would — sparse and useful.
- Small functions, clear names. No speculative abstraction.
- Errors fail loud: validate inputs at tool boundaries, return actionable messages to the calling agent.

## Project shape

- `src/index.ts` — MCP server entry (stdio transport).
- `src/tools/` — one file per MCP tool.
- `src/recipe.ts` — the style-recipe schema (the JSON contract between analysis and rendering).
- `templates/remotion/` — files that `scaffold_reel` copies/generates into a new Remotion project.

## Testing changes

- `npm run build` must pass (tsc, strict) before any commit.
- ffmpeg-dependent tools: test against a real short video when possible; degrade with a clear error when ffmpeg is missing.

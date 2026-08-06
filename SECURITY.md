# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub's
[**Report a vulnerability**](https://github.com/pouyashahrdami/mimic-mcp/security/advisories/new)
flow (Security → Advisories), rather than opening a public issue. Include what you ran,
the impact, and a minimal reproduction if you have one. You'll get an acknowledgement as
soon as it's seen; this is a small project, so please be patient on turnaround.

## Trust model

`mimic-mcp` is a local, stdio MCP server. It runs on the same machine as the agent that
invokes it, with that machine's permissions — it opens no network ports and makes no
outbound network calls of its own.

To do its job it **shells out to local binaries** (`ffmpeg`/`ffprobe`, and optionally a
whisper CLI, `aubio`, and macOS `swift`/`say`) and **reads and writes files at paths the
calling agent provides**. That means:

- File paths in a tool call are trusted to the extent the calling agent and its user are
  trusted. The server does not sandbox filesystem access — it can read the reference/
  footage paths it's given and write renders/temp files where told.
- Reference videos, scripts, and recipes are treated as data, but they are still fed to
  external tools (ffmpeg, whisper, Remotion). Only process media you're willing to hand
  to those tools.
- No secrets or API keys are required or stored; voiceover and OCR use on-device macOS
  facilities, and transcription uses a local whisper CLI.

Run it against footage and references you trust, the same way you'd treat any local CLI
your agent can drive.

## Supported versions

This is pre-1.0 software; fixes land on the latest published version. Please upgrade to
the newest release before reporting.

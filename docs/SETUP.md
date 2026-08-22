# Setup Guide

## Prerequisites

- An AI coding CLI — [Claude Code](https://claude.ai/code), Gemini CLI, Codex, Qwen Code, OpenCode, GitHub Copilot CLI, Antigravity CLI, or Grok Build CLI (see [Supported CLIs](SUPPORTED_CLIS.md))
- [Node.js](https://nodejs.org) 18+ and `git` — note: the Gemini CLI integration requires Node.js 20+, and `tracker.mjs` (SQLite indexing) requires 22.5+
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start

### Clone and open

```bash
git clone https://github.com/svy04/cicerone.git
cd cicerone
npm install
claude   # or codex / qwen / opencode / agy / grok
```

**On first launch, cicerone walks you through setup by chatting** — it asks for your CV, your details (name, target roles, salary), and sets up the job scanner with pre-configured companies. Nothing to edit by hand: just answer its questions. Then paste a job offer URL or description and it evaluates it, writes a report, generates a tailored PDF, and tracks it.

If you are using Codex, start the interactive session with `codex`. Slash commands are not guaranteed in Codex, so use the same mode names in a prompt if `/cicerone` is unavailable:

```text
Evaluate this JD with cicerone auto-pipeline: https://company.com/jobs/123
Run the cicerone scan mode.
Run the cicerone pipeline mode.
Run the cicerone pdf mode.
Run the cicerone email mode for the latest evaluated role. Draft only; never sends, submits, or clicks.
Run the cicerone tracker mode.
```

For one-shot workers or batch tasks in Codex, use `codex exec`. See [docs/CODEX.md](CODEX.md) for the full guide.

```bash
codex exec "Evaluate this JD with cicerone auto-pipeline: https://company.com/jobs/123"
codex exec "Run cicerone scan mode in this repo."
codex exec "Run cicerone pipeline mode for data/pipeline.md."
codex exec "Run cicerone pdf mode for the latest evaluated role."
codex exec "Run cicerone email mode for the latest evaluated role. Draft only; do not send, submit, or click anything."
codex exec "Run cicerone tracker mode and summarize the current statuses."
```

### Advanced — clone manually

<details>
<summary>Prefer to clone the repo yourself?</summary>

```bash
git clone https://github.com/svy04/cicerone.git
cd cicerone
npm install
```

Then open your AI CLI in the folder — the same first-run onboarding applies. Use this path if you want to track a specific branch, contribute, or audit the code before installing dependencies.

</details>

### PDF rendering (one-time)

PDFs are rendered with a headless Chromium. Install it once per machine:

```bash
npx playwright install chromium
```

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/cicerone scan` or ask the agent to run `scan` |
| Process pending URLs | `/cicerone pipeline` or ask the agent to run `pipeline` |
| Generate a PDF | `/cicerone pdf` or ask the agent to run `pdf` |
| Draft application email | `/cicerone email` or ask the agent to run `email`; draft-only, never sends, submits, or clicks |
| Batch evaluate | `/cicerone batch` or use `codex exec "Run cicerone batch mode ..."` |
| Check tracker status | `/cicerone tracker` or ask the agent to run `tracker` |
| Fill application form | `/cicerone apply` or ask the agent to run `apply` |

## Verify Setup

```bash
node cv-sync-check.mjs      # Check configuration
node verify-pipeline.mjs     # Check pipeline integrity
```

## Build Dashboard (Optional)

```bash
npm run serve:dashboard     # Opens TUI pipeline viewer
npm run build:dashboard     # Optional: build the standalone binary
```

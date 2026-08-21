> **Not published to npm.** This fork installs by `git clone` — see [docs/SETUP.md](../docs/SETUP.md).
> The package metadata below is inherited from the upstream project and kept because
> `bin/skill-entrypoints.mjs` in this folder is live code the updater imports.

# career-ops

One-command installer for [**career-ops**](https://github.com/svy04/cicerone) — the AI-powered job search pipeline built on Claude Code.

```bash
npx @svy04/cicerone init
```

This sets up a ready-to-use workspace:

1. Clones career-ops at the latest stable release
2. Installs dependencies

Then open your AI coding tool in the folder. **On first launch the agent walks you through setup — your CV, profile and target roles — just by chatting.** Nothing to configure by hand. career-ops is AI-agnostic — Claude Code, Gemini, Codex, Qwen, OpenCode, GitHub Copilot CLI, Antigravity CLI, and Grok Build CLI all work.

The installer bootstraps CLI skill entrypoints after clone, so new CLIs (e.g. Grok) work even when `npx` pulled an older release tag.

## Usage

```bash
npx @svy04/cicerone init [folder]   # default folder: ./career-ops
```

Prefer the manual route? `git clone` still works exactly as before — see the [setup guide](https://github.com/svy04/cicerone/blob/main/docs/SETUP.md).

## Requirements

- Node.js 18+
- git

## License

MIT © Santiago Fernández de Valderrama

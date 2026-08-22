# cicerone-plugin-{{NAME}}

A community plugin for [career-ops](https://github.com/svy04/cicerone).

## What it does

TODO: one paragraph.

## Install

```bash
# Once it's in the cicerone registry:
node plugins.mjs add {{NAME}}

# Before listing (install directly from your repo at a pinned commit):
node plugins.mjs add <your-github-user>/cicerone-plugin-{{NAME}} --sha <40-hex-commit>
```

Then enable + consent:

```bash
node plugins.mjs enable {{NAME}}            # shows the capability card
node plugins.mjs enable {{NAME}} --confirm  # grants it
```

## Configure

- Secrets go in your `.env` (the names are in `manifest.json` → `requiredEnv`).
- Non-secret options go in `config/plugins.yml` under `plugins.{{NAME}}`.

## Get it listed as approved

Open a registry PR against cicerone (see
[docs/PLUGINS.md](https://github.com/svy04/cicerone/blob/main/docs/PLUGINS.md)).

## License

MIT

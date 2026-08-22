---
name: cicerone
description: >-
  한국 채용 공고를 평가하고 지원 서류를 준비하는 도구. 공고 주소나 본문을 붙여넣었을 때,
  공고를 모아 달라고 할 때, 이력서나 경력기술서를 만들 때, 자기소개서 문항을 풀 때,
  지원 현황을 볼 때, 필기 전형과 면접을 준비할 때 씁니다.
  Korean job search pipeline — evaluate postings, prepare documents, track applications.
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[scan | discover | deep | pdf | latex | latex-tex | cover | career-description | written-test | email | add | expand | eu-swe | oferta | ofertas | apply | batch | tracker | agent-inbox | pipeline | contacto | training | project | interview-prep | interview | interview/plan | interview/practice | interview/debrief | interview-redflag | patterns | offer-prep | titles | upskill | followup | reply-watch | outcome | update]"
license: GPL-3.0-or-later
---

# cicerone -- Router

cicerone is a multi-CLI job-search command center. The routing below is shared across supported agent CLIs even when the invocation surface differs.

## Invocation Notes

- CLIs with slash-command registration can expose this router as `/cicerone`.
- In Cursor, this skill lives at `.cursor/skills/cicerone/` and is auto-discovered; ask for a mode by name, or paste a JD/URL to trigger auto-pipeline.
- Interactive Codex sessions use `codex` in the repo root. Slash commands are not guaranteed in Codex, so ask Codex to run the same mode by name if `/cicerone` is unavailable.
- Headless Codex workers use `codex exec "prompt"`.
- The routing semantics below stay the same regardless of whether the entrypoint is a slash command or a natural-language prompt.

Codex prompt examples that map to the same router semantics:

```text
Evaluate this JD with cicerone auto-pipeline: https://company.com/jobs/123
Run the cicerone scan mode and summarize new matches.
Run the cicerone pipeline mode for data/pipeline.md.
Run the cicerone pdf mode for the latest evaluated role.
Run the cicerone tracker mode and summarize the current statuses.
```

## Mode Routing

Determine the mode from `$mode`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `interview-prep` | `interview-prep` |
| `interview` | `interview` |
| `eu-swe` | `regional/eu-swe` |
| `eu-fintech` | `regional/eu-fintech` |
| `interview/plan` | `interview/plan` |
| `interview/practice` | `interview/practice` |
| `interview/debrief` | `interview/debrief` |
| `pdf` | `pdf` |
| `latex` | `latex` |
| `latex-tex` | `latex-tex` |
| `email` | `email` |
| `add` | `add` |
| `expand` | `expand` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `agent-inbox` | `agent-inbox` |
| `inbox` | `agent-inbox` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `discover` | `discover` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `offer-prep` | `offer-prep` |
| `titles` | `titles` |
| `upskill` | `upskill` |
| `followup` | `followup` |
| `reply-watch` | `reply-watch` |
| `outcome` | `outcome` |
| `interview-redflag` | `interview-redflag` |
| `update` | `update` |
| `cover` | `cover` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Output Language Directive

Before executing any mode, read `config/profile.yml` if it exists and resolve:

- `language.output` → ISO language code for human-facing output. Default: `en`.
- `language.modes_dir` → optional market-mode directory. This controls market vocabulary and local evaluation rules only.

Inject this directive after loading the mode instructions and before producing any user-visible content:

> Write all human-facing output in `{language.output}` regardless of the language of these instructions or of the job description. This includes reports, tracker notes, PDFs, cover letters, outreach, interview prep, form answers, and summaries. If `language.modes_dir` supplies market-specific vocabulary, keep the market logic but explain terms in `{language.output}` when needed.

`language.output` is authoritative for prose. `modes_dir` is market context; it must not force the prose language.

---

## Discovery Mode (no arguments)

If your CLI supports `/cicerone`, show this menu. In Codex, surface the same options in plain text and map the requested mode the same way.

Concrete equivalents for Codex prompt-driven sessions:

```text
/cicerone {JD}           ↔ "Evaluate this JD with cicerone auto-pipeline: {JD or URL}"
/cicerone scan           ↔ "Run the cicerone scan mode and summarize new matches."
/cicerone pipeline       ↔ "Run the cicerone pipeline mode for data/pipeline.md."
/cicerone pdf            ↔ "Run the cicerone pdf mode for the latest evaluated role."
/cicerone email          ↔ "Run the cicerone email mode for the latest evaluated role."
/cicerone tracker        ↔ "Run the cicerone tracker mode and summarize the current statuses."
```

Show this menu:

```
cicerone -- Command Center

Available commands:
  /cicerone {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /cicerone pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /cicerone oferta    → Evaluation only A-F (no auto PDF)
  /cicerone ofertas   → Compare and rank multiple offers
  /cicerone contacto  → LinkedIn power move: find contacts + draft message
  /cicerone deep      → Deep research prompt about company
  /cicerone interview-prep → Generate company-specific interview prep doc
  /cicerone interview    → Interactive profile/CV onboarding interview
  /cicerone eu-swe    → Calibrate a European SWE application before CV/apply/interview
  /cicerone eu-fintech → Scan 21 EU fintech portals for Product Manager roles (zero-token)
  /cicerone interview/plan → Time-blocked prep plan for an upcoming interview
  /cicerone interview/practice → Practice interview, one question at a time with feedback
  /cicerone interview/debrief → Post-interview debrief: close gaps, predict next round
  /cicerone pdf       → PDF only, ATS-optimized CV
  /cicerone latex     → Export CV as LaTeX/Overleaf .tex
  /cicerone latex-tex → Tailor your own resume.tex in place (opt-in; cv.md stays default)
  /cicerone cover     → Cover letter: standalone JD paste or /cicerone cover {slug}
  /cicerone email     → Formal application email draft (draft-only; never sends, submits, or clicks)
  /cicerone add       → Add a project/paper/role to your CV (fetch + preview + confirm)
  /cicerone expand    → Auto-discover and add missing competencies from profile links
  /cicerone training  → Evaluate course/cert against North Star
  /cicerone project   → Evaluate portfolio project idea
  /cicerone tracker   → Application status overview
  /cicerone agent-inbox → Queue/drain requests for the next session (data/agent-inbox.md)
  /cicerone apply     → Live application assistant (reads form + generates answers)
  /cicerone scan      → Scan portals and discover new offers
  /cicerone discover  → Resolve a company list to scannable ATS boards + append to portals.yml (zero-token)
  /cicerone batch     → Batch processing with parallel workers
  /cicerone patterns  → Analyze rejection patterns and improve targeting
  /cicerone offer-prep → Read a received offer/contract with the candidate: clause walk + lawyer questions (not legal advice)
  /cicerone titles    → Suggest adjacent job titles from your CV to broaden the search
  /cicerone upskill   → Aggregate skill-gap analysis from your evaluated reports
  /cicerone followup  → Follow-up cadence tracker: flag overdue, generate drafts
  /cicerone outcome   → Record application outcome & archive artifacts
  /cicerone update    → Update cicerone system files with diff preview + compat check

Inbox: add URLs to data/pipeline.md → /cicerone pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

If `modes/_custom.md` exists, read it after `modes/_profile.md` and before the selected mode file. It contains user house rules and procedural preferences. It may override workflow/style defaults, but it never adds factual claims about the candidate.

### Modes that require `_shared.md` + their mode file

Read `modes/_shared.md` + `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

### Standalone modes with profile and custom context

Read `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `tracker`, `agent-inbox`, `deep`, `interview-prep`, `interview`, `regional/eu-swe`, `interview/plan`, `interview/practice`, `interview/debrief`, `latex`, `latex-tex`, `training`, `project`, `patterns`, `titles`, `upskill`, `followup`, `reply-watch`, `outcome`, `cover`, `email`, `add`, `offer-prep`, `discover`

### Modes delegated to subagent

For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as a worker/subagent with the content of `_shared.md` + `_profile.md` (if exists) + `_custom.md` (if exists) + `modes/{mode}.md` injected into the worker prompt. If your CLI exposes an `Agent(...)` primitive, the call looks like this:

```python
Agent(
  subagent_type="general-purpose",
  prompt="[output language directive]\n\n[content of modes/_shared.md]\n\n[content of modes/_profile.md if exists]\n\n[content of modes/_custom.md if exists]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="cicerone {mode}"
)
```

Execute the instructions from the loaded mode file.

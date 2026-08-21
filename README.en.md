# hwadu (화두)

A command-line tool for evaluating Korean job postings and preparing application documents. It runs inside an AI coding CLI (Claude Code, Codex, and others) and keeps every file on your own machine.

[한국어](README.md) | [English](README.en.md)

- **Splits open recruitment from rolling hiring.** Korea runs two tracks with different stages and different documents, so the evaluation decides which one you are in before anything else
- **Does not ghostwrite your 자기소개서.** It reads the employer's prompts, finds which of your experiences answer them, and budgets the character count. You write the sentences
- **Decomposes a stated salary.** Whether severance is folded in, how many hours of fixed overtime it covers, whether a target bonus was counted up front
- **Builds a 경력기술서 separately.** It is the main document for experienced hires and a different thing from a résumé
- **Treats the written stage as a real gate.** Aptitude tests and coding tests sit between documents and interviews
- **Flags what the Fair Hiring Procedure Act prohibits** when a posting asks for it
- **Keeps every application in one file** instead of scattered across job sites

```
$ node salary-korea.mjs offer 52000000 --퇴직금포함 --고정OT 20

제시받은 연봉    52,000,000원
확실한 금액      48,000,000원

분해
  · 퇴직금이 포함된 제시액입니다. 통상 방식대로 나누면 실제 급여는 약 48,000,000원이고
    나머지가 퇴직금 적립분입니다.
  · 고정 초과근로 20시간분이 급여에 들어 있습니다.

아직 확인 못 한 것 — 처우 협의에서 물어보세요
  ? 성과급이 제시액에 포함됐는지 별도인지 확인하지 않았습니다
```

---

## Who this is for

Someone applying to Korean employers. The prompts under `modes/` are written in Korean and encode Korean hiring practice — the two-track split, the essay-question 자기소개서, aptitude and coding tests, the way "salary" is quoted.

If you are applying abroad, the upstream English specification is preserved under `modes/global/`, including visa sponsorship checks, US pay-transparency law, and employment-agency licensing signals.

## Install

```bash
git clone https://github.com/svy04/hwadu.git
cd hwadu
npm install
```

## Set up

```bash
cp config/profile.example.yml config/profile.yml
cp examples/cv-example.md cv.md
```

Fill in `config/profile.yml`: whether you are a new graduate or an experienced hire, which roles you are after, and your compensation floor.

## Evaluate a posting

Paste a URL into your AI CLI:

```
/hwadu https://kakaopay.career.greetinghr.com/ko/o/206749
```

It checks the posting is still open, decides which hiring track it belongs to, then produces blocks A through G: résumé fit, compensation with its sources, organizational signals, and whether this is a real opening.

## Where postings come from

**This tool does not scrape job portals.** Saramin's terms of service art. 23-3 and Wanted's art. 19-7 forbid automated collection; Incruit's robots.txt disallows everything. The JobKorea–Saramin dispute over posting collection was settled at the Supreme Court of Korea (2017다224395) and followed by a ₩12bn settlement.

Three paths are available instead: URLs you paste, Saramin's public API using a key you registered for yourself, and the career pages of companies you list in `portals.yml`.

## Why it does not write your 자기소개서

Korean employers actively screen for AI-written application essays.

- Of 14 large-group affiliates and public corporations running 2025 H2 open recruitment, 9 of the 10 that had adopted AI were checking plagiarism scores at the document stage (Yonhap, 2025-09-29)
- Asked what they do when AI authorship is confirmed: 42.2% deduct points, 23.2% reject (Ministry of Employment and Labour, 2023 H2 hiring survey, 315 of Korea's top 500 companies by revenue)
- The National Pension Service wrote it directly into a 2025 posting: "AI (ChatGPT etc.) use and plagiarism will be thoroughly verified"

The tool also refuses to help evade that detection. That such products exist is not a reason to build one.

## What to know

**Only one Korean ATS has a dedicated provider: Greeting.** Ninehire and JOBDA expose no posting list readable without a login, so postings there have to be pasted by URL.

**Market facts were verified on 2026-08-21.** Insurance rates, tax brackets, recruitment calendars and platform terms all change. Every claim's source and verification date is in [docs/market-evidence.md](docs/market-evidence.md), including the ones we could find no evidence for.

**Take-home pay is an estimate.** It varies with dependants and deductions, monthly withholding follows a separate table, and the final figure is settled at year-end. It does not replace a contract.

## Why "hwadu"

A 화두 is the question a teacher hands a student instead of an answer. The student has to break through it themselves.

That is how this tool treats an employer's essay prompts. It unpacks what the prompt is asking, finds which of your experiences answer it, and budgets the structure. The sentences are yours.

## Lineage

Forked from [santifer/career-ops](https://github.com/santifer/career-ops), which was built for the US market. This repository replaced that specification with the Korean one; [docs/korea-fork.md](docs/korea-fork.md) records exactly what changed.

The application tracker, document pipeline, updater, and 4,900-plus checks are upstream's and stay as they are.

## License

MIT. The upstream name "career-ops" is a trademark reserved by its author, so this fork carries its own name.

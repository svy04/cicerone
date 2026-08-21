# hwadu (화두)

A command-line tool for evaluating Korean job postings and preparing application documents. It runs inside an AI coding CLI (Claude Code, Codex, and others) and keeps every file on your own machine.

[한국어](README.md) | [English](README.en.md)

- **Splits open recruitment from rolling hiring.** Korea runs two tracks with different stages and different documents, so the evaluation decides which one you are in before anything else
- **Drafts your 자기소개서 prompt by prompt.** It reads the employer's questions, assigns which of your experiences answer each one, writes to the character limit, and marks the places worth rewriting in your own words
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

Paste a URL and it reads that one. To collect several at once, `portals.yml` lists the sources.

| Source | How it reads | Worth knowing |
| --- | --- | --- |
| Saramin | Public search results page | Needs a keyword or a region — it will not sweep the whole board |
| JobKorea | Duty / region / industry list tabs | robots.txt disallows keyword search, so keywords are applied to the fetched list on your own machine |
| Jumpit | Developer-only listing | Tech stack and experience range arrive with the list |
| Remember Career | Sitemap for IDs, then one posting at a time | The only source whose request count scales with postings — about 30 seconds for 25 |
| Companies on Greeting | The company's own careers page | Only the companies you list |
| Worknet / 고용24 | Public API | Needs a key you register for yourself. Public-sector and smaller-employer postings live here, and more of them publish a salary figure |

Four rules govern every request: identify the tool in the User-Agent, read robots.txt before fetching, keep the source URL, redistribute nothing. The second is enforced in code — `providers/_robots.mjs` fetches and parses the file, and a disallowed path stops there.

Those rules are where the Seoul Central District Court drew the line in the JobKorea–Saramin collection dispute (2015가합517982): what it faulted was a competing job site republishing another's postings while hiding its identity and rotating IPs. Incruit and LinkedIn disallow everything in robots.txt, so neither has a module.

Wanted is absent for a different reason. A request that identifies itself is cut off at the CDN with a 403 on every path, robots.txt included (measured 2026-08-21) — the file needed to honour rule two cannot be fetched at all. A browser-like User-Agent gets through, which costs rule one. Paste a Wanted URL and it evaluates one posting at a time.

Saramin's official API is also available: register for a key yourself at [oapi.saramin.co.kr/join](https://oapi.saramin.co.kr/join) and set `SARAMIN_ACCESS_KEY`. It is capped at 500 calls a day and its terms forbid reselling the data. Without a key the search-page reader covers the same board.

## What to know before you send a 자기소개서

The tool drafts it. One fact belongs alongside that: **some Korean employers screen for AI-written application essays.**

- Of 14 large-group affiliates and public corporations running 2025 H2 open recruitment, 9 of the 10 that had adopted AI were checking plagiarism scores at the document stage (Yonhap, 2025-09-29)
- Asked what they do when AI authorship is confirmed: 42.2% deduct points, 23.2% reject (Ministry of Employment and Labour, 2023 H2 hiring survey, 315 of Korea's top 500 companies by revenue)
- The National Pension Service wrote it directly into a 2025 posting: "AI (ChatGPT etc.) use and plagiarism will be thoroughly verified"

So the tool marks what to rewrite, and recommends you put it in your own words before sending — an even voice is what stands out, and you have to defend those sentences in the interview. The notice appears once, not on every run.

It does not help evade the detection: scrambling the prose to fool a checker is worse when it fails. It also writes nothing your résumé and career record do not support — an invented project collapses the moment an interviewer asks about it.

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

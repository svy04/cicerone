#!/usr/bin/env node
// @ts-check
// deadlines.mjs — 마감이 가까운 지원을 앞에 놓고 보여 준다.
//
// 왜 있나: 한국 공채는 마감이 짧고 여러 회사가 같은 시기에 몰린다. 상반기는
// 3월, 하반기는 9월에 몰리고, 놓치면 다음 기회가 반년 뒤다. 수시 채용을
// 전제한 원본에는 이 문제가 없어서 대응물이 없었다.
//
// 어디서 읽나: `data/applications.md` 의 Notes 칸에 있는 `due: YYYY-MM-DD`
// 구획이다. `posted:` 와 같은 방식이고, 같은 이유로 **앞선 구획일 때만** 읽는다
// — 보통 문장에 섞인 "due" 는 마감일이 아니다(`asked when the answer is due`).
//
// 쓰는 법:
//   node deadlines.mjs              오늘 기준으로 남은 것 전부
//   node deadlines.mjs --within 7   이레 안에 마감하는 것만
//   node deadlines.mjs --all        지난 것도 함께

import { readFileSync, existsSync } from 'node:fs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { resolveTrackerPath } from './tracker-utils.mjs';

/**
 * Notes 칸에서 마감일을 꺼낸다. 구획으로 적힌 것만 읽는다.
 *
 * 받는 형태: `due: 2026-09-20` · `due:2026-09-20` · `마감: 2026-09-20`
 * 앞이 줄머리이거나 `;` `|` 여야 한다 — 문장 속의 due 는 마감일이 아니다.
 *
 * @param {string} notes
 * @returns {string} `YYYY-MM-DD` 또는 빈 문자열
 */
export function extractDue(notes) {
  if (typeof notes !== 'string') return '';
  const m = notes.match(/(?:^|[;|])\s*(?:due|마감)\s*(?::\s*|\s+)(20\d{2}-\d{2}-\d{2})\b/i);
  return m ? m[1] : '';
}

/**
 * 마감까지 남은 날. 오늘을 0 으로 센다.
 *
 * 시각이 아니라 달력 날짜로 센다 — "오늘 마감"과 "어제 마감"은 몇 시간
 * 차이여도 다른 일이다.
 *
 * @param {string} due `YYYY-MM-DD`
 * @param {Date} [today]
 * @returns {number|null} 날짜가 아니면 null
 */
export function daysLeft(due, today = new Date()) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(due)) return null;
  const [y, mo, d] = due.split('-').map(Number);
  const target = Date.UTC(y, mo - 1, d);
  if (Number.isNaN(target)) return null;
  const here = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - here) / 86_400_000);
}

/**
 * 마감이 적힌 행을 남은 날 순으로 돌려준다.
 *
 * @param {string} markdown `data/applications.md` 원문
 * @param {{today?: Date, within?: number|null, includePast?: boolean}} [opts]
 * @returns {Array<{num: number, company: string, role: string, status: string, due: string, left: number}>}
 */
export function collectDeadlines(markdown, opts = {}) {
  const { today = new Date(), within = null, includePast = false } = opts;
  const lines = String(markdown || '').split(/\r?\n/);
  const colmap = resolveColumns(lines);
  if (!colmap) return [];

  const out = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    const due = extractDue(row.notes);
    if (!due) continue;
    const left = daysLeft(due, today);
    if (left == null) continue;
    if (!includePast && left < 0) continue;
    if (within != null && left > within) continue;
    out.push({ num: row.num, company: row.company, role: row.role, status: row.status, due, left });
  }
  out.sort((a, b) => a.left - b.left || a.num - b.num);
  return out;
}

/**
 * 남은 날을 사람이 읽는 말로.
 * @param {number} left
 * @returns {string}
 */
export function describe(left) {
  if (left < 0) return `${-left}일 지남`;
  if (left === 0) return '오늘 마감';
  if (left === 1) return '내일 마감';
  return `${left}일 남음`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`deadlines.mjs — 마감이 가까운 지원을 앞에 놓고 보여 줍니다.

  node deadlines.mjs              남은 것 전부
  node deadlines.mjs --within 7   이레 안에 마감하는 것만
  node deadlines.mjs --all        지난 것도 함께

마감일은 지원 추적 표(data/applications.md)의 Notes 칸에
\`due: YYYY-MM-DD\` 로 적습니다. 공고를 평가하면 자동으로 들어갑니다.`);
    return 0;
  }

  const bad = args.find(a => a.startsWith('-') && !['--all', '--within', '-h', '--help'].includes(a));
  if (bad) {
    console.error(`deadlines.mjs: 모르는 옵션입니다: ${bad}. \`--help\` 를 보세요.`);
    return 1;
  }

  let within = null;
  const wi = args.indexOf('--within');
  if (wi !== -1) {
    const raw = args[wi + 1];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      console.error('deadlines.mjs: --within 뒤에는 0 이상의 날수를 적습니다 (예: --within 7)');
      return 1;
    }
    within = n;
  }

  const trackerPath = resolveTrackerPath(process.cwd());
  if (!trackerPath || !existsSync(trackerPath)) {
    console.log('지원 추적 표가 아직 없습니다. 공고를 평가하면 만들어집니다.');
    return 0;
  }

  const rows = collectDeadlines(readFileSync(trackerPath, 'utf8'), {
    within,
    includePast: args.includes('--all'),
  });

  if (rows.length === 0) {
    console.log(within != null
      ? `${within}일 안에 마감하는 지원이 없습니다.`
      : '마감일이 적힌 지원이 없습니다. 공고를 평가하면 Notes 에 `due:` 로 들어갑니다.');
    return 0;
  }

  console.log('\n마감이 가까운 순서\n');
  for (const r of rows) {
    const mark = r.left < 0 ? '  ' : r.left <= 3 ? '❗' : r.left <= 7 ? '· ' : '  ';
    const company = (r.company || '—').slice(0, 22).padEnd(22);
    const role = (r.role || '—').slice(0, 26).padEnd(26);
    console.log(`${mark}#${String(r.num).padStart(3)}  ${company} ${role} ${r.due}  ${describe(r.left)}`);
  }
  console.log(`\n${rows.length}건. 공채는 마감이 짧습니다 — 서류를 미리 준비해 두세요.\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('deadlines.mjs')) {
  process.exit(main());
}

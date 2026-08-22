#!/usr/bin/env node
// @ts-check
// deadlines.test.mjs — 마감 관리 검사.
//
// 착수 시 고정한 검사입니다.
//   1) 구획으로 적힌 마감일만 읽는다 (문장 속의 due 는 마감일이 아니다)
//   2) 남은 날을 달력 날짜로 센다 (시각 차이로 하루가 밀리지 않는다)
//   3) 마감이 가까운 순서로 준다
//   4) 지난 것은 기본으로 빼고, 달라고 하면 준다
//
// 네트워크를 쓰지 않습니다.

import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { extractDue, daysLeft, collectDeadlines, describe } from '../deadlines.mjs';

function test(name, fn) {
  try { fn(); pass(name); } catch (err) { fail(name + ' — ' + err.message); }
}

// ── 마감일 읽기 ──────────────────────────────────────────────

test('마감: 구획으로 적힌 것을 읽는다', () => {
  assert.equal(extractDue('due: 2026-09-20'), '2026-09-20');
  assert.equal(extractDue('핀테크, 판교; due: 2026-09-20'), '2026-09-20');
  assert.equal(extractDue('due:2026-09-20'), '2026-09-20');
  assert.equal(extractDue('마감: 2026-09-20'), '2026-09-20');
  assert.equal(extractDue('posted: 2026-08-01; 마감: 2026-09-20'), '2026-09-20');
});

test('마감: 문장 속의 due 는 마감일이 아니다', () => {
  // posted: 가 같은 이유로 앞선 구획만 읽는 것과 같은 판단이다.
  assert.equal(extractDue('asked when the answer is due 2026-09-20'), '');
  assert.equal(extractDue('과제 제출이 due 2026-09-20 라고 함'), '');
});

test('마감: 날짜가 아니면 빈 값', () => {
  assert.equal(extractDue('due: 곧'), '');
  assert.equal(extractDue('due: 2026-9-20'), '');
  assert.equal(extractDue(''), '');
  assert.equal(extractDue(null), '');
});

// ── 남은 날 ──────────────────────────────────────────────────

test('마감: 남은 날을 달력 날짜로 센다', () => {
  const today = new Date(2026, 8, 15, 23, 30);   // 9월 15일 밤 11시 반
  assert.equal(daysLeft('2026-09-15', today), 0, '오늘은 0');
  assert.equal(daysLeft('2026-09-16', today), 1, '내일은 1');
  assert.equal(daysLeft('2026-09-20', today), 5);
  assert.equal(daysLeft('2026-09-14', today), -1, '어제는 -1');
});

test('마감: 시각이 달라도 같은 날은 같은 값', () => {
  // 밤 11시에 세든 새벽 1시에 세든 "오늘 마감"은 오늘 마감이다.
  const late = new Date(2026, 8, 15, 23, 59);
  const early = new Date(2026, 8, 15, 0, 1);
  assert.equal(daysLeft('2026-09-20', late), daysLeft('2026-09-20', early));
});

test('마감: 날짜가 아니면 null', () => {
  assert.equal(daysLeft('내일'), null);
  assert.equal(daysLeft(''), null);
});

// ── 목록 ─────────────────────────────────────────────────────

const TRACKER = `# Applications

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-01 | 카카오페이 | 백엔드 | 4.2/5 | Applied | ✅ | [1](../reports/001.md) | 판교; due: 2026-09-20 |
| 2 | 2026-08-02 | 토스 | 서버 | 4.0/5 | Evaluated | ❌ | — | due: 2026-09-16 |
| 3 | 2026-08-03 | 네이버 | 플랫폼 | 3.8/5 | Applied | ❌ | — | 공채; 마감: 2026-09-30 |
| 4 | 2026-08-04 | 라인 | 백엔드 | 3.5/5 | Applied | ❌ | — | 마감일 없음 |
| 5 | 2026-08-05 | 쿠팡 | 서버 | 4.1/5 | Applied | ❌ | — | due: 2026-09-10 |
`;

const TODAY = new Date(2026, 8, 15);   // 2026-09-15

test('마감: 가까운 순서로 준다', () => {
  const rows = collectDeadlines(TRACKER, { today: TODAY });
  assert.deepEqual(rows.map(r => r.num), [2, 1, 3], '16일 → 20일 → 30일 순');
  assert.equal(rows[0].company, '토스');
  assert.equal(rows[0].left, 1);
});

test('마감: 지난 것은 기본으로 뺀다', () => {
  const rows = collectDeadlines(TRACKER, { today: TODAY });
  assert.ok(!rows.some(r => r.num === 5), '9월 10일은 이미 지났다');
});

test('마감: 달라고 하면 지난 것도 준다', () => {
  const rows = collectDeadlines(TRACKER, { today: TODAY, includePast: true });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].num, 5, '지난 것이 맨 앞');
  assert.equal(rows[0].left, -5);
});

test('마감: 기간을 좁힐 수 있다', () => {
  const rows = collectDeadlines(TRACKER, { today: TODAY, within: 7 });
  assert.deepEqual(rows.map(r => r.num), [2, 1], '이레 안은 둘');
});

test('마감: 마감일이 없는 행은 목록에 없다', () => {
  const rows = collectDeadlines(TRACKER, { today: TODAY, includePast: true });
  assert.ok(!rows.some(r => r.num === 4), '라인은 마감일이 없다');
});

test('마감: 표가 없으면 빈 목록', () => {
  assert.deepEqual(collectDeadlines(''), []);
  assert.deepEqual(collectDeadlines('그냥 글'), []);
  assert.deepEqual(collectDeadlines(null), []);
});

// ── 표시 ─────────────────────────────────────────────────────

test('마감: 남은 날을 사람 말로 바꾼다', () => {
  assert.equal(describe(0), '오늘 마감');
  assert.equal(describe(1), '내일 마감');
  assert.equal(describe(5), '5일 남음');
  assert.equal(describe(-3), '3일 지남');
});

// 이 파일은 test-all.mjs 가 찾아 실행합니다.

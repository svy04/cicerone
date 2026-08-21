#!/usr/bin/env node
// @ts-check
// salary-korea.test.mjs — salary-korea.mjs 검사.
//
// 검사 기준은 착수 시 고정한 것입니다.
//   1) 요율 상수가 규격서의 수치와 정확히 일치한다
//   2) 국민연금 기준소득월액 상한이 실제로 적용된다
//   3) 식대 비과세가 월 20만원에서 잘린다
//   4) 퇴직금 포함 제시액이 12/13으로 나뉜다
//   5) 확인하지 않은 항목이 "물어볼 것"으로 남는다
//   6) 공제율이 상식적인 범위에 있다

import assert from 'node:assert/strict';
import {
  RATES,
  estimateNetPay,
  breakdownOffer,
  earnedIncomeDeduction,
  incomeTaxFromBase,
} from './salary-korea.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + err.message);
  }
}

console.log('\nsalary-korea.mjs 검사\n');

// ── 1. 요율 상수 ─────────────────────────────────────────────
test('국민연금 근로자 부담이 4.75%다', () => {
  assert.equal(RATES.nationalPension, 0.0475);
});

test('건강보험 근로자 부담이 3.595%다', () => {
  assert.equal(RATES.healthInsurance, 0.03595);
});

test('장기요양이 건강보험료의 13.14%다', () => {
  assert.equal(RATES.longTermCareOfHealth, 0.1314);
});

test('고용보험이 0.9%다', () => {
  assert.equal(RATES.employmentInsurance, 0.009);
});

test('국민연금 기준소득월액 상한이 659만원이다', () => {
  assert.equal(RATES.pensionMonthlyCap, 6590000);
});

test('식대 비과세 한도가 월 20만원이다', () => {
  assert.equal(RATES.mealAllowanceTaxFreeMonthly, 200000);
});

// ── 2. 국민연금 상한 ─────────────────────────────────────────
test('연봉이 상한을 넘으면 국민연금이 더 늘지 않는다', () => {
  const low = estimateNetPay(100000000);
  const high = estimateNetPay(300000000);
  assert.equal(
    low.deductions.nationalPension,
    high.deductions.nationalPension,
    '상한 초과 구간에서 국민연금이 달라졌다',
  );
  const expected = Math.floor(RATES.pensionMonthlyCap * RATES.nationalPension) * 12;
  assert.equal(high.deductions.nationalPension, expected);
});

test('상한 아래에서는 연봉에 비례해 국민연금이 는다', () => {
  const a = estimateNetPay(30000000);
  const b = estimateNetPay(50000000);
  assert.ok(
    b.deductions.nationalPension > a.deductions.nationalPension,
    '상한 아래인데 국민연금이 늘지 않았다',
  );
});

// ── 3. 식대 비과세 ───────────────────────────────────────────
test('식대 20만원까지만 비과세로 잡힌다', () => {
  const at = estimateNetPay(50000000, { mealAllowanceMonthly: 200000 });
  const over = estimateNetPay(50000000, { mealAllowanceMonthly: 500000 });
  assert.equal(at.taxFreeAnnual, 2400000);
  assert.equal(over.taxFreeAnnual, 2400000, '20만원을 넘는 식대가 비과세로 잡혔다');
});

test('식대가 있으면 공제가 줄어 실수령이 는다', () => {
  const without = estimateNetPay(50000000);
  const withMeal = estimateNetPay(50000000, { mealAllowanceMonthly: 200000 });
  assert.ok(
    withMeal.netAnnual > without.netAnnual,
    '비과세 식대가 있는데 실수령이 늘지 않았다',
  );
});

// ── 4. 퇴직금 포함 분해 ──────────────────────────────────────
test('퇴직금 포함이면 제시액이 12/13으로 나뉜다', () => {
  const r = breakdownOffer({ statedAnnual: 52000000, severanceIncluded: true });
  assert.equal(r.guaranteedAnnual, Math.floor(52000000 * 12 / 13));
  assert.ok(r.notes.some(n => n.includes('퇴직금')), '퇴직금 설명이 없다');
});

test('퇴직금 별도면 제시액이 그대로 남는다', () => {
  const r = breakdownOffer({ statedAnnual: 52000000, severanceIncluded: false });
  assert.equal(r.guaranteedAnnual, 52000000);
});

test('제시액에 포함된 성과급은 확실한 금액에서 빠진다', () => {
  const r = breakdownOffer({
    statedAnnual: 60000000,
    severanceIncluded: false,
    bonusIncludedAmount: 10000000,
  });
  assert.equal(r.guaranteedAnnual, 50000000);
});

// ── 5. 확인 안 한 항목 ───────────────────────────────────────
test('아무것도 밝히지 않으면 물어볼 것이 세 개 남는다', () => {
  const r = breakdownOffer({ statedAnnual: 50000000 });
  assert.equal(r.unknowns.length, 3, '물어볼 항목 수가 3이 아니다: ' + r.unknowns.length);
  const joined = r.unknowns.join(' ');
  assert.ok(joined.includes('퇴직금'), '퇴직금 질문이 없다');
  assert.ok(joined.includes('성과급'), '성과급 질문이 없다');
  assert.ok(joined.includes('초과근로'), '고정 초과근로 질문이 없다');
});

test('전부 밝히면 물어볼 것이 남지 않는다', () => {
  const r = breakdownOffer({
    statedAnnual: 50000000,
    severanceIncluded: false,
    bonusIncludedAmount: 0,
    fixedOvertimeHours: 0,
  });
  assert.equal(r.unknowns.length, 0, '남은 질문: ' + r.unknowns.join(' / '));
});

// ── 6. 공제율 범위 ───────────────────────────────────────────
test('연봉 5천만원의 공제율이 12~20% 사이다', () => {
  const r = estimateNetPay(50000000);
  const rate = r.effectiveDeductionRate;
  assert.ok(rate > 0.12 && rate < 0.20, '공제율이 범위를 벗어났다: ' + (rate * 100).toFixed(1) + '%');
});

test('연봉이 높을수록 공제율이 오른다', () => {
  const a = estimateNetPay(30000000);
  const b = estimateNetPay(80000000);
  const c = estimateNetPay(150000000);
  assert.ok(a.effectiveDeductionRate < b.effectiveDeductionRate);
  assert.ok(b.effectiveDeductionRate < c.effectiveDeductionRate);
});

test('실수령이 세전보다 크지 않다', () => {
  for (const gross of [20000000, 50000000, 100000000, 200000000]) {
    const r = estimateNetPay(gross);
    assert.ok(r.netAnnual > 0 && r.netAnnual < gross, gross + '원에서 실수령이 이상하다');
  }
});

// ── 7. 세법 계산 ─────────────────────────────────────────────
test('근로소득공제 한도가 2천만원이다', () => {
  assert.ok(earnedIncomeDeduction(1000000000) <= 20000000);
});

test('과세표준 구간별 산출세액이 맞다', () => {
  // 1,400만원 이하 6%
  assert.equal(incomeTaxFromBase(10000000), Math.floor(10000000 * 0.06));
  // 5,000만원 구간 15%, 누진공제 126만
  assert.equal(incomeTaxFromBase(30000000), Math.floor(30000000 * 0.15 - 1260000));
});

test('과세표준 0이면 세금도 0이다', () => {
  assert.equal(incomeTaxFromBase(0), 0);
  assert.equal(incomeTaxFromBase(-1000), 0);
});

// ── 8. 한계 고지 ─────────────────────────────────────────────
test('추정이라는 사실이 결과에 붙어 있다', () => {
  const r = estimateNetPay(50000000);
  assert.ok(r.caveat && r.caveat.includes('추정'), '한계 고지가 없다');
});

console.log('\n' + passed + ' 통과, ' + failed + ' 실패\n');
process.exit(failed === 0 ? 0 : 1);

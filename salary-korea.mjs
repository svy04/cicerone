#!/usr/bin/env node
// @ts-check
// salary-korea.mjs — 한국 급여 분해기.
//
// 두 가지를 합니다.
//   1) 제시받은 "연봉"에 무엇이 들어 있는지 분해합니다 (퇴직금·고정 초과근로수당·성과급)
//   2) 세전 연봉에서 실수령액을 추정합니다
//
// 왜 필요한가: 한국에서 "연봉"은 법률 용어가 아니라 관행어입니다. 같은 5,000만 원이라도
// 퇴직금이 포함됐는지, 고정 초과근로수당이 들어 있는지, 목표 성과급을 미리 넣었는지에 따라
// 실제로 받는 돈이 크게 달라집니다. 이 셋을 묻지 않으면 오퍼 비교가 성립하지 않습니다.
//
// 수치 출처 (2026-08-21 확인):
//   국민연금 근로자 부담 4.75%      — 보건복지부 2025-12-29 보도자료
//   건강보험 근로자 부담 3.595%     — 보건복지부 2025-08-28 보도자료
//   장기요양 = 건강보험료의 13.14%  — 보건복지부 2025-11-04 보도자료
//   고용보험(실업급여) 0.9%
//   국민연금 기준소득월액 상한 659만원 (2026-07-01 ~ 2027-06-30) — 국민연금공단
//   식대 비과세 월 20만원           — 소득세법 제12조 제3호 러목
//   소득세 누진세율                 — 소득세법 제55조
//   근로소득공제                    — 소득세법 제47조
//   근로소득세액공제                — 소득세법 제59조
//
// 한계: 소득세는 부양가족·세액공제·비과세 항목에 따라 사람마다 달라집니다. 이 계산은
// 본인 기본공제와 근로소득세액공제만 반영한 개략 추정이고, 매달 떼는 금액은 간이세액표를
// 따르며 최종 금액은 연말정산으로 정산됩니다. 계약서를 대신할 수 없습니다.

export const RATES = {
  nationalPension: 0.0475,
  healthInsurance: 0.03595,
  longTermCareOfHealth: 0.1314,
  employmentInsurance: 0.009,
  pensionMonthlyCap: 6590000,   // 기준소득월액 상한
  pensionMonthlyFloor: 400000,  // 기준소득월액 하한
  mealAllowanceTaxFreeMonthly: 200000,
  localIncomeTaxRate: 0.1,      // 소득세의 10%
};

// 소득세법 제55조 — [과세표준 상한, 세율, 누진공제]
const TAX_BRACKETS = [
  [14000000, 0.06, 0],
  [50000000, 0.15, 1260000],
  [88000000, 0.24, 5760000],
  [150000000, 0.35, 15440000],
  [300000000, 0.38, 19940000],
  [500000000, 0.40, 25940000],
  [1000000000, 0.42, 35940000],
  [Infinity, 0.45, 65940000],
];

/**
 * 근로소득공제 (소득세법 제47조). 공제 한도 2,000만원.
 * @param {number} grossAnnual 총급여
 * @returns {number}
 */
export function earnedIncomeDeduction(grossAnnual) {
  const g = Math.max(0, grossAnnual);
  let d;
  if (g <= 5000000) d = g * 0.7;
  else if (g <= 15000000) d = 3500000 + (g - 5000000) * 0.4;
  else if (g <= 45000000) d = 7500000 + (g - 15000000) * 0.15;
  else if (g <= 100000000) d = 12000000 + (g - 45000000) * 0.05;
  else d = 14750000 + (g - 100000000) * 0.02;
  return Math.min(Math.floor(d), 20000000);
}

/**
 * 과세표준에 누진세율을 적용한 산출세액.
 * @param {number} taxBase 과세표준
 * @returns {number}
 */
export function incomeTaxFromBase(taxBase) {
  const b = Math.max(0, taxBase);
  for (const [ceiling, rate, deduct] of TAX_BRACKETS) {
    if (b <= ceiling) return Math.max(0, Math.floor(b * rate - deduct));
  }
  return 0;
}

/**
 * 근로소득세액공제 (소득세법 제59조).
 * @param {number} computedTax 산출세액
 * @param {number} grossAnnual 총급여
 * @returns {number}
 */
export function earnedIncomeTaxCredit(computedTax, grossAnnual) {
  const base = computedTax <= 1300000
    ? computedTax * 0.55
    : 715000 + (computedTax - 1300000) * 0.30;

  let cap;
  if (grossAnnual <= 33000000) cap = 740000;
  else if (grossAnnual <= 70000000) cap = Math.max(660000, 740000 - (grossAnnual - 33000000) * 0.008);
  else if (grossAnnual <= 120000000) cap = Math.max(500000, 660000 - (grossAnnual - 70000000) * 0.005);
  else cap = Math.max(200000, 500000 - (grossAnnual - 120000000) * 0.005);

  return Math.floor(Math.min(base, cap));
}

/**
 * 세전 연봉에서 실수령액을 추정합니다.
 *
 * @param {number} grossAnnual 세전 연봉(원). 비과세 항목을 포함한 총액
 * @param {{mealAllowanceMonthly?: number, dependents?: number}} [opts]
 * @returns {object} 항목별 공제액과 실수령액
 */
export function estimateNetPay(grossAnnual, opts = {}) {
  const meal = Math.max(0, opts.mealAllowanceMonthly ?? 0);
  const dependents = Math.max(1, opts.dependents ?? 1);

  const taxFreeMonthly = Math.min(meal, RATES.mealAllowanceTaxFreeMonthly);
  const taxFreeAnnual = taxFreeMonthly * 12;
  const taxable = Math.max(0, grossAnnual - taxFreeAnnual);

  // 4대보험은 비과세를 뺀 보수월액 기준으로 매깁니다
  const monthlyBase = taxable / 12;
  const pensionBase = Math.min(
    Math.max(monthlyBase, RATES.pensionMonthlyFloor),
    RATES.pensionMonthlyCap,
  );

  const pension = Math.floor(pensionBase * RATES.nationalPension) * 12;
  const healthMonthly = Math.floor(monthlyBase * RATES.healthInsurance);
  const health = healthMonthly * 12;
  const longTermCare = Math.floor(healthMonthly * RATES.longTermCareOfHealth) * 12;
  const employment = Math.floor(monthlyBase * RATES.employmentInsurance) * 12;
  const socialInsurance = pension + health + longTermCare + employment;

  // 소득세 — 개략 추정
  const eiDeduction = earnedIncomeDeduction(taxable);
  const personalDeduction = 1500000 * dependents;
  const taxBase = Math.max(0, taxable - eiDeduction - personalDeduction - socialInsurance);
  const computedTax = incomeTaxFromBase(taxBase);
  const credit = earnedIncomeTaxCredit(computedTax, taxable);
  const incomeTax = Math.max(0, computedTax - credit);
  const localTax = Math.floor(incomeTax * RATES.localIncomeTaxRate);

  const totalDeduction = socialInsurance + incomeTax + localTax;
  const net = grossAnnual - totalDeduction;

  return {
    grossAnnual,
    taxFreeAnnual,
    deductions: {
      nationalPension: pension,
      healthInsurance: health,
      longTermCare,
      employmentInsurance: employment,
      socialInsuranceTotal: socialInsurance,
      incomeTax,
      localIncomeTax: localTax,
      total: totalDeduction,
    },
    netAnnual: net,
    netMonthly: Math.floor(net / 12),
    effectiveDeductionRate: grossAnnual > 0 ? totalDeduction / grossAnnual : 0,
    caveat: '소득세는 부양가족과 세액공제에 따라 달라지는 개략 추정입니다. 매달 떼는 금액은 간이세액표를 따르고 최종 금액은 연말정산으로 정산됩니다.',
  };
}

/**
 * 제시받은 연봉이 실제로 무엇을 담고 있는지 분해합니다.
 *
 * @param {object} offer
 * @param {number} offer.statedAnnual 제시받은 "연봉"(원)
 * @param {boolean} [offer.severanceIncluded] 퇴직금이 포함돼 있는가
 * @param {number} [offer.fixedOvertimeHours] 고정 초과근로 시간(월)
 * @param {number} [offer.bonusIncludedAmount] 제시액에 포함된 성과급(원)
 * @param {number} [offer.mealAllowanceMonthly] 식대 월액(원)
 * @param {number} [offer.probationMonths] 수습 기간(개월)
 * @param {number} [offer.probationPayRate] 수습 기간 급여 비율 (0.8 = 80%)
 * @returns {object}
 */
export function breakdownOffer(offer) {
  const stated = Math.max(0, offer.statedAnnual ?? 0);
  const notes = [];
  const unknowns = [];

  let guaranteed = stated;

  // 퇴직금
  if (offer.severanceIncluded === true) {
    // 퇴직금 포함 연봉은 통상 13으로 나눠 12개월분이 실제 급여가 됩니다
    const salaryPortion = Math.floor(stated * 12 / 13);
    notes.push('퇴직금이 포함된 제시액입니다. 통상 방식대로 나누면 실제 급여는 약 ' + fmt(salaryPortion) + '원이고 나머지가 퇴직금 적립분입니다. 퇴직금은 1년 이상 근무해야 발생합니다.');
    guaranteed = salaryPortion;
  } else if (offer.severanceIncluded === undefined) {
    unknowns.push('퇴직금이 제시액에 포함되는지 확인하지 않았습니다. 이것 하나로 실제 급여가 8% 가까이 달라집니다.');
  }

  // 성과급
  const bonus = Math.max(0, offer.bonusIncludedAmount ?? 0);
  if (bonus > 0) {
    guaranteed -= bonus;
    notes.push('제시액에 성과급 ' + fmt(bonus) + '원이 들어 있습니다. 성과급은 지급이 보장되지 않으므로 확실한 금액은 약 ' + fmt(guaranteed) + '원으로 봐야 합니다. 과거 지급 이력을 물어보세요.');
  } else if (offer.bonusIncludedAmount === undefined) {
    unknowns.push('성과급이 제시액에 포함됐는지 별도인지 확인하지 않았습니다.');
  }

  // 고정 초과근로수당
  const otHours = offer.fixedOvertimeHours;
  if (typeof otHours === 'number' && otHours > 0) {
    notes.push('고정 초과근로 ' + otHours + '시간분이 급여에 들어 있습니다. 그만큼 일하지 않아도 받지만, 반대로 그 시간까지는 야근해도 추가 수당이 없습니다. 실제 근무가 이를 넘으면 차액을 받을 권리가 있습니다.');
  } else if (otHours === undefined) {
    unknowns.push('고정 초과근로수당(포괄임금)이 포함됐는지 확인하지 않았습니다.');
  }

  // 수습
  if (offer.probationMonths && offer.probationPayRate && offer.probationPayRate < 1) {
    const cut = Math.floor(guaranteed / 12 * (1 - offer.probationPayRate) * offer.probationMonths);
    notes.push('수습 ' + offer.probationMonths + '개월 동안 급여의 ' + Math.round(offer.probationPayRate * 100) + '%를 받습니다. 첫해에 약 ' + fmt(cut) + '원이 덜 들어옵니다.');
  }

  const net = estimateNetPay(guaranteed, { mealAllowanceMonthly: offer.mealAllowanceMonthly });

  return { stated, guaranteedAnnual: guaranteed, notes, unknowns, net };
}

function fmt(n) {
  return Number(n).toLocaleString('ko-KR');
}

// ── 명령줄 실행 ──────────────────────────────────────────────
function usage() {
  console.log([
    '한국 급여 분해기',
    '',
    '사용법:',
    '  node salary-korea.mjs net <세전연봉> [--식대 <월액>] [--부양가족 <수>]',
    '  node salary-korea.mjs offer <제시연봉> [옵션]',
    '',
    'offer 옵션:',
    '  --퇴직금포함              제시액에 퇴직금이 들어 있음',
    '  --퇴직금별도              제시액과 별도로 퇴직금이 발생함',
    '  --고정OT <시간>           월 고정 초과근로 시간',
    '  --성과급포함 <금액>       제시액에 포함된 성과급',
    '  --성과급별도              성과급이 제시액과 별도',
    '  --식대 <월액>             식대 월액 (20만원까지 비과세)',
    '  --수습 <개월> <비율>      수습 기간과 급여 비율 (예: --수습 3 0.8)',
    '',
    '금액은 원 단위로 적습니다. 5천만원이면 50000000 입니다.',
    '',
    '주의: 소득세는 개략 추정입니다. 계약서를 대신할 수 없습니다.',
  ].join('\n'));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--퇴직금포함') out.severanceIncluded = true;
    else if (a === '--퇴직금별도') out.severanceIncluded = false;
    else if (a === '--성과급별도') out.bonusIncludedAmount = 0;
    else if (a === '--성과급포함') out.bonusIncludedAmount = Number(argv[++i]);
    else if (a === '--고정OT') out.fixedOvertimeHours = Number(argv[++i]);
    else if (a === '--식대') out.mealAllowanceMonthly = Number(argv[++i]);
    else if (a === '--부양가족') out.dependents = Number(argv[++i]);
    else if (a === '--수습') { out.probationMonths = Number(argv[++i]); out.probationPayRate = Number(argv[++i]); }
    else out._.push(a);
  }
  return out;
}

function printNet(r) {
  const d = r.deductions;
  console.log('');
  console.log('세전 연봉        ' + fmt(r.grossAnnual) + '원');
  if (r.taxFreeAnnual > 0) console.log('  비과세         ' + fmt(r.taxFreeAnnual) + '원 (식대)');
  console.log('');
  console.log('공제');
  console.log('  국민연금       ' + fmt(d.nationalPension) + '원');
  console.log('  건강보험       ' + fmt(d.healthInsurance) + '원');
  console.log('  장기요양       ' + fmt(d.longTermCare) + '원');
  console.log('  고용보험       ' + fmt(d.employmentInsurance) + '원');
  console.log('  소득세         ' + fmt(d.incomeTax) + '원 (추정)');
  console.log('  지방소득세     ' + fmt(d.localIncomeTax) + '원 (추정)');
  console.log('  합계           ' + fmt(d.total) + '원 (' + (r.effectiveDeductionRate * 100).toFixed(1) + '%)');
  console.log('');
  console.log('실수령 연간      ' + fmt(r.netAnnual) + '원');
  console.log('실수령 월        ' + fmt(r.netMonthly) + '원');
  console.log('');
  console.log('※ ' + r.caveat);
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('salary-korea.mjs');

if (invokedDirectly) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const amount = Number(args._[0]);

  if (!cmd || !Number.isFinite(amount) || amount <= 0) {
    usage();
    process.exit(cmd ? 1 : 0);
  } else if (cmd === 'net') {
    printNet(estimateNetPay(amount, args));
  } else if (cmd === 'offer') {
    const r = breakdownOffer(Object.assign({ statedAnnual: amount }, args));
    console.log('');
    console.log('제시받은 연봉    ' + fmt(r.stated) + '원');
    console.log('확실한 금액      ' + fmt(r.guaranteedAnnual) + '원');
    if (r.notes.length) {
      console.log('');
      console.log('분해');
      r.notes.forEach(n => console.log('  · ' + n));
    }
    if (r.unknowns.length) {
      console.log('');
      console.log('아직 확인 못 한 것 — 처우 협의에서 물어보세요');
      r.unknowns.forEach(n => console.log('  ? ' + n));
    }
    printNet(r.net);
  } else {
    usage();
    process.exit(1);
  }
}

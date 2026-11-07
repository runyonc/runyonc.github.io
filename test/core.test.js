// Unit tests for the pure FinanceCore functions embedded in index.html.
// Run: node test/core.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = /<script id="finance-core">([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error('finance-core script block not found');
vm.runInThisContext(m[1]);
const C = globalThis.FinanceCore;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e)); }
}
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
const E = (type, date, amount, cat, extra) => Object.assign({ id: Math.random().toString(36).slice(2), type, date, amount, cat: cat || C.CATS[type][0], note: '' }, extra || {});
const TODAY = '2026-11-07';

console.log('money');
test('sums in cents (0.1 + 0.2 = 0.3)', () => {
  assert.strictEqual(C.sumAmounts([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.strictEqual(C.sumAmounts([{ amount: 19.99 }, { amount: 0.01 }, { amount: 1.005 }]), 21.01);
  assert.strictEqual(C.add(1.1, 2.2), 3.3);
  assert.strictEqual(C.sub(1, 0.9), 0.1);
});
test('round2 and toCents handle junk', () => {
  assert.strictEqual(C.round2('12.345'), 12.35);
  assert.strictEqual(C.toCents('abc'), 0);
  assert.strictEqual(C.toCents(null), 0);
});

console.log('dates');
test('isValidISO rejects impossible dates', () => {
  assert.ok(C.isValidISO('2026-02-28'));
  assert.ok(!C.isValidISO('2026-02-30'));
  assert.ok(!C.isValidISO('2026-13-01'));
  assert.ok(!C.isValidISO('nope'));
  assert.ok(!C.isValidISO(''));
});
test('month arithmetic', () => {
  assert.strictEqual(C.addMonths('2026-01', -1), '2025-12');
  assert.strictEqual(C.addMonths('2026-11', 3), '2027-02');
  assert.strictEqual(C.monthEnd('2024-02'), '2024-02-29');
  assert.strictEqual(C.monthEnd('2026-11'), '2026-11-30');
  assert.strictEqual(C.monthsBetween('2025-11', '2026-02'), 3);
  assert.deepStrictEqual(C.monthsList('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
});
test('weekStart is Monday', () => {
  assert.strictEqual(C.weekStart('2026-11-07'), '2026-11-02'); // Saturday -> Monday
  assert.strictEqual(C.weekStart('2026-11-02'), '2026-11-02');
  assert.strictEqual(C.weekStart('2026-11-01'), '2026-10-26'); // Sunday -> previous Monday
});
test('daysBetween across DST', () => {
  assert.strictEqual(C.daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.strictEqual(C.daysBetween('2026-11-01', '2026-11-07'), 6);
});

console.log('state');
test('old entries without a type become expenses, bad data is repaired', () => {
  const s = C.normalizeState({ entries: [{ id: 'a', date: '2026-11-01', amount: '12.5', cat: 'Groceries' }, { id: 'b', type: 'income', date: 'bad', amount: -40, cat: 'Nope' }, { id: 'a', amount: 5 }] }, TODAY);
  assert.strictEqual(s.entries.length, 2, 'duplicate ids dropped');
  assert.strictEqual(s.entries[0].type, 'expense');
  assert.strictEqual(s.entries[0].amount, 12.5);
  assert.strictEqual(s.entries[1].type, 'income');
  assert.strictEqual(s.entries[1].date, TODAY);
  assert.strictEqual(s.entries[1].amount, 40);
  assert.strictEqual(s.entries[1].cat, 'Other income');
  assert.strictEqual(s.budget, 3000);
  assert.strictEqual(s.retirement.withdrawalRate, 4);
  assert.strictEqual(s.retirement.spendingOverride, null);
  assert.deepStrictEqual(s.debts, []);
});
test('normalizeState keeps overrides and clamps ages', () => {
  const s = C.normalizeState({ retirement: { age: 5, targetAge: 200, spendingOverride: '50000', contributionOverride: 0 } }, TODAY);
  assert.strictEqual(s.retirement.age, 10);
  assert.strictEqual(s.retirement.targetAge, 100);
  assert.strictEqual(s.retirement.spendingOverride, 50000);
  assert.strictEqual(s.retirement.contributionOverride, 0);
});

console.log('summaries');
test('totals and savings rate', () => {
  const t = C.totals([E('income', '2026-11-01', 5000), E('expense', '2026-11-02', 3000), E('k401', '2026-11-03', 500)]);
  assert.strictEqual(t.income, 5000); assert.strictEqual(t.expense, 3000); assert.strictEqual(t.k401, 500); assert.strictEqual(t.net, 2000);
  close(t.savingsRate, 2500 / 5500);
  assert.strictEqual(t.count.all, 3);
});
test('savings rate is null without income or 401k, negative when overspending', () => {
  assert.strictEqual(C.savingsRate(0, 100, 0), null);
  assert.strictEqual(C.savingsRate(1000, 1500, 0), -0.5);
  assert.strictEqual(C.savingsRate(0, 0, 100), 1);
});
test('budget status thresholds', () => {
  assert.strictEqual(C.budgetStatus(2000, 3000).level, 'ok');
  assert.strictEqual(C.budgetStatus(2550, 3000).level, 'warn'); // exactly 85%
  assert.strictEqual(C.budgetStatus(3000, 3000).level, 'warn');
  assert.strictEqual(C.budgetStatus(3000.01, 3000).level, 'over');
  const b = C.budgetStatus(3200, 3000);
  assert.strictEqual(b.over, 200); assert.strictEqual(b.left, 0); assert.strictEqual(b.pct, 100); assert.ok(b.isOver);
  assert.strictEqual(C.budgetStatus(100, 3000).left, 2900);
  assert.strictEqual(C.budgetStatus(10, 0).level, 'over');
  assert.strictEqual(C.budgetStatus(0, 0).pct, 0);
});
test('category breakdown is spending only, sorted, shares sum to 1', () => {
  const b = C.categoryBreakdown([E('expense', TODAY, 10, 'Recreation'), E('expense', TODAY, 30, 'Groceries'), E('expense', TODAY, 25, 'Recreation'), E('income', TODAY, 999)]);
  assert.deepStrictEqual(b.map(x => x.cat), ['Recreation', 'Groceries']);
  assert.strictEqual(b[0].total, 35); close(b[0].share + b[1].share, 1);
});
test('groupByDay newest first with daily totals', () => {
  const g = C.groupByDay([E('expense', '2026-11-01', 5), E('expense', '2026-11-03', 7), E('income', '2026-11-03', 100), E('expense', '2026-11-03', 1.5)]);
  assert.deepStrictEqual(g.map(x => x.date), ['2026-11-03', '2026-11-01']);
  assert.strictEqual(g[0].expense, 8.5); assert.strictEqual(g[0].income, 100); assert.strictEqual(g[0].entries.length, 3);
});
test('CSV escapes notes and signs expenses', () => {
  const csv = C.toCSV([E('expense', '2026-11-02', 12.5, 'Dining', { note: 'Pizza, "extra" cheese', tags: ['food', 'date night'] }), E('income', '2026-11-01', 2000, 'Paycheck')]);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'date,type,category,amount,note,tags');
  assert.strictEqual(lines[1], '2026-11-01,income,Paycheck,2000.00,,');
  assert.strictEqual(lines[2], '2026-11-02,expense,Dining,-12.50,"Pizza, ""extra"" cheese",food;date night');
});

console.log('ranges & buckets');
test('presets', () => {
  assert.deepStrictEqual(C.rangeForPreset('thisMonth', TODAY), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual(C.rangeForPreset('last3', TODAY), { from: '2026-09-01', to: TODAY });
  assert.deepStrictEqual(C.rangeForPreset('last12', TODAY), { from: '2025-12-01', to: TODAY });
  assert.deepStrictEqual(C.rangeForPreset('ytd', TODAY), { from: '2026-01-01', to: TODAY });
  assert.deepStrictEqual(C.rangeForPreset('all', TODAY, [E('expense', '2025-03-15', 1), E('expense', '2026-12-01', 1)]), { from: '2025-03-01', to: '2026-12-01' });
  assert.deepStrictEqual(C.rangeForPreset('all', TODAY, []), { from: '2026-11-01', to: TODAY });
});
test('bucket mode: weeks under ~2 months, months otherwise', () => {
  assert.strictEqual(C.pickBucketMode('2026-11-01', '2026-11-30'), 'week');
  assert.strictEqual(C.pickBucketMode('2026-09-01', '2026-11-07'), 'month');
});
test('bucketize monthly includes empty months and computes per-bucket rate', () => {
  const b = C.bucketize([E('income', '2026-09-10', 1000), E('expense', '2026-09-12', 400), E('k401', '2026-11-01', 100, 'Employer match'), E('k401', '2026-11-02', 50, 'My contribution'), E('expense', '2026-12-01', 999)], '2026-09-01', '2026-11-30');
  assert.deepStrictEqual(b.map(x => x.key), ['2026-09', '2026-10', '2026-11']);
  assert.strictEqual(b[0].income, 1000); assert.strictEqual(b[0].expense, 400); assert.strictEqual(b[0].net, 600); close(b[0].savingsRate, 0.6);
  assert.strictEqual(b[1].income, 0); assert.strictEqual(b[1].savingsRate, null);
  assert.strictEqual(b[2].k401, 150); assert.strictEqual(b[2].k401Match, 100); assert.strictEqual(b[2].k401Mine, 50);
});
test('bucketize weekly', () => {
  const b = C.bucketize([E('expense', '2026-11-01', 5), E('expense', '2026-11-03', 7)], '2026-11-01', '2026-11-07', 'week');
  assert.deepStrictEqual(b.map(x => x.key), ['2026-10-26', '2026-11-02']);
  assert.strictEqual(b[0].expense, 5); assert.strictEqual(b[1].expense, 7);
});
test('cumulative 401k stacks mine and match', () => {
  const c = C.cumulative401k([E('k401', '2026-09-05', 100, 'My contribution'), E('k401', '2026-10-05', 100, 'My contribution'), E('k401', '2026-10-05', 50, 'Employer match')], '2026-09-01', '2026-11-30');
  assert.deepStrictEqual(c.map(x => x.cumMine), [100, 200, 200]);
  assert.deepStrictEqual(c.map(x => x.cumMatch), [0, 50, 50]);
  assert.strictEqual(c[2].cumTotal, 250);
});
test('averages over months with data', () => {
  const a = C.averages([E('expense', '2026-09-01', 1000), E('expense', '2026-11-01', 2000), E('income', '2026-11-02', 4500), E('k401', '2026-11-03', 300)], TODAY);
  assert.strictEqual(a.months, 2); assert.strictEqual(a.expense, 1500); assert.strictEqual(a.income, 2250); assert.strictEqual(a.k401, 150); assert.strictEqual(a.net, 750);
  assert.strictEqual(C.averages([], TODAY).months, 0);
});

console.log('debt');
test('zero-interest payoff', () => {
  const p = C.debtPayoff({ balance: 1000, rate: 0, payment: 100 }, '2026-11-07');
  assert.strictEqual(p.months, 10); assert.strictEqual(p.interest, 0); assert.strictEqual(p.payoffDate, '2027-09-01');
});
test('hand-computed interest: $100 at 120% APR, $60/mo', () => {
  const p = C.debtPayoff({ balance: 100, rate: 120, payment: 60 });
  assert.strictEqual(p.months, 2); assert.strictEqual(p.interest, 15); assert.strictEqual(p.totalPaid, 115);
});
test('closed-form months match the simulation', () => {
  const B = 1000, apr = 12, P = 100, r = apr / 100 / 12;
  const n = Math.ceil(-Math.log(1 - r * B / P) / Math.log(1 + r));
  const p = C.debtPayoff({ balance: B, rate: apr, payment: P });
  assert.strictEqual(p.months, n);
  assert.ok(p.interest > 50 && p.interest < 65, 'interest ' + p.interest); // ~$56
  close(p.totalPaid, B + p.interest, 0.01);
});
test('never pays off when payment does not cover interest', () => {
  const p = C.debtPayoff({ balance: 10000, rate: 24, payment: 200 });
  assert.ok(p.neverPaysOff); assert.strictEqual(p.months, Infinity);
  assert.ok(C.debtPayoff({ balance: 100, rate: 5, payment: 0 }).neverPaysOff);
  assert.strictEqual(C.debtPayoff({ balance: 0, rate: 5, payment: 0 }).months, 0);
});

console.log('retirement');
const base = { age: 30, targetAge: 65, withdrawalRate: 4, returnRate: 6, taxRate: 15, annualSpending: 40000, monthlyContribution: 0, k401Balance: 0, rothBalance: 0, savingsBalance: 0, otherInvestments: 0, debts: [], today: TODAY };
test('target number = spending / withdrawal rate', () => {
  assert.strictEqual(C.retirementCalc(base).target, 1000000);
  assert.strictEqual(C.retirementCalc(Object.assign({}, base, { withdrawalRate: 5, annualSpending: 50000 })).target, 1000000);
});
test('assets apply tax to 401k only; net worth subtracts debt; progress', () => {
  const r = C.retirementCalc(Object.assign({}, base, { k401Balance: 100000, rothBalance: 20000, savingsBalance: 5000, otherInvestments: 1000, debts: [{ name: 'Car', balance: 6000, rate: 5, payment: 300 }] }));
  assert.strictEqual(r.assets, 111000); assert.strictEqual(r.totalDebt, 6000); assert.strictEqual(r.netWorth, 105000); close(r.progress, 0.105);
});
test('no growth: $1000/mo reaches $12,000 in exactly 12 months', () => {
  const r = C.retirementCalc(Object.assign({}, base, { returnRate: 0, annualSpending: 480, monthlyContribution: 1000 })); // target 12000
  assert.strictEqual(r.target, 12000); assert.strictEqual(r.monthsToTarget, 12); close(r.ageAtTarget, 31);
});
test('6% real return compounds to exactly 6% after 12 months', () => {
  const r = C.retirementCalc(Object.assign({}, base, { rothBalance: 100000, annualSpending: 4240 })); // target 106000
  assert.strictEqual(r.monthsToTarget, 12);
});
test('already there: 0 months', () => {
  const r = C.retirementCalc(Object.assign({}, base, { rothBalance: 2000000 }));
  assert.strictEqual(r.monthsToTarget, 0); assert.strictEqual(r.gap, 0); assert.strictEqual(r.extraMonthly, 0);
});
test('unreachable within 100 years returns null age', () => {
  const r = C.retirementCalc(Object.assign({}, base, { returnRate: 0, monthlyContribution: 10 }));
  assert.strictEqual(r.monthsToTarget, null); assert.strictEqual(r.ageAtTarget, null);
});
test('gap and extra monthly contribution needed (0% return)', () => {
  const r = C.retirementCalc(Object.assign({}, base, { returnRate: 0, age: 64, targetAge: 65, annualSpending: 480 })); // target 12000, 12 months
  assert.strictEqual(r.netWorthAtTargetAge, 0); assert.strictEqual(r.gap, 12000); assert.strictEqual(r.extraMonthly, 1000);
});
test('extra monthly with growth uses the annuity factor', () => {
  const r = C.retirementCalc(Object.assign({}, base, { age: 64, targetAge: 65, annualSpending: 480 }));
  const mr = C.monthlyRate(6); const f = C.annuityFactor(mr, 12);
  close(r.extraMonthly, 12000 / f, 0.01);
  assert.ok(r.extraMonthly < 1000);
});
test('debt payments roll into contributions once paid off', () => {
  const withDebt = C.retirementCalc(Object.assign({}, base, { returnRate: 0, annualSpending: 480, monthlyContribution: 500, debts: [{ name: 'Loan', balance: 1000, rate: 0, payment: 500 }] }));
  // Month 0: nw = -1000. Months 1-2: +500 contrib, debt -500 each => nw after m2 = 1000 - 0 = 1000 (assets 1000, debt 0)
  // From month 3: contributions 1000/mo => need 11000 more => reached at month 13.
  assert.strictEqual(withDebt.projection[0].netWorth, -1000);
  assert.strictEqual(withDebt.monthsToTarget, 13);
  assert.strictEqual(withDebt.debts[0].months, 2);
});
test('debts sorted by rate, highest first, with total interest', () => {
  const r = C.retirementCalc(Object.assign({}, base, { debts: [{ name: 'A', balance: 100, rate: 3, payment: 50 }, { name: 'B', balance: 100, rate: 20, payment: 50 }] }));
  assert.deepStrictEqual(r.debts.map(d => d.name), ['B', 'A']);
  assert.ok(r.totalInterest > 0 && r.totalInterest < 5);
});
test('projection runs from current age past the target age', () => {
  const r = C.retirementCalc(Object.assign({}, base, { age: 40, targetAge: 50, rothBalance: 500000, monthlyContribution: 2000 }));
  assert.strictEqual(r.projection[0].age, 40); assert.strictEqual(r.projection[0].netWorth, 500000);
  assert.ok(r.projection[r.projection.length - 1].age >= 50);
  for (let i = 1; i < r.projection.length; i++) assert.ok(r.projection[i].netWorth > r.projection[i - 1].netWorth);
});
test('negative contributions and zero withdrawal rate do not crash', () => {
  const r = C.retirementCalc(Object.assign({}, base, { monthlyContribution: -200, withdrawalRate: 0 }));
  assert.strictEqual(r.target, Infinity); assert.strictEqual(r.monthsToTarget, null);
});


console.log('debt interest options');
test('compounding options change the monthly rate', () => {
  close(C.monthlyDebtRate({ rate: 12, compounding: 'monthly' }), 0.01);
  assert.ok(C.monthlyDebtRate({ rate: 12, compounding: 'daily' }) > 0.01 && C.monthlyDebtRate({ rate: 12, compounding: 'daily' }) < 0.0101);
  assert.strictEqual(C.monthlyDebtRate({ rate: 12, compounding: 'none' }), 0);
  assert.strictEqual(C.normalizeDebt({ compounding: 'weird' }).compounding, 'monthly');
  assert.strictEqual(C.normalizeDebt({ compounding: 'daily' }).compounding, 'daily');
});
test('no-interest debt pays off with zero interest regardless of APR', () => {
  const p = C.debtPayoff({ balance: 1200, rate: 29.99, payment: 100, compounding: 'none' });
  assert.strictEqual(p.months, 12); assert.strictEqual(p.interest, 0);
});
test('simple interest charges on the original balance only', () => {
  // $1200 at 12% simple: $12/month flat. Payment 112 -> principal 100/mo -> 12 months, interest 144.
  const p = C.debtPayoff({ balance: 1200, rate: 12, payment: 112, compounding: 'simple' });
  assert.strictEqual(p.months, 12); assert.strictEqual(p.interest, 144);
  const c = C.debtPayoff({ balance: 1200, rate: 12, payment: 112, compounding: 'monthly' });
  assert.ok(c.interest < p.interest, 'compound on a shrinking balance costs less than flat simple interest');
});
test('daily compounding costs a little more than monthly', () => {
  const m = C.debtPayoff({ balance: 5000, rate: 24, payment: 250, compounding: 'monthly' });
  const d = C.debtPayoff({ balance: 5000, rate: 24, payment: 250, compounding: 'daily' });
  assert.ok(d.interest > m.interest && d.interest < m.interest * 1.03, `${d.interest} vs ${m.interest}`);
});
test('projection honours per-debt compounding', () => {
  const noInt = C.retirementCalc(Object.assign({}, base, { returnRate: 0, annualSpending: 480, monthlyContribution: 500, debts: [{ name: 'Promo', balance: 1000, rate: 99, payment: 500, compounding: 'none' }] }));
  assert.strictEqual(noInt.monthsToTarget, 13, 'same as the zero-rate case');
  assert.strictEqual(noInt.debts[0].compounding, 'none');
});

console.log('funds & forecast');
test('embedded S&P 500 history is complete and has the expected long-run CAGR', () => {
  const s = C.sp500Series();
  assert.strictEqual(s.length, 98); assert.strictEqual(s[0].year, 1928); assert.strictEqual(s[97].year, 2025);
  const st = C.seriesStats(s);
  assert.ok(st.cagr > 9.5 && st.cagr < 10.5, 'cagr ' + st.cagr);
  assert.strictEqual(st.best.year, 1954); assert.strictEqual(st.worst.year, 1931);
  assert.ok(st.positiveShare > 0.7 && st.positiveShare < 0.76);
});
test('seriesStats on a tiny hand-computed series', () => {
  const st = C.seriesStats([{ year: 1, r: 10 }, { year: 2, r: -10 }]);
  close(st.cagr, (Math.sqrt(1.1 * 0.9) - 1) * 100); close(st.mean, 0); close(st.stdev, Math.sqrt(200)); assert.strictEqual(st.growth10k, 9900);
  assert.strictEqual(C.seriesStats([]).years, 0);
});
test('fund series and long-run basis splice actual years over the S&P proxy', () => {
  const fx = C.fundSeries('FXAIX'); assert.strictEqual(fx[0].year, 2012); assert.strictEqual(fx[fx.length - 1].year, 2025); assert.strictEqual(fx[0].r, 15.99);
  const lf = C.fundSeries('LFIKX'); assert.strictEqual(lf[0].year, 2016); assert.strictEqual(lf.length, 10); assert.strictEqual(lf[6].r, -15.44);
  const bfx = C.fundBasisSeries('FXAIX'); assert.strictEqual(bfx.length, 98);
  const y2011 = bfx.find(p => p.year === 2011); assert.strictEqual(y2011.actual, false); close(y2011.r, 2.10 - 0.015, 0.01);
  const y2012 = bfx.find(p => p.year === 2012); assert.strictEqual(y2012.actual, true); assert.strictEqual(y2012.r, 15.99);
  const blf = C.fundBasisSeries('LFIKX'); const y2015 = blf.find(p => p.year === 2015); close(y2015.r, 1.38 * 0.85 - 0.40, 0.01);
  assert.ok(C.seriesStats(blf).cagr < C.seriesStats(bfx).cagr, 'lower beta and higher fee give a lower long-run CAGR');
  assert.deepStrictEqual(C.fundSeries('custom'), []); assert.deepStrictEqual(C.fundBasisSeries('nope'), []);
});
test('realRate uses the Fisher relation', () => { close(C.realRate(10, 3), (1.1 / 1.03 - 1) * 100); close(C.realRate(3, 3), 0); });
test('deterministic forecast: 0% return is balance plus contributions', () => {
  const f = C.forecastBalance({ balance: 1000, monthlyContribution: 100, years: 3, annualReturnPct: 0 });
  assert.deepStrictEqual(f.map(p => p.balance), [1000, 2200, 3400, 4600]);
  const g = C.forecastBalance({ balance: 1000, monthlyContribution: 0, years: 1, annualReturnPct: 6 });
  close(g[1].balance, 1060, 0.01);
});
test('bootstrap forecast is deterministic, ordered, and collapses to the exact path for a constant series', () => {
  const a = C.bootstrapForecast({ balance: 10000, monthlyContribution: 500, years: 10, returns: C.SP500.returns, runs: 300, seed: 7 });
  const b = C.bootstrapForecast({ balance: 10000, monthlyContribution: 500, years: 10, returns: C.SP500.returns, runs: 300, seed: 7 });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, 11); assert.strictEqual(a[0].p50, 10000);
  a.forEach(p => assert.ok(p.p10 <= p.p50 && p.p50 <= p.p90));
  assert.ok(a[10].p90 > a[10].p10);
  const c = C.bootstrapForecast({ balance: 1000, monthlyContribution: 0, years: 2, returns: [10], runs: 5, seed: 1 });
  close(c[2].p50, 1210, 0.01); close(c[2].p10, 1210, 0.01);
  assert.deepStrictEqual(C.bootstrapForecast({ balance: 1, years: 2, returns: [] }), []);
});
test('normalizeState carries fund choices', () => {
  const s = C.normalizeState({ k401Fund: 'LFIKX', k401ReturnOverride: '8.5', inflation: 2 }, TODAY);
  assert.strictEqual(s.k401Fund, 'LFIKX'); assert.strictEqual(s.k401ReturnOverride, 8.5); assert.strictEqual(s.inflation, 2);
  const d = C.normalizeState({ k401Fund: 'XXXX' }, TODAY); assert.strictEqual(d.k401Fund, 'FXAIX'); assert.strictEqual(d.k401ReturnOverride, null); assert.strictEqual(d.inflation, 3);
  assert.strictEqual(C.normalizeState({ k401Fund: 'custom' }, TODAY).k401Fund, 'custom');
});


console.log('paycheck');
test('2026 federal tax brackets with the standard deduction', () => {
  // single: $66,100 wages - $16,100 deduction = $50,000 taxable -> 10% of 12,400 + 12% of 37,600 = 1,240 + 4,512
  close(C.federalTax(66100, 'single'), 5752);
  assert.strictEqual(C.federalTax(10000, 'single'), 0);
  // married: $132,200 - 32,200 = 100,000 taxable -> 2,480 + 12% of 75,200 = 2,480 + 9,024
  close(C.federalTax(132200, 'married'), 11504);
  // crosses into the 22% bracket: single taxable 60,000 -> 1,240 + 4,560 + 22% of 9,600 = 7,912
  close(C.federalTax(76100, 'single'), 7912);
});
test('paycheck breakdown: 401k, match, FICA, federal, state and net', () => {
  // $3,000 biweekly gross = $78,000/yr. 6% 401k = $180; 50% match up to 6% = $90; health $100 pre-tax.
  const b = C.paycheckBreakdown({ gross: 3000, frequency: 'biweekly', k401Pct: 6, matchPct: 50, matchCapPct: 6, health: 100, stateRate: 5, filingStatus: 'single' });
  assert.strictEqual(b.k401, 180); assert.strictEqual(b.match, 90); assert.strictEqual(b.pretax, 280); assert.strictEqual(b.taxableWages, 2720);
  close(b.socialSecurity, C.round2(2900 * 0.062), 0.01); close(b.medicare, C.round2(2900 * 0.0145), 0.01);
  close(b.federal, C.round2(C.federalTax(2720 * 26, 'single') / 26), 0.01);
  close(b.state, 136, 0.01);
  close(b.net, C.round2(3000 - 280 - b.federal - b.state - b.socialSecurity - b.medicare), 0.005);
  close(b.monthly.net, C.round2(b.net * 26 / 12), 0.01); assert.strictEqual(b.annual.gross, 78000); assert.strictEqual(b.periodsPerYear, 26);
  assert.ok(b.effectiveTaxRate > 0.15 && b.effectiveTaxRate < 0.25, 'plausible total tax rate ' + b.effectiveTaxRate);
});
test('match is capped at the employer cap and manual taxes override the estimate', () => {
  const b = C.paycheckBreakdown({ gross: 1000, frequency: 'monthly', k401Pct: 10, matchPct: 100, matchCapPct: 4 });
  assert.strictEqual(b.k401, 100); assert.strictEqual(b.match, 40);
  const m = C.paycheckBreakdown({ gross: 1000, frequency: 'monthly', k401Pct: 0, taxMode: 'manual', federalManual: 80, stateManual: 20, ssManual: 62, medicareManual: 14.5 });
  assert.strictEqual(m.taxes, 176.5); assert.strictEqual(m.net, 823.5);
  const z = C.paycheckBreakdown({}); assert.strictEqual(z.net, 0); assert.strictEqual(z.gross, 0);
});
test('social security stops at the wage base', () => {
  const b = C.paycheckBreakdown({ gross: 20000, frequency: 'monthly', k401Pct: 0 }); // $240k/yr
  close(b.socialSecurity, C.round2(184500 / 12 * 0.062), 0.01);
  assert.ok(b.medicare > 20000 * 0.0145, 'additional medicare applies above $200k');
});
test('paycheck entries: net income, employee 401k (+roth) and employer match', () => {
  const es = C.paycheckEntries({ gross: 3000, frequency: 'biweekly', k401Pct: 6, matchPct: 50, matchCapPct: 6, roth: 50 }, '2026-11-13');
  assert.deepStrictEqual(es.map(e => [e.type, e.cat, e.amount]), [['income', 'Paycheck', C.paycheckBreakdown({ gross: 3000, frequency: 'biweekly', k401Pct: 6, matchPct: 50, matchCapPct: 6, roth: 50 }).net], ['k401', 'My contribution', 230], ['k401', 'Employer match', 90]]);
  assert.ok(es.every(e => e.date === '2026-11-13' && e.recurring === 'paycheck'));
});
test('monthlyize converts pay frequencies', () => {
  assert.strictEqual(C.monthlyize(1000, 'biweekly'), 2166.67); assert.strictEqual(C.monthlyize(100, 'weekly'), 433.33); assert.strictEqual(C.monthlyize(120, 'yearly'), 10); assert.strictEqual(C.monthlyize(15.99, 'monthly'), 15.99);
});

console.log('recurring');
test('advanceDate keeps the anchor day across short months', () => {
  assert.strictEqual(C.advanceDate('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.strictEqual(C.advanceDate('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.strictEqual(C.advanceDate('2026-11-07', 'weekly'), '2026-11-14');
  assert.strictEqual(C.advanceDate('2026-11-07', 'biweekly'), '2026-11-21');
  assert.strictEqual(C.advanceDate('2026-11-01', 'semimonthly'), '2026-11-16');
  assert.strictEqual(C.advanceDate('2026-11-16', 'semimonthly'), '2026-12-01');
  assert.strictEqual(C.advanceDate('2024-02-29', 'yearly', 29), '2025-02-28');
});
test('postDue logs every missed occurrence once and advances the rule', () => {
  const st = C.normalizeState({ recurring: [{ id: 'nf', name: 'Netflix', amount: 15.99, cat: 'Fun', frequency: 'monthly', nextDate: '2026-09-07' }, { id: 'off', name: 'Paused', amount: 50, cat: 'Fun', frequency: 'monthly', nextDate: '2026-01-01', active: false }, { id: 'fut', name: 'Future', amount: 5, cat: 'Fun', frequency: 'monthly', nextDate: '2026-12-01' }] }, TODAY);
  const r = C.postDue(st, TODAY);
  assert.ok(r.changed);
  assert.deepStrictEqual(r.entries.map(e => [e.date, e.amount, e.recurring, e.note]), [['2026-09-07', 15.99, 'nf', 'Netflix'], ['2026-10-07', 15.99, 'nf', 'Netflix'], ['2026-11-07', 15.99, 'nf', 'Netflix']]);
  assert.strictEqual(r.recurring.find(x => x.id === 'nf').nextDate, '2026-12-07');
  assert.strictEqual(r.recurring.find(x => x.id === 'off').nextDate, '2026-01-01', 'paused rule untouched');
  const again = C.postDue(Object.assign({}, st, { recurring: r.recurring }), TODAY);
  assert.strictEqual(again.entries.length, 0, 'nothing double-posted');
  assert.ok(!again.changed);
});
test('postDue logs due paychecks with their 401k entries and advances the pay date', () => {
  const st = C.normalizeState({ paycheck: { gross: 2000, frequency: 'biweekly', nextPayDate: '2026-10-30', k401Pct: 5, matchPct: 100, matchCapPct: 3 } }, TODAY);
  const r = C.postDue(st, TODAY);
  assert.strictEqual(r.entries.filter(e => e.type === 'income').length, 1);
  assert.strictEqual(r.entries.filter(e => e.type === 'k401').length, 2);
  assert.strictEqual(r.paycheck.nextPayDate, '2026-11-13');
  const off = C.postDue(C.normalizeState({ paycheck: { gross: 2000, nextPayDate: '2026-10-30', autoLog: false } }, TODAY), TODAY);
  assert.strictEqual(off.entries.length, 0);
});
test('upcoming lists the next 30 days in date order, including paychecks', () => {
  const st = C.normalizeState({ recurring: [{ id: 'a', name: 'Rent', amount: 1450, cat: 'Housing', frequency: 'monthly', nextDate: '2026-12-01' }, { id: 'b', name: 'Gym', amount: 40, cat: 'Health', frequency: 'weekly', nextDate: '2026-11-10' }], paycheck: { gross: 1000, frequency: 'biweekly', nextPayDate: '2026-11-20' } }, TODAY);
  const u = C.upcoming(st, TODAY, 30);
  assert.deepStrictEqual(u.map(x => x.date + ' ' + x.name), ['2026-11-10 Gym', '2026-11-17 Gym', '2026-11-20 Paycheck', '2026-11-24 Gym', '2026-12-01 Rent', '2026-12-01 Gym', '2026-12-04 Paycheck']);
  assert.strictEqual(C.recurringMonthlyTotal(st.recurring, 'expense'), C.round2(1450 + 40 * 52 / 12));
});
test('normalizeRule and normalizePaycheck repair bad input', () => {
  const r = C.normalizeRule({ name: '', amount: -3, frequency: 'daily', nextDate: 'bad', type: 'nope' }, TODAY);
  assert.strictEqual(r.name, 'Recurring'); assert.strictEqual(r.amount, 0); assert.strictEqual(r.frequency, 'monthly'); assert.strictEqual(r.nextDate, TODAY); assert.strictEqual(r.type, 'expense'); assert.strictEqual(r.anchorDay, 7); assert.ok(r.active);
  const p = C.normalizePaycheck({ gross: '2500', frequency: 'nope', filingStatus: 'x', k401Pct: 500 });
  assert.strictEqual(p.gross, 2500); assert.strictEqual(p.frequency, 'biweekly'); assert.strictEqual(p.filingStatus, 'single'); assert.strictEqual(p.k401Pct, 100); assert.strictEqual(p.taxMode, 'auto');
  const st = C.normalizeState({}, TODAY); assert.deepStrictEqual(st.recurring, []); assert.strictEqual(st.paycheck.matchPct, 50);
});


console.log('roth 401k & odds');
test('Roth 401k is after-tax: taxable wages keep the contribution, take-home drops by the tax on it', () => {
  const trad = C.paycheckBreakdown({ gross: 6000, frequency: 'monthly', k401Pct: 6, k401Type: 'traditional' });
  const roth = C.paycheckBreakdown({ gross: 6000, frequency: 'monthly', k401Pct: 6, k401Type: 'roth' });
  assert.strictEqual(trad.taxableWages, 5640); assert.strictEqual(roth.taxableWages, 6000);
  assert.strictEqual(roth.k401, 360); assert.strictEqual(roth.pretax, 0); assert.strictEqual(roth.posttax, 360);
  assert.ok(roth.federal > trad.federal, 'more federal tax on Roth');
  assert.strictEqual(roth.socialSecurity, trad.socialSecurity, 'FICA is the same either way');
  close(trad.net - roth.net, roth.federal - trad.federal, 0.011);
  assert.strictEqual(C.paycheckEntries({ gross: 6000, frequency: 'monthly', k401Pct: 6, k401Type: 'roth' }, '2026-12-01')[1].amount, 360);
  assert.strictEqual(C.normalizePaycheck({}).k401Type, 'traditional'); assert.strictEqual(C.normalizePaycheck({ k401Type: 'roth' }).k401Type, 'roth');
});
test('Roth 401k balance is not reduced by the withdrawal tax rate', () => {
  const t = C.retirementCalc(Object.assign({}, base, { k401Balance: 100000, taxRate: 15 }));
  const r = C.retirementCalc(Object.assign({}, base, { k401Balance: 100000, taxRate: 15, k401Type: 'roth' }));
  assert.strictEqual(t.assets, 85000); assert.strictEqual(r.assets, 100000); assert.strictEqual(r.k401Type, 'roth');
});
test('simulate accepts a per-month rate function', () => {
  const s = C.simulate(1000, [], 0, (m) => (m === 1 ? 0.1 : 0), 2, 1e9);
  close(s.path[1].assets, 1100); close(s.path[2].assets, 1100);
});
test('retirementOdds: constant history matches the deterministic projection', () => {
  // 6% nominal every year with 0% inflation must equal retirementCalc at a 6% real return.
  const inp = Object.assign({}, base, { rothBalance: 100000, monthlyContribution: 1000, annualSpending: 40000, returnRate: 6 });
  const det = C.retirementCalc(inp);
  const odds = C.retirementOdds(inp, { returns: [6], inflation: 0, runs: 5 });
  assert.strictEqual(odds.years.length, det.projection.length);
  odds.years.forEach((y, i) => { close(y.p50, det.projection[i].netWorth, 0.05); close(y.p10, y.p90, 0.05); });
  close(odds.reachAge.p50, det.ageAtTarget, 1e-9);
  assert.strictEqual(odds.probByTargetAge, det.ageAtTarget <= inp.targetAge ? 1 : 0);
});
test('retirementOdds on real S&P history: ordered percentiles, deterministic, sane probability', () => {
  const inp = Object.assign({}, base, { age: 30, targetAge: 65, k401Balance: 125000, k401Type: 'roth', monthlyContribution: 1200, annualSpending: 50000, debts: [{ name: 'Car', balance: 22000, rate: 6.5, payment: 430 }] });
  const a = C.retirementOdds(inp, { returns: C.SP500.returns, inflation: 3, runs: 300 });
  const b = C.retirementOdds(inp, { returns: C.SP500.returns, inflation: 3, runs: 300 });
  assert.deepStrictEqual(a, b);
  a.years.forEach(y => assert.ok(y.p10 <= y.p50 && y.p50 <= y.p90));
  assert.ok(a.years[0].p10 === a.years[0].p90, 'year 0 is known');
  assert.ok(a.probByTargetAge > 0.5 && a.probByTargetAge <= 1, 'prob ' + a.probByTargetAge);
  assert.ok(a.reachAge.p10 <= a.reachAge.p50 && a.reachAge.p50 <= a.reachAge.p90);
  assert.strictEqual(C.retirementOdds(inp, { returns: [] }), null);
  assert.strictEqual(C.retirementOdds(Object.assign({}, inp, { withdrawalRate: 0 }), { returns: [5] }), null);
});
test('normalizeState keeps updatedAt and returnFromFund', () => {
  const s = C.normalizeState({ updatedAt: 123, retirement: { returnFromFund: false } }, TODAY);
  assert.strictEqual(s.updatedAt, 123); assert.strictEqual(s.retirement.returnFromFund, false);
  const d = C.normalizeState({}, TODAY); assert.strictEqual(d.updatedAt, 0); assert.strictEqual(d.retirement.returnFromFund, true);
});


console.log('categories & history backfill');
test('new spending categories, old names mapped', () => {
  for (const c of ['Streaming', 'Gaming', 'Recreation', 'Food delivery', 'Groceries', 'Dining', 'Utilities', 'Insurance', 'Debt payments']) assert.ok(C.CATS.expense.includes(c), c);
  assert.ok(!C.CATS.expense.includes('Fun') && !C.CATS.expense.includes('Bills'));
  assert.strictEqual(C.normalizeEntry({ cat: 'Fun', amount: 1, date: TODAY }, TODAY).cat, 'Recreation');
  assert.strictEqual(C.normalizeEntry({ cat: 'Bills', amount: 1, date: TODAY }, TODAY).cat, 'Utilities');
});
test('schema 1 data is re-categorized once by keyword; schema 2 data is left alone', () => {
  const raw = { entries: [
      { id: 'a', date: TODAY, amount: 15.99, cat: 'Fun', note: 'Netflix' },
      { id: 'b', date: TODAY, amount: 32, cat: 'Dining', note: 'DoorDash' },
      { id: 'c', date: TODAY, amount: 60, cat: 'Fun', note: 'Steam sale' },
      { id: 'd', date: TODAY, amount: 90, cat: 'Bills', note: 'TV', recurring: 'rule-1' },
      { id: 'e', date: TODAY, amount: 20, cat: 'Fun', note: 'Movies' },
      { id: 'f', date: TODAY, amount: 120, cat: 'Groceries', note: 'Costco' }],
    recurring: [{ id: 'rule-1', name: 'TV', cat: 'Bills', amount: 90, nextDate: TODAY }, { id: 'rule-5', name: 'Car insurance', cat: 'Transport', amount: 400, nextDate: TODAY }, { id: 'rule-7', name: 'Car loan payment', cat: 'Transport', amount: 430, nextDate: TODAY }, { id: 'rule-2', name: 'Power', cat: 'Bills', amount: 150, nextDate: TODAY }] };
  const st = C.normalizeState(raw, TODAY);
  assert.deepStrictEqual(st.entries.map(e => e.cat), ['Streaming', 'Food delivery', 'Gaming', 'Streaming', 'Recreation', 'Groceries']);
  assert.deepStrictEqual(st.recurring.map(r => r.cat), ['Streaming', 'Insurance', 'Debt payments', 'Utilities']);
  assert.strictEqual(st.schema, 3);
  const again = C.normalizeState(Object.assign({}, st, { entries: [{ id: 'z', date: TODAY, amount: 15.99, cat: 'Utilities', note: 'Netflix', tags: ['bills'] }] }), TODAY);
  assert.strictEqual(again.entries[0].cat, 'Utilities', 'a choice made after the migration sticks');
});
test('rules carry a start date (defaulting to next due) and an optional end date', () => {
  const r = C.normalizeRule({ name: 'Old', nextDate: '2026-12-01' }, TODAY);
  assert.strictEqual(r.startDate, '2026-12-01'); assert.strictEqual(r.endDate, null);
  const bad = C.normalizeRule({ startDate: '2026-05-01', endDate: '2026-01-01', nextDate: '2026-06-01' }, TODAY);
  assert.strictEqual(bad.endDate, null, 'end before start is dropped');
});
test('reconcileRule backfills every past payment from the start date', () => {
  const rule = C.normalizeRule({ id: 'car', name: 'Car loan payment', cat: 'Debt payments', amount: 430, frequency: 'monthly', startDate: '2024-11-07', nextDate: '2024-11-07' }, TODAY);
  const r = C.reconcileRule(rule, [], TODAY);
  assert.strictEqual(r.add.length, 25, '25 monthly payments Nov 2024 .. Nov 2026');
  assert.strictEqual(r.add[0].date, '2024-11-07'); assert.strictEqual(r.add[24].date, '2026-11-07');
  assert.ok(r.add.every(e => e.recurring === 'car' && e.amount === 430 && e.cat === 'Debt payments'));
  assert.strictEqual(r.nextDate, '2026-12-07'); assert.strictEqual(r.ended, false);
});
test('reconcileRule never doubles up and removes entries outside the dates', () => {
  const rule = C.normalizeRule({ id: 'nf', name: 'Netflix', cat: 'Streaming', amount: 15.99, frequency: 'monthly', startDate: '2026-08-15', nextDate: '2026-08-15' }, TODAY);
  const existing = [
    { id: 'x1', recurring: 'nf', date: '2026-07-01' },   // before the start: removed
    { id: 'x2', recurring: 'nf', date: '2026-09-02' },   // logged on a different day of the month: counts for Sep
    { id: 'x3', recurring: 'other', date: '2026-10-15' } // another rule: ignored
  ];
  const r = C.reconcileRule(rule, existing, TODAY);
  assert.deepStrictEqual(r.remove, ['x1']);
  assert.deepStrictEqual(r.add.map(e => e.date), ['2026-08-15', '2026-10-15']);
  const again = C.reconcileRule(rule, existing.filter(e => e.id !== 'x1').concat(r.add), TODAY);
  assert.strictEqual(again.add.length, 0); assert.strictEqual(again.remove.length, 0);
});
test('end dates stop backfill, posting and upcoming; ended rules leave the monthly total', () => {
  const rule = C.normalizeRule({ id: 'gym', name: 'Gym', cat: 'Health', amount: 40, frequency: 'monthly', startDate: '2026-05-01', endDate: '2026-08-31', nextDate: '2026-05-01' }, TODAY);
  const r = C.reconcileRule(rule, [], TODAY);
  assert.deepStrictEqual(r.add.map(e => e.date), ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  assert.ok(r.ended);
  assert.deepStrictEqual(C.dueDates(rule, TODAY).dates, ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  const future = C.normalizeRule({ id: 'f', name: 'Promo', amount: 10, frequency: 'weekly', startDate: '2026-11-08', endDate: '2026-11-20', nextDate: '2026-11-08' }, TODAY);
  assert.deepStrictEqual(C.upcoming({ recurring: [future] }, TODAY, 30).map(u => u.date), ['2026-11-08', '2026-11-15']);
  const ended = Object.assign({}, rule, { nextDate: '2026-09-01' });
  assert.ok(C.ruleEnded(ended, TODAY));
  assert.strictEqual(C.recurringMonthlyTotal([ended, future], 'expense', TODAY), C.round2(10 * 52 / 12));
});
test('paused rules do not backfill', () => {
  const rule = C.normalizeRule({ id: 'p', name: 'Paused', amount: 5, startDate: '2026-01-01', nextDate: '2026-01-01', active: false }, TODAY);
  assert.strictEqual(C.reconcileRule(rule, [], TODAY).add.length, 0);
});


console.log('tags');
test('tags are normalized: lowercase, trimmed, no #, no duplicates, at most 8', () => {
  assert.deepStrictEqual(C.normalizeTags([' Food ', '#DoorDash', 'food', '', 'Date   Night']), ['food', 'doordash', 'date night']);
  assert.deepStrictEqual(C.normalizeTags('a, b ,c'), ['a', 'b', 'c']);
  assert.strictEqual(C.normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).length, 8);
  assert.deepStrictEqual(C.normalizeTags(null), []);
  assert.deepStrictEqual(C.normalizeEntry({ amount: 1, date: TODAY, tags: ['X'] }, TODAY).tags, ['x']);
  assert.ok(!('tags' in C.normalizeEntry({ amount: 1, date: TODAY, tags: [] }, TODAY)), 'no empty tags field');
});
test('suggested tags come from the category and the note', () => {
  assert.deepStrictEqual(C.suggestTags('DoorDash', 'Food delivery'), ['food', 'doordash']);
  assert.deepStrictEqual(C.suggestTags('Netflix', 'Streaming'), ['streaming', 'subscription']);
  assert.deepStrictEqual(C.suggestTags('Xbox Game Pass', 'Gaming'), ['gaming', 'subscription']);
  assert.deepStrictEqual(C.suggestTags('Costco', 'Groceries'), ['groceries']);
  assert.deepStrictEqual(C.suggestTags('Gas', 'Transport'), []);
});
test('schema 2 data gets starter tags once; recurring entries follow their rule', () => {
  const st = C.normalizeState({ schema: 2, recurring: [{ id: 'nf', name: 'Netflix', cat: 'Streaming', amount: 15.99, nextDate: TODAY }],
    entries: [{ id: 'a', date: TODAY, amount: 15.99, cat: 'Streaming', note: 'Netflix', recurring: 'nf' }, { id: 'b', date: TODAY, amount: 30, cat: 'Food delivery', note: 'DoorDash' }, { id: 'c', date: TODAY, amount: 40, cat: 'Transport', note: 'Gas' }, { id: 'd', type: 'income', date: TODAY, amount: 100, cat: 'Paycheck' }] }, TODAY);
  assert.deepStrictEqual(st.recurring[0].tags, ['streaming', 'subscription']);
  assert.deepStrictEqual(st.entries.map(e => e.tags || []), [['streaming', 'subscription'], ['food', 'doordash'], [], []]);
  const later = C.normalizeState(Object.assign({}, st, { entries: [{ id: 'e', date: TODAY, amount: 30, cat: 'Food delivery', note: 'DoorDash' }] }), TODAY);
  assert.ok(!later.entries[0].tags, 'no auto-tagging after the migration');
});
test('tagBreakdown counts an entry under every tag it has', () => {
  const b = C.tagBreakdown([E('expense', TODAY, 30, 'Food delivery', { tags: ['food', 'doordash'] }), E('expense', TODAY, 70, 'Groceries', { tags: ['groceries', 'food'] }), E('expense', TODAY, 50, 'Transport'), E('income', TODAY, 999, 'Paycheck', { tags: ['food'] })]);
  assert.deepStrictEqual(b.tags.map(t => [t.tag, t.total, t.count]), [['food', 100, 2], ['groceries', 70, 1], ['doordash', 30, 1]]);
  close(b.tags[0].share, 100 / 150); assert.strictEqual(b.untagged, 50); assert.strictEqual(b.total, 150);
});
test('knownTags lists used tags by use, then unused starter tags', () => {
  const k = C.knownTags({ entries: [{ tags: ['food'] }, { tags: ['food', 'date night'] }], recurring: [{ tags: ['streaming'] }] });
  assert.deepStrictEqual(k.slice(0, 3).map(t => t.tag), ['food', 'date night', 'streaming']);
  assert.ok(k.some(t => t.tag === 'gaming' && t.count === 0));
  assert.strictEqual(k.filter(t => t.tag === 'food').length, 1);
});
test('recurring rules pass their tags to every logged payment', () => {
  const rule = C.normalizeRule({ id: 'nf', name: 'Netflix', cat: 'Streaming', amount: 15.99, startDate: '2026-09-07', nextDate: '2026-09-07', tags: ['streaming', 'subscription'] }, TODAY);
  assert.ok(C.reconcileRule(rule, [], TODAY).add.every(e => e.tags.join() === 'streaming,subscription'));
  const due = C.postDue({ recurring: [rule], entries: [] }, TODAY);
  assert.ok(due.entries.length === 3 && due.entries.every(e => e.tags.join() === 'streaming,subscription'));
});

console.log('formatting');
test('money formats', () => {
  assert.strictEqual(C.fmtMoney(1234.5), '$1,234.50');
  assert.strictEqual(C.fmtMoney(-3.4), '−$3.40');
  assert.strictEqual(C.fmtMoney(1234.5, { whole: true }), '$1,235');
  assert.strictEqual(C.fmtMoney(15000, { compact: true }), '$15K');
  assert.strictEqual(C.fmtMoney(1250000, { compact: true }), '$1.25M');
  assert.strictEqual(C.fmtMoney(NaN), '—');
  assert.strictEqual(C.fmtPct(0.4545), '45%'); assert.strictEqual(C.fmtPct(null), '—');
  assert.strictEqual(C.fmtMonthsDuration(14), '1y 2m'); assert.strictEqual(C.fmtMonthsDuration(24), '2 years'); assert.strictEqual(C.fmtMonthsDuration(Infinity), 'never');
  assert.strictEqual(C.fmtDate(TODAY, TODAY), 'Today'); assert.strictEqual(C.fmtDate('2026-11-06', TODAY), 'Yesterday'); assert.strictEqual(C.fmtDate('2025-11-05', TODAY), 'Wed, Nov 5, 2025');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

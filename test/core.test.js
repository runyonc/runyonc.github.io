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
  const b = C.categoryBreakdown([E('expense', TODAY, 10, 'Fun'), E('expense', TODAY, 30, 'Groceries'), E('expense', TODAY, 20, 'Fun'), E('income', TODAY, 999)]);
  assert.deepStrictEqual(b.map(x => x.cat), ['Fun', 'Groceries']);
  assert.strictEqual(b[0].total, 30); close(b[0].share + b[1].share, 1);
});
test('groupByDay newest first with daily totals', () => {
  const g = C.groupByDay([E('expense', '2026-11-01', 5), E('expense', '2026-11-03', 7), E('income', '2026-11-03', 100), E('expense', '2026-11-03', 1.5)]);
  assert.deepStrictEqual(g.map(x => x.date), ['2026-11-03', '2026-11-01']);
  assert.strictEqual(g[0].expense, 8.5); assert.strictEqual(g[0].income, 100); assert.strictEqual(g[0].entries.length, 3);
});
test('CSV escapes notes and signs expenses', () => {
  const csv = C.toCSV([E('expense', '2026-11-02', 12.5, 'Dining', { note: 'Pizza, "extra" cheese' }), E('income', '2026-11-01', 2000, 'Paycheck')]);
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'date,type,category,amount,note');
  assert.strictEqual(lines[1], '2026-11-01,income,Paycheck,2000.00,');
  assert.strictEqual(lines[2], '2026-11-02,expense,Dining,-12.50,"Pizza, ""extra"" cheese"');
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

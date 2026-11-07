// Browser tests for index.html using Playwright (Chromium).
// Run: node test/ui.test.js   (requires `playwright` to be installed)
'use strict';
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const URL = 'file://' + path.join(__dirname, '..', 'index.html');
let passed = 0, failed = 0;
const results = [];

async function withPage(opts, fn) {
  const browser = opts.browser;
  const context = await browser.newContext(Object.assign({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, acceptDownloads: true }, opts.context || {}));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(URL);
  await page.waitForTimeout(100);
  try { await fn(page, errors, context); assert.deepStrictEqual(errors, [], 'no console/page errors'); }
  finally { await context.close(); }
}
async function test(name, opts, fn) {
  try { await withPage(opts, fn); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).split('\n').slice(0, 8).join('\n      ')); }
}
const noOverflow = async (page, label) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
};
const text = (page, sel) => page.textContent(sel);
const tab = async (page, name) => { await page.click('#tab-' + name); await page.waitForTimeout(80); };
const addEntry = async (page, { type = 'expense', amount, cat, note = '', date } = {}) => {
  await tab(page, 'add');
  if (type !== 'expense') await page.click(`#type-seg button[data-type="${type}"]`);
  await page.fill('#f-amount', String(amount));
  if (cat) await page.click(`#cat-chips button:has-text("${cat}")`);
  await page.fill('#f-note', note);
  if (date) await page.fill('#f-date', date);
  await page.click('#f-submit');
  await page.waitForTimeout(80);
};

(async () => {
  const browser = await chromium.launch();
  const O = { browser };

  console.log('layout');
  for (const scheme of ['light', 'dark']) {
    await test(`no horizontal overflow on any tab at 360px (${scheme})`, { browser, context: { colorScheme: scheme } }, async (page) => {
      for (const v of ['overview', 'add', 'charts', 'recurring', 'retirement']) { await tab(page, v); await noOverflow(page, v); }
      await page.click('#btn-settings'); await page.waitForTimeout(50); await noOverflow(page, 'settings');
      assert.ok(await page.isVisible('#settings-dialog'));
      await page.click('#settings-close');
      await tab(page, 'charts'); await page.click('.table-toggle[data-table="ch1"]'); await noOverflow(page, 'chart table');
      await tab(page, 'retirement'); await page.click('#d-add'); await noOverflow(page, 'debt form');
      await tab(page, 'recurring'); await page.click('#u-add'); await noOverflow(page, 'rule form'); await page.evaluate(() => { App.state.paycheck.gross = 3000; App.state.paycheck.nextPayDate = App.today(); App.commit(); }); await noOverflow(page, 'paycheck');
    });
  }
  await test('dark is the default theme, the toggle switches to light and persists', { browser, context: { colorScheme: 'light' } }, async (page) => {
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.strictEqual(dark, 'rgb(7, 10, 18)');
    assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await page.click('#btn-settings'); await page.click('#theme-seg button[data-theme="light"]');
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.strictEqual(light, 'rgb(238, 242, 248)');
    await page.reload(); await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'light', 'theme persists');
  });
  await test('reduced motion and 320px wide still render without errors', { browser, context: { reducedMotion: 'reduce', viewport: { width: 320, height: 600 } } }, async (page) => {
    for (const v of ['overview', 'add', 'charts', 'recurring', 'retirement']) { await tab(page, v); await noOverflow(page, v + '@320'); }
  });

  console.log('first run & samples');
  await test('seeds flagged sample data with a banner, and Clear samples removes only samples', O, async (page) => {
    assert.ok(await page.isVisible('#sample-banner'));
    assert.deepStrictEqual(await page.evaluate(() => [App.state.k401Balance, App.state.paycheck.gross, App.state.recurring.map(r => r.name + ' ' + r.amount)]), [125000, 6000, ['TV 90', 'Internet 70', 'Power 150', 'Water 60', 'Car insurance 400', 'Rent 1900', 'Car loan payment 430', 'Credit card payment 250']]);
    assert.deepStrictEqual(await page.evaluate(() => App.state.debts.map(d => [d.name, d.balance, d.rate, d.payment])), [['Car loan', 22000, 6.5, 430], ['Credit card', 7000, 17, 250]]);
    const n = await page.evaluate(() => App.state.entries.filter(e => e.sample).length);
    assert.ok(n > 30, 'has samples');
    assert.strictEqual(await page.evaluate(() => App.state.entries.every(e => e.sample)), true);
    await addEntry(page, { amount: 5, cat: 'Fun', note: 'mine' });
    await tab(page, 'overview');
    await page.click('#btn-clear-samples'); await page.waitForTimeout(50);
    assert.ok(await page.isVisible('#confirm-dialog'), 'confirm shown');
    await page.click('#confirm-ok'); await page.waitForTimeout(80);
    const left = await page.evaluate(() => App.state.entries.map(e => e.note));
    assert.deepStrictEqual(left, ['mine']);
    assert.ok(await page.isHidden('#sample-banner'));
    await page.click('#toast-action'); await page.waitForTimeout(50); // undo
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n + 1);
  });

  console.log('add / edit / delete');
  await test('adding spending updates totals by exactly the amount and shows a toast', O, async (page) => {
    const before = await page.evaluate(() => FinanceCore.totals(FinanceCore.entriesInMonth(App.state.entries, App.ui.month)).expense);
    await addEntry(page, { amount: '12.5', cat: 'Dining', note: 'Tacos' });
    assert.strictEqual(await text(page, '#toast-msg'), 'Added $12.50 · Dining');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'f-amount', 'amount refocused for the next entry');
    assert.strictEqual(await page.inputValue('#f-amount'), '');
    await tab(page, 'overview');
    const after = await page.evaluate(() => FinanceCore.totals(FinanceCore.entriesInMonth(App.state.entries, App.ui.month)).expense);
    assert.strictEqual(Math.round((after - before) * 100), 1250);
    assert.strictEqual(await text(page, '#sum-expense'), FinanceCore_fmt(after));
    assert.ok((await text(page, '#entries')).includes('Tacos'));
  });
  await test('invalid amount or date is rejected with a visible error', O, async (page) => {
    const n = await page.evaluate(() => App.state.entries.length);
    await tab(page, 'add');
    await page.click('#f-submit');
    assert.ok(await page.isVisible('#amount-error'));
    assert.strictEqual(await page.getAttribute('#f-amount', 'aria-invalid'), 'true');
    await page.fill('#f-amount', '0'); await page.click('#f-submit');
    assert.ok(await page.isVisible('#amount-error'));
    await page.fill('#f-amount', '10'); await page.fill('#f-date', ''); await page.click('#f-submit');
    assert.ok(await page.isVisible('#date-error'));
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n);
  });
  await test('income and 401k entries use their own categories, sign and color', O, async (page) => {
    await addEntry(page, { type: 'income', amount: 2000, cat: 'Side work', note: 'gig' });
    await addEntry(page, { type: 'k401', amount: 150, cat: 'Employer match' });
    const types = await page.evaluate(() => App.state.entries.slice(-2).map(e => [e.type, e.cat]));
    assert.deepStrictEqual(types, [['income', 'Side work'], ['k401', 'Employer match']]);
    await tab(page, 'overview');
    const inc = await page.$('.entry .amt.income');
    assert.ok((await inc.textContent()).startsWith('+$2,000.00'));
    const incColor = await inc.evaluate(el => getComputedStyle(el).color);
    const expColor = await page.$eval('.entry .amt.expense', el => getComputedStyle(el).color);
    assert.notStrictEqual(incColor, expColor);
    assert.ok(await page.$('.entry .amt.k401'));
  });
  await test('tapping an entry loads it into the form; Save changes updates it; Cancel leaves it alone', O, async (page) => {
    await addEntry(page, { amount: 40, cat: 'Health', note: 'EditMe' });
    await tab(page, 'overview');
    await page.click('.entry .body:has-text("EditMe")'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#page-title'), 'Edit entry');
    assert.ok(await page.isVisible('#edit-actions'));
    assert.ok(await page.isHidden('#form-actions'));
    assert.strictEqual(await page.inputValue('#f-amount'), '40');
    assert.strictEqual(await page.getAttribute('#cat-chips button:has-text("Health")', 'aria-checked'), 'true');
    assert.strictEqual(await page.inputValue('#f-note'), 'EditMe');
    await page.fill('#f-amount', '45.25'); await page.click('#type-seg button[data-type="income"]'); await page.click('#cat-chips button:has-text("Interest")');
    await page.click('#f-save'); await page.waitForTimeout(80);
    const e = await page.evaluate(() => App.state.entries.find(x => x.note === 'EditMe'));
    assert.strictEqual(e.amount, 45.25); assert.strictEqual(e.type, 'income'); assert.strictEqual(e.cat, 'Interest'); assert.ok(!e.sample);
    assert.strictEqual(await page.evaluate(() => App.ui.view), 'overview');
    await page.click('.entry .body:has-text("EditMe")'); await page.fill('#f-amount', '999'); await page.click('#f-cancel'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.find(x => x.note === 'EditMe').amount), 45.25);
    assert.strictEqual(await text(page, '#page-title'), 'Overview');
  });
  await test('delete needs two taps (✕ then Delete), and Undo restores', O, async (page) => {
    await addEntry(page, { amount: 7, cat: 'Fun', note: 'DeleteMe' });
    await tab(page, 'overview');
    const n = await page.evaluate(() => App.state.entries.length);
    const row = page.locator('.entry:has-text("DeleteMe")');
    await row.locator('.del-btn').click(); await page.waitForTimeout(50);
    assert.strictEqual(await row.locator('.del-btn').textContent(), 'Delete');
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n, 'first tap does not delete');
    await row.locator('.del-btn').click(); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n - 1);
    assert.ok((await text(page, '#toast-msg')).startsWith('Deleted $7.00'));
    await page.click('#toast-action'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n);
  });
  await test('delete from the edit form also needs confirmation', O, async (page) => {
    await addEntry(page, { amount: 3, cat: 'Other', note: 'FormDelete' });
    await tab(page, 'overview'); await page.click('.entry .body:has-text("FormDelete")');
    await page.click('#f-delete'); assert.strictEqual(await text(page, '#f-delete'), 'Confirm delete');
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.note === 'FormDelete')));
    await page.click('#f-delete'); await page.waitForTimeout(80);
    assert.ok(!(await page.evaluate(() => App.state.entries.some(e => e.note === 'FormDelete'))));
    assert.strictEqual(await page.evaluate(() => App.ui.view), 'overview');
  });

  console.log('overview');
  await test('budget bar turns orange at 85% and red when over, with the right text', O, async (page) => {
    const spent = await page.evaluate(() => FinanceCore.totals(FinanceCore.entriesInMonth(App.state.entries, App.ui.month)).expense);
    await page.fill('#budget-input', String(Math.round(spent / 0.9))); await page.press('#budget-input', 'Enter'); await page.waitForTimeout(50);
    assert.strictEqual(await page.getAttribute('#budget-meter', 'class'), 'meter warn');
    assert.ok((await text(page, '#budget-left')).endsWith(' left'));
    await page.fill('#budget-input', '100'); await page.press('#budget-input', 'Enter'); await page.waitForTimeout(50);
    assert.strictEqual(await page.getAttribute('#budget-meter', 'class'), 'meter over');
    assert.strictEqual(await text(page, '#budget-left'), FinanceCore_fmt(spent - 100) + ' over budget');
    assert.strictEqual(await page.$eval('#budget-fill', el => el.style.width), '100%');
    await page.fill('#budget-input', '-5'); await page.press('#budget-input', 'Enter'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.budget), 100, 'negative budget rejected');
  });
  await test('month navigation and empty state', O, async (page) => {
    const label = await text(page, '#month-label');
    await page.click('#month-prev'); assert.notStrictEqual(await text(page, '#month-label'), label);
    assert.ok(await page.isVisible('#month-today'));
    for (let i = 0; i < 12; i++) await page.click('#month-prev');
    assert.ok((await text(page, '#entries')).includes('Nothing logged in'));
    assert.ok(await page.isDisabled('#btn-csv'));
    await page.click('#month-today'); assert.strictEqual(await text(page, '#month-label'), label);
    assert.ok(await page.isHidden('#month-today'));
  });
  await test('savings rate and net follow the formula on the summary card', O, async (page) => {
    const t = await page.evaluate(() => FinanceCore.totals(FinanceCore.entriesInMonth(App.state.entries, App.ui.month)));
    assert.strictEqual(await text(page, '#sum-net'), FinanceCore_fmt(t.income - t.expense));
    assert.strictEqual(await text(page, '#sum-rate'), Math.round(((t.income - t.expense + t.k401) / (t.income + t.k401)) * 100) + '%');
    const rows = await page.$$eval('#breakdown .bar-row', els => els.map(e => e.querySelector('.val').textContent));
    assert.ok(rows.length >= 2, 'breakdown present');
  });
  await test('copy month as CSV puts a header and signed amounts on the clipboard', { browser, init: () => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } }); } }, async (page) => {
    await page.click('#btn-csv'); await page.waitForTimeout(80);
    const csv = await page.evaluate(() => window.__copied);
    assert.ok(csv.startsWith('date,type,category,amount,note\n'));
    assert.ok(/,expense,Housing,-1900\.00,/.test(csv));
    assert.ok(/Copied \d+ rows as CSV/.test(await text(page, '#toast-msg')));
  });
  await test('401k balance saves with today as the update date and feeds Retirement', O, async (page) => {
    await page.fill('#k401-balance', '31250.5'); await page.click('#k401-save'); await page.waitForTimeout(50);
    const s = await page.evaluate(() => ({ b: App.state.k401Balance, d: App.state.k401UpdatedAt, t: App.today() }));
    assert.strictEqual(s.b, 31250.5); assert.strictEqual(s.d, s.t);
    assert.ok((await text(page, '#k401-updated')).includes('Today'));
    await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#r-k401'), '31250.5');
  });

  console.log('persistence & backup');
  await test('entries survive a reload (autosave)', O, async (page) => {
    await addEntry(page, { amount: 11, cat: 'Transport', note: 'Persist' });
    await page.reload(); await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.note === 'Persist')));
    assert.ok(await page.isVisible('#sample-banner'), 'samples not re-seeded');
  });
  await test('old entries with no type are treated as expenses on load', { browser, init: () => { localStorage.setItem('money-tracker-v2', JSON.stringify({ budget: 2500, entries: [{ id: 'x', date: new Date().toISOString().slice(0, 10), amount: 20, cat: 'Fun', note: 'legacy' }] })); } }, async (page) => {
    assert.deepStrictEqual(await page.evaluate(() => App.state.entries.map(e => e.type)), ['expense']);
    assert.strictEqual(await text(page, '#sum-expense'), '$20.00');
    assert.strictEqual(await page.inputValue('#budget-input'), '2500');
    assert.ok(await page.isHidden('#sample-banner'));
  });
  await test('export downloads a JSON backup with the full state', O, async (page) => {
    await page.click('#btn-settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    assert.ok(/^money-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()));
    const fs = require('fs'); const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    for (const k of ['budget', 'k401Balance', 'k401UpdatedAt', 'rothBalance', 'savingsBalance', 'otherInvestments', 'debts', 'retirement', 'entries']) assert.ok(k in json, 'has ' + k);
    assert.strictEqual(json.entries.length, await page.evaluate(() => App.state.entries.length));
  });
  await test('import asks for confirmation, replaces data, and can be undone', O, async (page) => {
    const n = await page.evaluate(() => App.state.entries.length);
    const payload = { budget: 1234, entries: [{ id: 'imp1', type: 'income', date: '2026-01-05', amount: 500, cat: 'Paycheck', note: 'imported' }], debts: [{ name: 'Loan', balance: 100, rate: 1, payment: 10 }] };
    await page.click('#btn-settings');
    await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await page.waitForTimeout(100);
    assert.ok(await page.isVisible('#confirm-dialog'));
    await page.click('#confirm-cancel'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n, 'cancel keeps data');
    await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
    await page.waitForTimeout(100); await page.click('#confirm-ok'); await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => [App.state.entries.length, App.state.budget, App.state.debts[0].name]), [1, 1234, 'Loan']);
    assert.ok(await page.evaluate(() => !!localStorage.getItem('money-tracker-v2-backup')), 'previous data stashed');
    await page.click('#toast-action'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n, 'undo restores');
    await page.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{not json') });
    await page.waitForTimeout(100);
    assert.ok((await text(page, '#toast-msg')).includes('not valid JSON'));
  });
  await test('delete all data requires confirmation and leaves a clean empty state', O, async (page) => {
    await page.click('#btn-settings'); await page.click('#btn-wipe'); await page.waitForTimeout(50);
    await page.click('#confirm-cancel'); await page.waitForTimeout(50);
    assert.ok(await page.evaluate(() => App.state.entries.length > 0));
    await page.click('#btn-wipe'); await page.waitForTimeout(50); await page.click('#confirm-ok'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), 0);
    assert.ok((await text(page, '#entries')).includes('Nothing logged'));
    assert.strictEqual(await text(page, '#sum-rate'), '—');
    await tab(page, 'charts'); assert.ok((await text(page, '#chart-flow')).includes('No income or spending'));
    await tab(page, 'retirement'); assert.ok((await text(page, '#r-spending-help')).includes('No entries yet'));
    await noOverflow(page, 'empty retirement');
  });
  await test('blocked localStorage does not crash the app and is surfaced', { browser, init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); } }, async (page) => {
    assert.strictEqual(await text(page, '#page-sub'), 'Not saving — storage blocked');
    await addEntry(page, { amount: 1, cat: 'Fun' });
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.amount === 1)));
  });

  console.log('charts');
  await test('date presets filter every chart and the totals beside them', O, async (page) => {
    await tab(page, 'charts');
    const six = await text(page, '#rt-expense');
    await page.selectOption('#range-preset', 'thisMonth'); await page.waitForTimeout(80);
    const month = await text(page, '#rt-expense');
    assert.notStrictEqual(six, month);
    assert.ok((await text(page, '#range-label')).includes('by week'));
    const expected = await page.evaluate(() => { const r = FinanceCore.rangeForPreset('thisMonth', App.today()); return FinanceCore.fmtMoney(FinanceCore.totals(FinanceCore.entriesInRange(App.state.entries, r.from, r.to)).expense); });
    assert.strictEqual(month, expected);
    await page.selectOption('#range-preset', 'all'); await page.waitForTimeout(80);
    const all = await page.evaluate(() => FinanceCore.fmtMoney(FinanceCore.totals(App.state.entries).expense));
    assert.strictEqual(await text(page, '#rt-expense'), all);
    assert.ok(await page.$('#chart-flow svg'), 'flow chart rendered');
    assert.ok(await page.$('#chart-rate svg')); assert.ok(await page.$('#chart-k401 svg'));
  });
  await test('custom range validates and shows an empty state when there is no data', O, async (page) => {
    await tab(page, 'charts');
    await page.selectOption('#range-preset', 'custom'); await page.waitForTimeout(50);
    assert.ok(await page.isVisible('#custom-range'));
    assert.ok((await text(page, '#range-label')).includes('Pick both'));
    await page.fill('#range-from', '2019-01-01'); await page.fill('#range-to', '2019-03-31'); await page.waitForTimeout(80);
    assert.ok((await text(page, '#chart-flow')).includes('No income or spending'));
    assert.ok((await text(page, '#chart-cats')).includes('No spending'));
    assert.ok((await text(page, '#chart-rate')).includes('needs at least one month'));
    assert.strictEqual(await text(page, '#rt-expense'), '$0.00');
    await page.fill('#range-from', '2026-03-31'); await page.fill('#range-to', '2019-01-01'); await page.waitForTimeout(80);
    assert.ok((await text(page, '#range-label')).includes('Jan 1'), 'reversed dates are swapped, not rejected');
  });
  await test('hover and keyboard tooltips show exact values; table view matches', O, async (page) => {
    await tab(page, 'charts');
    const svg = page.locator('#chart-flow svg');
    const box = await svg.boundingBox();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2); await page.waitForTimeout(50);
    const tip = await text(page, '#chart-flow .tooltip');
    const last = await page.evaluate(() => { const r = FinanceCore.rangeForPreset('last6', App.today(), App.state.entries); const b = FinanceCore.bucketize(App.state.entries, r.from, r.to); const l = b[b.length - 1]; return { title: FinanceCore.fmtMonthKey(l.key, true), inc: FinanceCore.fmtMoney(l.income), exp: FinanceCore.fmtMoney(l.expense) }; });
    assert.ok(tip.includes(last.title) && tip.includes(last.inc) && tip.includes(last.exp), 'tooltip has last bucket: ' + tip);
    await svg.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(30);
    assert.ok(!(await text(page, '#chart-flow .tooltip')).includes(last.title), 'arrow moves to previous bucket');
    await page.keyboard.press('Escape'); assert.ok(!(await page.getAttribute('#chart-flow .tooltip', 'class')).includes('show'));
    await page.click('.table-toggle[data-table="ch1"]'); await page.waitForTimeout(50);
    assert.strictEqual(await page.getAttribute('.table-toggle[data-table="ch1"]', 'aria-expanded'), 'true');
    const rows = await page.$$eval('#chart-flow table tbody tr', trs => trs.map(tr => tr.textContent));
    assert.ok(rows[rows.length - 1].includes(last.inc));
  });
  await test('category multi-select filters the flow and category charts and the spending total', O, async (page) => {
    await tab(page, 'charts');
    await page.click('#cat-filter-details summary');
    const before = await text(page, '#rt-expense');
    await page.click('#cat-filter button:has-text("Housing")'); await page.waitForTimeout(80);
    const after = await text(page, '#rt-expense');
    assert.notStrictEqual(before, after);
    assert.ok(!(await text(page, '#chart-cats')).includes('Housing'));
    assert.ok((await text(page, '#range-totals')).includes('Spending (filtered)'));
    await page.click('#cat-filter button:has-text("All")'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#rt-expense'), before);
  });

  console.log('retirement');
  await test('tiles, progress and plain-language line agree with FinanceCore', O, async (page) => {
    await tab(page, 'retirement');
    await page.fill('#r-roth', '50000'); await page.fill('#r-savings', '10000'); await page.waitForTimeout(100);
    const calc = await page.evaluate(() => { const s = App.state, r = s.retirement, a = FinanceCore.averages(s.entries, App.today()); return FinanceCore.retirementCalc({ age: r.age, targetAge: r.targetAge, withdrawalRate: r.withdrawalRate, returnRate: r.returnRate, taxRate: r.taxRate, annualSpending: a.expense * 12, monthlyContribution: a.k401 + a.net, k401Balance: s.k401Balance, rothBalance: s.rothBalance, savingsBalance: s.savingsBalance, otherInvestments: s.otherInvestments, debts: s.debts, today: App.today() }); });
    assert.strictEqual(await text(page, '#rt-networth'), await page.evaluate(() => FinanceCore.fmtMoney(FinanceCore.round2(App.state.k401Balance * 0.85 + 60000 - FinanceCore.totalDebt(App.state.debts)), { compact: true, whole: true })));
    assert.strictEqual(await text(page, '#rt-progress'), (calc.progress < 0.1 ? (calc.progress * 100).toFixed(1) : Math.round(calc.progress * 100)) + '%');
    assert.strictEqual(await text(page, '#rt-age'), 'Age ' + Math.ceil(calc.ageAtTarget));
    const plain = await text(page, '#rt-plain');
    assert.ok(plain.includes('by age ' + Math.ceil(calc.ageAtTarget)), plain);
    assert.ok(Math.abs(parseFloat(await page.$eval('#rt-fill', el => el.style.width)) - Math.min(100, calc.progress * 100)) < 0.01, 'meter width');
    assert.ok(await page.$('#chart-proj svg'));
  });
  await test('spending and contribution overrides, reset to tracker average', O, async (page) => {
    await tab(page, 'retirement');
    const target0 = await text(page, '#rt-target');
    await page.fill('#r-spending', '60000'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#rt-target'), '$1.5M');
    assert.strictEqual(await page.evaluate(() => App.state.retirement.spendingOverride), 60000);
    assert.ok(await page.isVisible('#r-spending-reset'));
    await page.click('#r-spending-reset'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#rt-target'), target0);
    assert.strictEqual(await page.evaluate(() => App.state.retirement.spendingOverride), null);
    await page.fill('#r-contrib', '0'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.retirement.contributionOverride), 0);
    await page.click('details:has(#r-wr) summary'); await page.fill('#r-wr', '3'); await page.waitForTimeout(80);
    const t3 = await page.evaluate(() => FinanceCore.averages(App.state.entries, App.today()).expense * 12 / 0.03);
    assert.ok((await text(page, '#rt-target-sub')).includes('÷ 3%'));
    await page.click('#r-assume-reset'); await page.waitForTimeout(50);
    assert.deepStrictEqual(await page.evaluate(() => { const r = App.state.retirement; return [r.withdrawalRate, r.returnRate, r.taxRate]; }), [4, 6, 15]);
    await page.reload(); await page.waitForTimeout(100); await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#r-contrib'), '0', 'override persisted');
  });
  await test('debts: add, edit, delete with confirm; table sorted by rate with payoff and interest', O, async (page) => {
    await page.evaluate(() => { App.state.debts = []; App.commit(); });
    await tab(page, 'retirement');
    await page.click('#d-add'); await page.click('#d-save');
    assert.ok(await page.isVisible('#d-error'), 'validation');
    await page.fill('#d-name', 'Car'); await page.fill('#d-balance', '1000'); await page.fill('#d-rate', '0'); await page.fill('#d-payment', '100'); await page.click('#d-save'); await page.waitForTimeout(80);
    await page.click('#d-add'); await page.fill('#d-name', 'Card'); await page.fill('#d-balance', '100'); await page.fill('#d-rate', '120'); await page.fill('#d-payment', '60'); await page.click('#d-save'); await page.waitForTimeout(80);
    await page.click('#d-add'); await page.fill('#d-name', 'Stuck'); await page.fill('#d-balance', '5000'); await page.fill('#d-rate', '30'); await page.fill('#d-payment', '50'); await page.click('#d-save'); await page.waitForTimeout(80);
    const rows = await page.$$eval('#debt-table tbody tr', trs => trs.map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
    assert.deepStrictEqual(rows.map(r => r[0]), ['Card', 'Stuck', 'Car', 'Total']);
    assert.ok(rows[0][3].includes('2 months')); assert.strictEqual(rows[0][4], '$15');
    assert.strictEqual(rows[1][3], 'never'); assert.strictEqual(rows[1][4], '∞');
    assert.ok(rows[2][3].includes('10 months')); assert.strictEqual(rows[2][4], '$0');
    assert.strictEqual(rows[3][1], '$6,100');
    assert.ok((await text(page, '#debt-summary')).includes('3 debts'));
    assert.ok((await text(page, '#rt-networth-sub')).includes('$6,100 debt'));
    await page.click('.debt-row:has-text("Stuck") button:has-text("Edit")'); await page.fill('#d-payment', '500'); await page.click('#d-save'); await page.waitForTimeout(80);
    assert.ok(!(await text(page, '#debt-table')).includes('never'));
    const del = page.locator('.debt-row:has-text("Card") .del-btn');
    await del.click(); assert.strictEqual(await del.textContent(), 'Delete');
    await del.click(); await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => App.state.debts.map(d => d.name)), ['Car', 'Stuck']);
    await page.reload(); await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => App.state.debts.length), 2, 'debts persisted');
  });


  console.log('retirement: ages, interest options, 401k fund');
  await test('current age and target age sit at the top of Retirement and drive the years-to-go hint', O, async (page) => {
    await tab(page, 'retirement');
    const inTop = await page.evaluate(() => { const card = document.querySelector('#view-retirement section.card'); return !!card.querySelector('#r-age') && !!card.querySelector('#r-target-age'); });
    assert.ok(inTop, 'age inputs are inside the first card');
    await page.fill('#r-age', '35'); await page.fill('#r-target-age', '60'); await page.waitForTimeout(100);
    assert.strictEqual(await text(page, '#ret-years'), '25 years to go');
    assert.deepStrictEqual(await page.evaluate(() => [App.state.retirement.age, App.state.retirement.targetAge]), [35, 60]);
    assert.ok((await text(page, '#rt-gap')).includes('target age of 60'));
  });
  await test('debt interest option: compounding choice is saved and shown; 0% promo ignores the APR', O, async (page) => {
    await tab(page, 'retirement');
    await page.click('#d-add');
    await page.selectOption('#d-compound', 'none');
    assert.ok(await page.isDisabled('#d-rate'));
    assert.ok((await text(page, '#d-compound-help')).includes('No interest'));
    await page.fill('#d-name', 'Promo card'); await page.fill('#d-balance', '1200'); await page.fill('#d-payment', '100'); await page.click('#d-save'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.debts.find(d => d.name === 'Promo card').compounding), 'none');
    assert.ok((await text(page, '#debt-list')).includes('no interest'));
    const row = (await page.$$eval('#debt-table tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ')))).filter(r => r.includes('Promo card'));
    assert.ok(row[0].includes('1 year') && /\$0(\.00)?$/.test(row[0].trim()), row[0]);
    await page.click('.debt-row:has-text("Promo card") button:has-text("Edit")');
    assert.strictEqual(await page.inputValue('#d-compound'), 'none');
    await page.selectOption('#d-compound', 'daily'); await page.fill('#d-rate', '24'); await page.click('#d-save'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.debts.find(d => d.name === 'Promo card').compounding), 'daily');
    assert.ok((await text(page, '#debt-list')).includes('daily compounding'));
    await page.reload(); await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => App.state.debts.find(d => d.name === 'Promo card').compounding), 'daily');
  });
  await test('401k fund selector shows FXAIX/LFIKX history, forecast band, and feeds the projection', O, async (page) => {
    await page.fill('#k401-balance', '20000'); await page.click('#k401-save'); await page.waitForTimeout(50);
    await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#k-fund'), 'FXAIX');
    const fx = parseFloat(await page.inputValue('#k-return'));
    const expectedFx = await page.evaluate(() => Math.round(FinanceCore.seriesStats(FinanceCore.fundBasisSeries('FXAIX')).cagr * 10) / 10);
    assert.strictEqual(fx, expectedFx);
    assert.ok(await page.$('#chart-fund-hist svg'), 'history chart'); assert.ok(await page.$('#chart-fund-forecast svg'), 'forecast chart');
    assert.ok(await page.$('#chart-fund-forecast svg .band'), 'percentile band drawn');
    assert.strictEqual(await page.$$eval('#chart-fund-hist svg .bar', b => b.length), 14, 'one bar per FXAIX year');
    assert.ok((await text(page, '#k-facts')).includes('0.015%'));
    await page.selectOption('#k-fund', 'LFIKX'); await page.waitForTimeout(120);
    const lf = parseFloat(await page.inputValue('#k-return'));
    assert.ok(lf < fx, 'LFIKX long-run estimate is lower than FXAIX');
    assert.strictEqual(await page.$$eval('#chart-fund-hist svg .bar', b => b.length), 10, 'one bar per LFIKX year');
    assert.ok((await text(page, '#k-basis')).includes('beta 0.85'));
    assert.ok((await text(page, '#k-forecast-line')).includes('LFIKX'));
    // tooltip on the history chart shows the exact stored value for 2022
    const svg = page.locator('#chart-fund-hist svg'); await svg.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    assert.ok((await text(page, '#chart-fund-hist .tooltip')).includes('-15.44%'));
    // apply real return to the projection
    const before = await page.evaluate(() => App.state.retirement.returnRate);
    await page.click('#k-apply'); await page.waitForTimeout(80);
    const after = await page.evaluate(() => App.state.retirement.returnRate);
    assert.notStrictEqual(before, after);
    const real = await page.evaluate(() => Math.round(FinanceCore.realRate(Math.round(FinanceCore.seriesStats(FinanceCore.fundBasisSeries('LFIKX')).cagr * 10) / 10, 3) * 10) / 10);
    assert.strictEqual(after, real);
    assert.ok(await page.isDisabled('#k-apply'));
    // override and reset
    await page.fill('#k-return', '5'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.k401ReturnOverride), 5);
    assert.ok(await page.isVisible('#k-return-reset'));
    await page.click('#k-return-reset'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.k401ReturnOverride), null);
    await page.selectOption('#k-fund', 'custom'); await page.waitForTimeout(80);
    assert.strictEqual(await page.inputValue('#k-return'), '7');
    assert.ok((await text(page, '#chart-fund-hist')).includes('No historical data'));
    await page.reload(); await page.waitForTimeout(100); await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#k-fund'), 'custom', 'fund choice persisted');
  });


  console.log('recurring & paycheck');
  await test('Repeat on the Add form creates a rule and logs the entry; the rule shows on Recurring and Overview', O, async (page) => {
    await tab(page, 'add');
    await page.fill('#f-amount', '15.99'); await page.click('#cat-chips button:has-text("Fun")'); await page.fill('#f-note', 'Netflix');
    await page.selectOption('#f-repeat', 'monthly'); await page.click('#f-submit'); await page.waitForTimeout(100);
    assert.ok((await text(page, '#toast-msg')).includes('repeats monthly'));
    const rule = await page.evaluate(() => App.state.recurring[App.state.recurring.length - 1]);
    assert.strictEqual(rule.name, 'Netflix'); assert.strictEqual(rule.amount, 15.99); assert.strictEqual(rule.frequency, 'monthly');
    assert.strictEqual(rule.nextDate, await page.evaluate(() => FinanceCore.advanceDate(App.today(), 'monthly', +App.today().slice(8))));
    assert.strictEqual(await page.evaluate(() => App.state.entries.filter(e => e.recurring === App.state.recurring[App.state.recurring.length - 1].id).length), 1);
    assert.strictEqual(await page.inputValue('#f-repeat'), '', 'repeat resets after adding');
    await tab(page, 'overview');
    assert.ok(await page.isVisible('#recurring-card'));
    assert.strictEqual(await text(page, '#ov-bills'), await page.evaluate(() => App.tileMoney(FinanceCore.recurringMonthlyTotal(App.state.recurring, 'expense'))));
    await page.click('#recur-open'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.ui.view), 'recurring');
    assert.ok((await text(page, '#rule-list')).includes('Netflix'));
    assert.ok((await text(page, '#rec-total')).includes('/mo'));
  });
  await test('overdue rules are logged once on load, with undo; paused rules are skipped', { browser, init: () => {
      const t = new Date(); const iso = d => d.toISOString().slice(0, 10);
      const past = new Date(t.getFullYear(), t.getMonth() - 2, Math.min(t.getDate(), 28));
      localStorage.setItem('money-tracker-v2', JSON.stringify({ entries: [], recurring: [
        { id: 'rent', name: 'Rent', type: 'expense', cat: 'Housing', amount: 1450, frequency: 'monthly', nextDate: iso(past), anchorDay: past.getDate() },
        { id: 'gym', name: 'Gym', type: 'expense', cat: 'Health', amount: 40, frequency: 'monthly', nextDate: iso(past), active: false }] }));
    } }, async (page) => {
    const logged = await page.evaluate(() => App.state.entries.map(e => [e.note, e.amount, e.recurring]));
    assert.strictEqual(logged.length, 3, 'three monthly rent occurrences caught up: ' + JSON.stringify(logged));
    assert.ok(logged.every(l => l[0] === 'Rent' && l[1] === 1450 && l[2] === 'rent'));
    assert.ok((await text(page, '#toast-msg')).includes('Logged 3 recurring'));
    const next = await page.evaluate(() => App.state.recurring[0].nextDate);
    assert.ok(next > await page.evaluate(() => App.today()));
    await page.reload(); await page.waitForTimeout(150);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), 3, 'not logged twice');
    assert.ok((await text(page, '#entries')).includes('auto'), 'auto tag shown');
    await page.evaluate(() => { localStorage.clear(); });
  });
  await test('paycheck setup estimates taxes, logs a paycheck with 401k entries, and auto-logs on pay day', O, async (page) => {
    await tab(page, 'recurring');
    await page.fill('#p-gross', '3000'); await page.selectOption('#p-freq', 'biweekly'); await page.fill('#p-k401pct', '6'); await page.fill('#p-health', '100'); await page.fill('#p-staterate', '5');
    await page.press('#p-staterate', 'Tab'); await page.waitForTimeout(120);
    const b = await page.evaluate(() => FinanceCore.paycheckBreakdown(App.state.paycheck));
    assert.strictEqual(b.gross, 3000); assert.strictEqual(b.k401, 180); assert.strictEqual(b.match, 90);
    assert.strictEqual(await text(page, '#pay-net-month'), FinanceCore_fmt(b.monthly.net));
    const lines = await text(page, '#pay-lines');
    assert.ok(lines.includes('Federal income tax') && lines.includes('Social Security') && lines.includes('Medicare') && lines.includes('State income tax'), lines);
    assert.ok(lines.includes(FinanceCore_fmt(b.net)));
    const n0 = await page.evaluate(() => App.state.entries.length);
    await page.click('#pay-log'); await page.waitForTimeout(100);
    const added = await page.evaluate(() => App.state.entries.slice(-3).map(e => [e.type, e.cat, e.amount]));
    assert.deepStrictEqual(added, [['income', 'Paycheck', b.net], ['k401', 'My contribution', 180], ['k401', 'Employer match', 90]]);
    await page.click('#toast-action'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), n0, 'undo removes all three');
    // manual tax mode
    await page.click('#p-taxmode button[data-mode="manual"]'); await page.waitForTimeout(80);
    assert.ok(await page.isVisible('#p-federal')); assert.ok(await page.isHidden('#p-staterate'));
    await page.fill('#p-federal', '300'); await page.fill('#p-ss', '186'); await page.fill('#p-medicare', '43.5'); await page.fill('#p-state', '120'); await page.press('#p-state', 'Tab'); await page.waitForTimeout(120);
    assert.strictEqual(await page.evaluate(() => FinanceCore.paycheckBreakdown(App.state.paycheck).taxes), 649.5);
    // auto-log: set next pay date in the past, reload
    await page.evaluate(() => { App.state.paycheck.nextPayDate = FinanceCore.addDays(App.today(), -3); App.state.paycheck.autoLog = true; App.saveState(); });
    await page.reload(); await page.waitForTimeout(150);
    const auto = await page.evaluate(() => App.state.entries.filter(e => e.recurring === 'paycheck' && !e.sample).map(e => e.type));
    assert.deepStrictEqual(auto, ['income', 'k401', 'k401']);
    assert.ok(await page.evaluate(() => App.state.paycheck.nextPayDate > App.today()));
    await tab(page, 'overview');
    assert.ok((await text(page, '#ov-pay-sub')).includes('every 2 weeks'));
  });
  await test('bills form: add, edit, pause and delete with confirm; upcoming lists them', O, async (page) => {
    await tab(page, 'recurring');
    await page.click('#u-add'); await page.click('#u-save');
    assert.ok(await page.isVisible('#u-error'));
    await page.fill('#u-name', 'Spotify'); await page.fill('#u-amount', '10.99'); await page.selectOption('#u-freq', 'monthly');
    const due = await page.evaluate(() => FinanceCore.addDays(App.today(), 5)); await page.fill('#u-next', due); await page.selectOption('#u-cat', 'Fun'); await page.click('#u-save'); await page.waitForTimeout(100);
    const sp = await page.evaluate(() => App.state.recurring.find(r => r.name === 'Spotify')); assert.deepStrictEqual([sp.amount, sp.cat, sp.nextDate], [10.99, 'Fun', due]);
    assert.strictEqual(await page.evaluate(() => App.state.entries.filter(e => e.recurring && e.recurring.length > 12).length), 0, 'future due date logs nothing yet');
    assert.ok((await text(page, '#upcoming')).includes('Spotify'));
    await page.click('.rule-row:has-text("Spotify") button:has-text("Edit")'); await page.fill('#u-amount', '11.99'); await page.click('#u-save'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.recurring.find(r => r.name === 'Spotify').amount), 11.99);
    await page.click('.rule-row:has-text("Spotify") button:has-text("Pause")'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.recurring.find(r => r.name === 'Spotify').active), false);
    assert.ok(!(await text(page, '#upcoming')).includes('Spotify'), 'paused items leave upcoming');
    const del = page.locator('.rule-row:has-text("Spotify") .del-btn');
    await del.click(); assert.strictEqual(await del.textContent(), 'Delete'); await del.click(); await page.waitForTimeout(80);
    assert.ok(!(await page.evaluate(() => App.state.recurring.some(r => r.name === 'Spotify'))));
    await page.click('#toast-action'); await page.waitForTimeout(50);
    assert.ok(await page.evaluate(() => App.state.recurring.some(r => r.name === 'Spotify')), 'undo restores the rule');
  });

  console.log('accessibility');
  await test('every form control has a label, and keyboard focus is visible', O, async (page) => {
    const unlabeled = await page.evaluate(() => Array.from(document.querySelectorAll('input, select, textarea')).filter(el => el.type === 'hidden' ? false : !(el.getAttribute('aria-label') || el.labels && el.labels.length)).map(el => el.id || el.outerHTML.slice(0, 60)));
    assert.deepStrictEqual(unlabeled, []);
    const unnamedButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => !b.hidden && !(b.textContent.trim() || b.getAttribute('aria-label'))).map(b => b.id));
    assert.deepStrictEqual(unnamedButtons, []);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; });
    assert.ok(outline.startsWith('solid'), 'focus ring: ' + outline);
    assert.strictEqual(await page.getAttribute('#budget-meter', 'role'), 'progressbar');
    assert.strictEqual(await page.getAttribute('#toast', 'aria-live'), 'polite');
    await tab(page, 'charts');
    assert.strictEqual(await page.getAttribute('#chart-flow svg', 'tabindex'), '0');
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function FinanceCore_fmt(n) { const neg = n < 0; n = Math.abs(n); return (neg ? '−' : '') + '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

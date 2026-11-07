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
  if (opts.init) await page.addInitScript(opts.init, opts.initArg);
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
    assert.deepStrictEqual(await page.evaluate(() => [App.state.k401Balance, App.state.paycheck.gross, App.state.recurring.map(r => r.name + ' ' + r.amount)]), [125000, 6000, ['Internet 70', 'Power 150', 'Water 60', 'Car insurance 400', 'Rent 1900', 'Car loan payment 430', 'Credit card payment 250', 'YouTube Premium Lite 12', 'YouTube TV 60', 'Twitch Turbo 13']]);
    assert.deepStrictEqual(await page.evaluate(() => App.state.debts.map(d => [d.name, d.balance, d.rate, d.payment])), [['Car loan', 22000, 6.5, 430], ['Credit card', 7000, 17, 250]]);
    const n = await page.evaluate(() => App.state.entries.filter(e => e.sample).length);
    assert.ok(n > 30, 'has samples');
    assert.strictEqual(await page.evaluate(() => App.state.entries.every(e => e.sample)), true);
    await addEntry(page, { amount: 5, cat: 'Recreation', note: 'mine' });
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
    await addEntry(page, { amount: 7, cat: 'Recreation', note: 'DeleteMe' });
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
    for (let i = 0; i < 26; i++) await page.click('#month-prev'); // past the 2-year YouTube Premium Lite history
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
    assert.ok(csv.startsWith('date,type,category,amount,note,tags\n'));
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
  await test('old entries with no type are treated as expenses on load', { browser, init: () => { localStorage.setItem('money-tracker-v2', JSON.stringify({ budget: 2500, entries: [{ id: 'x', date: new Date().toISOString().slice(0, 10), amount: 20, cat: 'Fun', note: 'legacy' }, { id: 'y', date: new Date().toISOString().slice(0, 10), amount: 15.99, cat: 'Fun', note: 'Netflix' }, { id: 'z', type: 'expense', date: new Date().toISOString().slice(0, 10), amount: 31, cat: 'Dining', note: 'DoorDash' }] })); } }, async (page) => {
    assert.deepStrictEqual(await page.evaluate(() => App.state.entries.map(e => e.type)), ['expense', 'expense', 'expense']);
    assert.deepStrictEqual(await page.evaluate(() => App.state.entries.map(e => e.cat)), ['Recreation', 'Streaming', 'Food delivery'], 'old categories migrated');
    assert.strictEqual(await text(page, '#sum-expense'), '$66.99');
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
    await addEntry(page, { amount: 1, cat: 'Recreation' });
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
  await test('tiles, progress, odds and plain-language line agree with FinanceCore', O, async (page) => {
    await tab(page, 'retirement');
    await page.fill('#r-roth', '50000'); await page.fill('#r-savings', '10000'); await page.waitForTimeout(100);
    const d = await page.evaluate(() => { const d = App.retirementDerived(); return { calc: d.calc, odds: d.odds, inputs: d.inputs }; });
    assert.strictEqual(d.inputs.k401Type, 'roth');
    assert.strictEqual(d.calc.assets, await page.evaluate(() => App.state.k401Balance + 60000), 'Roth 401k counted in full');
    assert.strictEqual(await text(page, '#rt-networth'), await page.evaluate((nw) => FinanceCore.fmtMoney(nw, { compact: true, whole: true }), d.calc.netWorth));
    assert.strictEqual(await text(page, '#rt-progress'), (d.calc.progress < 0.1 ? (d.calc.progress * 100).toFixed(1) : Math.round(d.calc.progress * 100)) + '%');
    assert.strictEqual(await text(page, '#rt-age'), 'Age ' + Math.ceil(d.calc.ageAtTarget));
    const plain = await text(page, '#rt-plain');
    assert.ok(plain.includes('by age ' + Math.ceil(d.calc.ageAtTarget)), plain);
    assert.ok(Math.abs(parseFloat(await page.$eval('#rt-fill', el => el.style.width)) - Math.min(100, d.calc.progress * 100)) < 0.01, 'meter width');
    assert.ok(await page.$('#chart-proj svg'));
    assert.ok(await page.$('#chart-proj svg .band'), 'historical range band on the projection');
    const odds = await text(page, '#rt-odds');
    assert.ok(odds.includes('FXAIX') && odds.includes(Math.round(d.odds.probByTargetAge * 100) + '%'), odds);
    // the projection's return comes from fund history by default
    const real = await page.evaluate(() => Math.round(FinanceCore.realRate(Math.round(FinanceCore.seriesStats(FinanceCore.fundBasisSeries('FXAIX')).cagr * 10) / 10, 3) * 10) / 10);
    assert.strictEqual(d.inputs.returnRate, real);
    await page.click('details:has(#r-return) summary');
    assert.strictEqual(parseFloat(await page.inputValue('#r-return')), real);
    assert.ok(await page.isDisabled('#r-tax'), 'tax rate unused for a Roth 401k');
    assert.ok((await text(page, '#r-tax-help')).includes('Roth'));
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
    await page.fill('#r-return', '4'); await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => [App.state.retirement.returnRate, App.state.retirement.returnFromFund]), [4, false]);
    assert.ok(await page.isVisible('#r-return-reset'));
    await page.click('#r-assume-reset'); await page.waitForTimeout(50);
    assert.deepStrictEqual(await page.evaluate(() => { const r = App.state.retirement; return [r.withdrawalRate, r.returnFromFund, r.taxRate]; }), [4, true, 15]);
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
  await test('401k card: Roth/traditional switch, fund choice drives the forecast and projection, no history display', O, async (page) => {
    await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#r-k401type'), 'roth');
    assert.strictEqual(await page.inputValue('#k-fund'), 'FXAIX');
    assert.ok(!(await page.$('#chart-fund-hist')), 'annual-returns chart removed');
    assert.ok(!(await page.$('#k-facts')), 'history stats removed');
    assert.ok(await page.$('#chart-fund-forecast svg .band'), 'forecast range band');
    assert.ok((await text(page, '#k-summary')).includes('Roth · FXAIX'));
    const fx = parseFloat(await page.inputValue('#k-return'));
    assert.strictEqual(fx, await page.evaluate(() => Math.round(FinanceCore.seriesStats(FinanceCore.fundBasisSeries('FXAIX')).cagr * 10) / 10));
    const nwRoth = await page.evaluate(() => App.retirementDerived().calc.netWorth);
    await page.selectOption('#r-k401type', 'traditional'); await page.waitForTimeout(100);
    const nwTrad = await page.evaluate(() => App.retirementDerived().calc.netWorth);
    assert.strictEqual(Math.round(nwRoth - nwTrad), Math.round(await page.evaluate(() => App.state.k401Balance * 0.15)), 'traditional loses 15% to tax');
    assert.strictEqual(await page.evaluate(() => App.state.paycheck.k401Type), 'traditional', 'same setting as Pay setup');
    assert.ok(!(await page.isDisabled('#r-tax')));
    await page.selectOption('#r-k401type', 'roth'); await page.waitForTimeout(80);
    const realFx = await page.evaluate(() => App.retirementDerived().inputs.returnRate);
    await page.selectOption('#k-fund', 'LFIKX'); await page.waitForTimeout(150);
    assert.ok(parseFloat(await page.inputValue('#k-return')) < fx, 'LFIKX long-run estimate is lower');
    assert.ok(await page.evaluate(() => App.retirementDerived().inputs.returnRate) < realFx, 'projection follows the fund');
    assert.ok((await text(page, '#rt-odds')).includes('LFIKX'));
    assert.ok((await text(page, '#k-forecast-line')).includes('LFIKX'));
    await page.fill('#k-return', '5'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.k401ReturnOverride), 5);
    await page.click('#k-return-reset'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.k401ReturnOverride), null);
    await page.selectOption('#k-fund', 'custom'); await page.waitForTimeout(80);
    assert.strictEqual(await page.inputValue('#k-return'), '7');
    assert.ok((await text(page, '#rt-odds')).includes('Pick FXAIX or LFIKX'));
    await page.reload(); await page.waitForTimeout(100); await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#k-fund'), 'custom', 'fund choice persisted');
  });
  await test('Roth 401k on the paycheck comes out after tax', O, async (page) => {
    await tab(page, 'recurring');
    assert.strictEqual(await page.inputValue('#p-k401type'), 'roth');
    const lines = await text(page, '#pay-lines');
    assert.ok(lines.includes('After-tax deductions') && lines.includes('Roth 401k (6%)'), lines);
    assert.ok(!lines.includes('Pre-tax deductions'), 'nothing pre-tax in the seed');
    const roth = await page.evaluate(() => FinanceCore.paycheckBreakdown(App.state.paycheck));
    assert.strictEqual(roth.taxableWages, 6000);
    await page.selectOption('#p-k401type', 'traditional'); await page.waitForTimeout(80);
    const trad = await page.evaluate(() => FinanceCore.paycheckBreakdown(App.state.paycheck));
    assert.strictEqual(trad.taxableWages, 5640); assert.ok(trad.net > roth.net);
    assert.ok((await text(page, '#pay-lines')).includes('Pre-tax deductions'));
  });

  console.log('recurring & paycheck');
  await test('Repeat on the Add form creates a rule and logs the entry; the rule shows on Recurring and Overview', O, async (page) => {
    await tab(page, 'add');
    await page.fill('#f-amount', '15.99'); await page.click('#cat-chips button:has-text("Streaming")'); await page.fill('#f-note', 'Netflix');
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
    assert.ok(await page.$('#entries .entry .rep'), 'recurring marker shown');
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
    const due = await page.evaluate(() => FinanceCore.addDays(App.today(), 5)); await page.fill('#u-start', due); await page.selectOption('#u-cat', 'Streaming'); await page.click('#u-save'); await page.waitForTimeout(100);
    const sp = await page.evaluate(() => App.state.recurring.find(r => r.name === 'Spotify')); assert.deepStrictEqual([sp.amount, sp.cat, sp.nextDate, sp.startDate], [10.99, 'Streaming', due, due]);
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


  // A stand-in for the Claude viewer runtime: an in-memory db shaped like the real one.
  const fakeRuntime = (seed) => {
    const store = new Map(Object.entries(seed || {}));
    window.__cloud = store; window.__cloudWrites = 0;
    const listeners = [];
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const snapOf = (path) => { const d = store.get(path); return { id: path.split('/').pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
    const notify = (path) => listeners.filter((l) => l.path === path).forEach((l) => setTimeout(() => l.fn(snapOf(path)), 0));
    const docRef = (path) => ({ id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (data) => { window.__cloudWrites++; store.set(path, clone(data)); notify(path); },
      update: async (data) => { store.set(path, Object.assign(clone(store.get(path) || {}), clone(data))); notify(path); },
      delete: async () => { store.delete(path); notify(path); },
      onSnapshot: (fn) => { listeners.push({ path, fn }); setTimeout(() => fn(snapOf(path)), 0); return () => {}; },
      collection: (sub) => colRef(path + '/' + sub) });
    const colRef = (path) => ({ path, doc: (id) => docRef(path + '/' + id),
      get: async () => { const depth = path.split('/').length + 1; const docs = [...store.keys()].filter((k) => k.startsWith(path + '/') && k.split('/').length === depth).sort().map(snapOf); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; } });
    const db = { doc: docRef, collection: colRef };
    const user = { id: async () => 'u_test', isOwner: async () => true, canEdit: async () => true, can: async () => true, me: async () => ({ id: 'u_test' }) };
    window.__setRemote = (path, data) => { store.set(path, data); notify(path); };
    window.claude = { use: (name) => new Promise((r) => setTimeout(() => r(name === 'db' ? db : name === 'user' ? user : null), 30)) };
  };
  const dumpCloud = (page) => page.evaluate(() => Object.fromEntries(window.__cloud));
  const ROOT = 'data/users/u_test/state';



  console.log('tips & defaults');
  await test('Tips card shows the top three, expands to all, and each action opens the right screen', O, async (page) => {
    assert.ok(await page.isVisible('#tips-card'));
    const all = await page.evaluate(() => FinanceCore.insights({ state: App.state, today: App.today() }));
    assert.ok(all.length > 3);
    assert.strictEqual(await page.$$eval('#tips .tip', els => els.length), 3);
    assert.strictEqual(await text(page, '#tips .tip .tt span'), all[0].title);
    await page.click('#tips-more'); await page.waitForTimeout(50);
    assert.strictEqual(await page.$$eval('#tips .tip', els => els.length), all.length);
    assert.strictEqual(await page.getAttribute('#tips-more', 'aria-expanded'), 'true');
    const withSave = all.find(t => t.yearly);
    assert.ok((await text(page, '#tips')).includes('+' + FinanceCore_fmt(withSave.yearly).replace(/\.\d\d$/, '') + '/yr'));
    const debtTip = page.locator('#tips .tip:has-text("Credit card") .ta');
    await debtTip.click(); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.ui.view), 'retirement');
  });
  await test('Accounts card: every balance in one place, editable, with net worth', O, async (page) => {
    await page.fill('#ab-roth', '5000'); await page.fill('#ab-stock', '30000'); await page.fill('#ab-cash', '2000');
    assert.strictEqual(await text(page, '#acct-inv'), await page.evaluate(() => FinanceCore.fmtMoney(App.state.k401Balance + 35000)), 'investment total updates as you type');
    await page.click('#k401-save'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#toast-msg'), 'Saved 3 balances');
    const st = await page.evaluate(() => [App.state.rothBalance, App.state.stockBalance, App.state.savingsBalance, App.state.balanceDates.stockBalance === App.today()]);
    assert.deepStrictEqual(st, [5000, 30000, 2000, true]);
    const nw = await page.evaluate(() => FinanceCore.round2(App.state.k401Balance + 5000 + 30000 + 2000 - FinanceCore.totalDebt(App.state.debts)));
    assert.strictEqual(await text(page, '#acct-networth'), FinanceCore_fmt(nw).replace(/\.\d\d$/, ''));
    assert.ok((await text(page, '#d-ab-stock')).includes('as of Today'));
    assert.ok((await text(page, '#acct-debts')).includes('Car loan'));
    await page.click('#toast-action'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.stockBalance), 0, 'undo');
    await tab(page, 'retirement');
    assert.ok(await page.$('#r-stock') && await page.$('#r-hsa') && await page.$('#r-brokerage'));
    await page.fill('#r-stock', '12000'); await page.waitForTimeout(80);
    const d = await page.evaluate(() => App.retirementDerived().calc.assets);
    assert.strictEqual(d, await page.evaluate(() => App.state.k401Balance + 12000), 'company stock counts toward retirement assets');
  });
  await test('HSA contributions from pay count as monthly savings in the projection', O, async (page) => {
    const before = await page.evaluate(() => App.retirementDerived().defContrib);
    await page.evaluate(() => { App.state.paycheck.hsa = 400; App.state.paycheck.frequency = 'monthly'; App.commit(); });
    const after = await page.evaluate(() => App.retirementDerived().defContrib);
    assert.strictEqual(Math.round((after - before) * 100), 40000);
    await tab(page, 'retirement');
    assert.ok((await text(page, '#r-contrib-help')).includes('+ $400 HSA'));
  });
  await test('current age defaults to 33', O, async (page) => {
    await tab(page, 'retirement');
    assert.strictEqual(await page.inputValue('#r-age'), '33');
    assert.strictEqual(await text(page, '#ret-years'), '32 years to go');
  });

  console.log('categories & recurring history');
  await test('new categories are on the Add form and the seed bills use them', O, async (page) => {
    await tab(page, 'add');
    const chips = await page.$$eval('#cat-chips button', bs => bs.map(b => b.textContent.trim().replace(/^\S+\s/, '')));
    for (const c of ['Groceries', 'Dining', 'Food delivery', 'Streaming', 'Gaming', 'Recreation', 'Utilities', 'Insurance', 'Debt payments']) assert.ok(chips.includes(c), c + ' in ' + chips.join(','));
    assert.deepStrictEqual(await page.evaluate(() => App.state.recurring.map(r => r.name + ':' + r.cat)), ['Internet:Utilities', 'Power:Utilities', 'Water:Utilities', 'Car insurance:Insurance', 'Rent:Housing', 'Car loan payment:Debt payments', 'Credit card payment:Debt payments', 'YouTube Premium Lite:Streaming', 'YouTube TV:Streaming', 'Twitch Turbo:Streaming']);
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.cat === 'Food delivery') && App.state.entries.some(e => e.cat === 'Streaming')));
    await tab(page, 'charts');
    assert.ok((await text(page, '#chart-cats')).includes('Streaming'));
  });
  await test('a recurring item with a past start date fills in its history, previewed first, with undo', O, async (page) => {
    await page.evaluate(() => { App.state.entries = App.state.entries.filter(e => !e.sample); App.state.recurring = []; App.commit(); });
    await tab(page, 'recurring');
    await page.click('#u-add');
    await page.fill('#u-name', 'Old car loan'); await page.fill('#u-amount', '300'); await page.selectOption('#u-cat', 'Debt payments');
    const start = await page.evaluate(() => FinanceCore.addMonths(App.today().slice(0, 7), -24) + '-05');
    await page.fill('#u-start', start); await page.waitForTimeout(50);
    const expected = await page.evaluate((st) => FinanceCore.occurrences({ startDate: st, frequency: 'monthly', anchorDay: 5 }, App.today()).length, start);
    const preview = await text(page, '#u-preview');
    assert.ok(preview.includes('logs ' + expected + ' past payments'), preview);
    await page.click('#u-save'); await page.waitForTimeout(100);
    const logged = await page.evaluate(() => App.state.entries.filter(e => e.note === 'Old car loan'));
    assert.strictEqual(logged.length, expected);
    assert.ok(logged.every(e => e.cat === 'Debt payments' && e.amount === 300 && e.recurring));
    assert.strictEqual(logged.map(e => e.date).sort()[0], start);
    assert.ok((await text(page, '#toast-msg')).includes('logs ' + expected));
    assert.ok((await text(page, '#rule-list')).includes('since'));
    // undo removes the whole backfill
    await page.click('#toast-action'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.entries.filter(e => e.note === 'Old car loan').length), 0);
    assert.strictEqual(await page.evaluate(() => App.state.recurring.length), 0);
  });
  await test('editing start and end dates adds or removes history without duplicates; ended items stop counting', O, async (page) => {
    await page.evaluate(() => { App.state.entries = App.state.entries.filter(e => !e.sample); App.state.recurring = []; App.commit(); });
    await tab(page, 'recurring');
    const t = await page.evaluate(() => App.today());
    const m = (n) => page.evaluate(([t, n]) => FinanceCore.addMonths(t.slice(0, 7), n) + '-10', [t, n]);
    await page.click('#u-add'); await page.fill('#u-name', 'Gym'); await page.fill('#u-amount', '40'); await page.selectOption('#u-cat', 'Recreation');
    await page.fill('#u-start', await m(-3)); await page.click('#u-save'); await page.waitForTimeout(80);
    const count = () => page.evaluate(() => App.state.entries.filter(e => e.note === 'Gym').length);
    const n1 = await count();
    await page.click('.rule-row:has-text("Gym") button:has-text("Edit")'); await page.fill('#u-start', await m(-6)); await page.click('#u-save'); await page.waitForTimeout(80);
    assert.strictEqual(await count(), n1 + 3, 'three earlier months filled in, none doubled');
    await page.click('.rule-row:has-text("Gym") button:has-text("Edit")'); await page.fill('#u-start', await m(-2)); await page.click('#u-save'); await page.waitForTimeout(80);
    assert.strictEqual(await count(), n1 - 1, 'months before the new start removed');
    await page.click('.rule-row:has-text("Gym") button:has-text("Edit")'); await page.fill('#u-end', await m(-2)); await page.waitForTimeout(30);
    assert.ok((await text(page, '#u-preview')).includes('removes 1'), await text(page, '#u-preview'));
    await page.click('#u-save'); await page.waitForTimeout(80);
    assert.ok((await text(page, '.rule-row:has-text("Gym")')).includes('ended'));
    assert.strictEqual(await text(page, '#rec-total'), '', 'ended item is out of the monthly total');
    assert.ok(!(await text(page, '#upcoming')).includes('Gym'));
    await page.click('.rule-row:has-text("Gym") button:has-text("Edit")'); await page.fill('#u-end', await m(-3)); await page.waitForTimeout(30);
    await page.click('#u-save'); await page.waitForTimeout(30);
    assert.ok(await page.isVisible('#u-error'), 'end before start is rejected');
  });



  await test('phone data saved before this update gets the TV bill swapped for the streaming subscriptions', { browser, init: () => {
      if (localStorage.getItem('money-tracker-v2')) return;
      const t = new Date(); const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const m = (n) => iso(new Date(t.getFullYear(), t.getMonth() + n, 1));
      localStorage.setItem('money-tracker-v2', JSON.stringify({ schema: 3, entries: [{ id: 'tv1', type: 'expense', date: m(-1), amount: 90, cat: 'Streaming', note: 'TV', recurring: 'rule-1', sample: true }, { id: 'keep', type: 'expense', date: m(0), amount: 25, cat: 'Dining', note: 'Lunch' }],
        recurring: [{ id: 'rule-1', name: 'TV', type: 'expense', cat: 'Streaming', amount: 90, frequency: 'monthly', startDate: m(-1), nextDate: m(1), anchorDay: 1 }] }));
    } }, async (page) => {
    const names = await page.evaluate(() => App.state.recurring.map(r => r.name));
    assert.deepStrictEqual(names, ['YouTube Premium Lite', 'YouTube TV', 'Twitch Turbo']);
    assert.ok(!(await page.evaluate(() => App.state.entries.some(e => e.note === 'TV'))));
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.id === 'keep')), 'your own entries are kept');
    assert.strictEqual(await page.evaluate(() => App.state.entries.filter(e => e.note === 'YouTube Premium Lite').length), 24);
    await tab(page, 'recurring');
    const yttv = await text(page, '.rule-row:has-text("YouTube TV")');
    assert.ok(yttv.includes('ends Mar 2027'), yttv);
  });

  console.log('tags');
  await test('tags: suggested from category and note, custom tags, saved, editable, shown on the entry', O, async (page) => {
    await tab(page, 'add');
    await page.click('#cat-chips button:has-text("Food delivery")');
    await page.fill('#f-amount', '28.40'); await page.fill('#f-note', 'DoorDash');
    const pressed = () => page.$$eval('#tag-chips button[aria-pressed="true"]', bs => bs.map(b => b.textContent));
    assert.deepStrictEqual(await pressed(), ['#food', '#doordash']);
    await page.fill('#f-newtag', 'Date Night'); await page.press('#f-newtag', 'Enter');
    assert.deepStrictEqual((await pressed()).sort(), ['#date night', '#doordash', '#food']);
    await page.click('#tag-chips button:has-text("#doordash")'); // turn one off by hand
    await page.fill('#f-note', 'DoorDash Friday'); // a touched picker is not overwritten by suggestions
    assert.deepStrictEqual((await pressed()).sort(), ['#date night', '#food']);
    await page.click('#f-submit'); await page.waitForTimeout(80);
    const e = await page.evaluate(() => App.state.entries[App.state.entries.length - 1]);
    assert.deepStrictEqual([e.cat, e.tags], ['Food delivery', ['food', 'date night']]);
    assert.ok(!(await pressed()).includes('#date night'), 'picker resets for the next entry');
    await tab(page, 'overview');
    const row = page.locator('.entry:has-text("DoorDash Friday")');
    assert.ok((await row.textContent()).includes('#date night'));
    await row.locator('.body').click(); await page.waitForTimeout(60);
    assert.deepStrictEqual((await pressed()).sort(), ['#date night', '#food']);
    await page.click('#tag-chips button:has-text("#date night")'); await page.click('#f-save'); await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => App.state.entries.find(x => x.note === 'DoorDash Friday').tags), ['food']);
  });
  await test('Spending by tag on Overview and Charts, with a tag filter that narrows totals', O, async (page) => {
    await addEntry(page, { amount: '50', cat: 'Gaming', note: 'Steam' });
    await tab(page, 'overview');
    assert.ok(await page.isVisible('#tag-card'));
    assert.ok((await text(page, '#tag-breakdown')).includes('#gaming'));
    await tab(page, 'charts');
    assert.ok((await text(page, '#chart-tags')).includes('#gaming'));
    const all = await text(page, '#rt-expense');
    await page.click('#tag-filter-details summary');
    await page.click('#tag-filter button:has-text("#gaming")'); await page.waitForTimeout(80);
    const gaming = await page.evaluate(() => { const r = FinanceCore.rangeForPreset('last6', App.today(), App.state.entries); return FinanceCore.fmtMoney(FinanceCore.totals(FinanceCore.entriesInRange(App.state.entries, r.from, r.to).filter(e => e.type !== 'expense' || (e.tags || []).includes('gaming'))).expense); });
    assert.strictEqual(await text(page, '#rt-expense'), gaming);
    assert.notStrictEqual(gaming, all);
    assert.ok((await text(page, '#range-totals')).includes('Spending (filtered)'));
    await page.click('#tag-filter button:has-text("Any")'); await page.waitForTimeout(80);
    assert.strictEqual(await text(page, '#rt-expense'), all);
  });
  await test('recurring tags apply to past payments; removing a tag in Settings strips it everywhere, with undo', O, async (page) => {
    await tab(page, 'recurring');
    await page.click('.rule-row:has-text("Internet") button:has-text("Edit")');
    await page.fill('#u-newtag', 'wifi'); await page.click('#u-addtag');
    await page.click('#u-save'); await page.waitForTimeout(100);
    const internet = await page.evaluate(() => App.state.entries.filter(e => e.recurring === 'rule-2').map(e => (e.tags || []).join()));
    assert.ok(internet.length >= 5 && internet.every(t => t === 'wifi'), JSON.stringify(internet));
    assert.ok((await text(page, '.rule-row:has-text("Internet")')).includes('#wifi'));
    await page.click('#btn-settings');
    await page.click('#tag-manage button:has-text("#wifi")'); await page.waitForTimeout(50);
    assert.ok((await text(page, '#confirm-desc')).includes('entries and bills'));
    await page.click('#confirm-ok'); await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => App.state.entries.filter(e => (e.tags || []).includes('wifi')).length), 0);
    assert.deepStrictEqual(await page.evaluate(() => App.state.recurring.find(r => r.id === 'rule-2').tags), []);
    await page.click('#settings-close');
    await page.click('#toast-action'); await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => App.state.entries.filter(e => (e.tags || []).includes('wifi')).length) >= 5, 'undo restores');
  });
  await test('CSV includes a tags column', { browser, init: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } }); } }, async (page) => {
    await page.click('#btn-csv'); await page.waitForTimeout(80);
    const csv = await page.evaluate(() => window.__copied);
    assert.ok(csv.startsWith('date,type,category,amount,note,tags\n'));
    assert.ok(/,expense,Streaming,-60\.00,YouTube TV,streaming;subscription/.test(csv), csv.slice(0, 600));
  });


  console.log('adding transactions');
  const txFile = (today) => ({ app: 'money-tracker', kind: 'transactions', clearSamples: true,
    entries: [
      { importId: 'x1', type: 'expense', date: today.slice(0, 8) + '01', amount: 1500, cat: 'Housing', note: 'Rent (Example Co)', recurring: 'rule-6' },
      { importId: 'x2', type: 'expense', date: today.slice(0, 8) + '02', amount: 25.5, cat: 'Food delivery', note: 'DoorDash · Example', tags: ['food', 'doordash'] },
      { importId: 'x3', type: 'expense', date: today.slice(0, 8) + '02', amount: 9, cat: 'Recreation', note: 'Movie' },
      { importId: 'x4', type: 'expense', date: today.slice(0, 8) + '02', amount: 9, cat: 'Recreation', note: 'Movie' }],
    updates: { recurring: [{ id: 'rule-6', name: 'Rent (Example Co)', amount: 1500, startDate: today.slice(0, 8) + '01' }], debts: [{ id: 'debt-car', balance: 15000 }], balances: { savingsBalance: 2500 } } });
  await test('Add transactions previews, merges without replacing, and can be undone', O, async (page) => {
    const t0 = await page.evaluate(() => App.today());
    await addEntry(page, { amount: 7, cat: 'Recreation', note: 'MineKeep' });
    const before = await page.evaluate(() => App.state.entries.length);
    await page.click('#btn-settings');
    await page.setInputFiles('#merge-file', { name: 'tx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(txFile(t0))) });
    await page.waitForTimeout(100);
    const desc = await text(page, '#confirm-desc');
    assert.ok(desc.includes('Adds 4 transactions') && desc.includes('sample entries') && desc.includes('Updates 1 bill') && desc.includes('cash balance'), desc);
    await page.click('#confirm-cancel'); await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), before, 'cancel changes nothing');
    await page.setInputFiles('#merge-file', { name: 'tx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(txFile(t0))) });
    await page.waitForTimeout(100); await page.click('#confirm-ok'); await page.waitForTimeout(120);
    const st = await page.evaluate(() => ({ samples: App.state.entries.filter(e => e.sample).length, mine: App.state.entries.some(e => e.note === 'MineKeep'), movies: App.state.entries.filter(e => e.note === 'Movie').length, rent: App.state.recurring.find(r => r.id === 'rule-6'), rentPaid: App.state.entries.filter(e => e.recurring === 'rule-6').length, car: App.state.debts.find(d => d.id === 'debt-car').balance, cash: App.state.savingsBalance }));
    assert.strictEqual(st.samples, 0); assert.ok(st.mine, 'your own entry kept'); assert.strictEqual(st.movies, 2, 'two identical purchases both kept');
    assert.deepStrictEqual([st.rent.name, st.rent.amount, st.rentPaid], ['Rent (Example Co)', 1500, 1]);
    assert.strictEqual(st.car, 15000); assert.strictEqual(st.cash, 2500);
    assert.ok(await page.isHidden('#settings-dialog'));
    assert.ok((await text(page, '#toast-msg')).startsWith('Added 4 transactions'));
    await page.click('#toast-action'); await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => App.state.entries.some(e => e.sample)), 'undo brings everything back');
  });
  await test('a file with only balances previews and applies', O, async (page) => {
    const f = { kind: 'transactions', entries: [], updates: { balances: { k401Balance: 99000, rothBalance: 4000, otherInvestments: 12000 } } };
    await page.click('#btn-settings');
    await page.setInputFiles('#merge-file', { name: 'bal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(f)) });
    await page.waitForTimeout(100);
    assert.strictEqual(await text(page, '#confirm-desc'), 'Updates your 401k, Roth IRA and other investments balances.');
    await page.click('#confirm-ok'); await page.waitForTimeout(100);
    assert.deepStrictEqual(await page.evaluate(() => [App.state.k401Balance, App.state.rothBalance, App.state.otherInvestments, App.state.k401UpdatedAt === App.today()]), [99000, 4000, 12000, true]);
    assert.strictEqual(await text(page, '#toast-msg'), 'Updated your balances');
  });
  await test('Import backup routes a transactions file to the merge instead of replacing everything', O, async (page) => {
    const t0 = await page.evaluate(() => App.today());
    const n = await page.evaluate(() => App.state.entries.filter(e => !e.sample).length);
    await page.click('#btn-settings');
    await page.setInputFiles('#import-file', { name: 'tx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(txFile(t0))) });
    await page.waitForTimeout(100);
    assert.strictEqual(await text(page, '#confirm-h'), 'Add these transactions?');
    await page.click('#confirm-ok'); await page.waitForTimeout(120);
    assert.ok(await page.evaluate(() => App.state.debts.length) >= 2, 'debts were kept, not replaced');
    assert.ok(await page.evaluate((n) => App.state.entries.filter(e => !e.sample).length >= n + 4, n));
    await page.click('#btn-settings');
    await page.setInputFiles('#merge-file', { name: 'tx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(txFile(t0))) });
    await page.waitForTimeout(100);
    assert.ok((await text(page, '#toast-msg')).includes('already here'), 'adding the same file twice changes nothing');
    await page.setInputFiles('#merge-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ budget: 1, entries: [] })) });
    await page.waitForTimeout(100);
    assert.ok((await text(page, '#toast-msg')).includes('isn’t a transactions file'));
  });

  console.log('account sync');
  let cloudAfterA = null;
  await test('first device with an empty account uploads its data, then syncs each change', { browser, init: fakeRuntime, initArg: {} }, async (page) => {
    await page.waitForTimeout(1500);
    let cloud = await dumpCloud(page);
    assert.ok(cloud[ROOT], 'settings document written');
    assert.strictEqual(cloud[ROOT].state.k401Balance, 125000);
    assert.strictEqual(cloud[ROOT].state.paycheck.k401Type, 'roth');
    const monthKeys = Object.keys(cloud).filter((k) => k.startsWith(ROOT + '/months/'));
    const total = monthKeys.reduce((n, k) => n + cloud[k].entries.length, 0);
    assert.strictEqual(total, await page.evaluate(() => App.state.entries.length), 'every entry uploaded');
    assert.deepStrictEqual(cloud[ROOT].months, monthKeys.map((k) => k.split('/').pop()).sort());
    assert.strictEqual(await text(page, '#sync-chip'), 'Synced');
    await addEntry(page, { amount: '42.42', cat: 'Recreation', note: 'SyncMe' });
    await page.waitForTimeout(1800);
    cloud = await dumpCloud(page);
    const mk = await page.evaluate(() => App.today().slice(0, 7));
    assert.ok(cloud[ROOT + '/months/' + mk].entries.some((e) => e.note === 'SyncMe' && e.amount === 42.42), 'new entry reached the account');
    const writes = await page.evaluate(() => window.__cloudWrites);
    assert.ok(writes <= monthKeys.length + 4, 'only changed months rewritten (' + writes + ' writes)');
    cloudAfterA = cloud;
  });
  await test('a fresh device adopts the account data exactly', { browser, init: fakeRuntime, initArg: cloudAfterA }, async (page) => {
    await page.waitForTimeout(800);
    const notes = await page.evaluate(() => App.state.entries.filter((e) => e.note === 'SyncMe').length);
    assert.strictEqual(notes, 1, 'history from the other device is here');
    const cloudTotal = Object.keys(cloudAfterA).filter((k) => k.startsWith(ROOT + '/months/')).reduce((n, k) => n + cloudAfterA[k].entries.length, 0);
    assert.strictEqual(await page.evaluate(() => App.state.entries.length), cloudTotal, 'no duplicates, nothing lost');
    assert.strictEqual(await text(page, '#sync-chip'), 'Synced');
    await page.click('#btn-settings');
    assert.ok((await text(page, '#sync-status')).includes('Saved to your Claude account'));
    await page.click('#settings-close');
    // a change made on the other device arrives live
    const remote = JSON.parse(JSON.stringify(cloudAfterA[ROOT])); remote.state.k401Balance = 130000; remote.updatedAt = Date.now() + 1000; remote.writer = 'other-device';
    await page.evaluate(([path, data]) => window.__setRemote(path, data), [ROOT, remote]);
    await page.waitForTimeout(400);
    assert.strictEqual(await page.evaluate(() => App.state.k401Balance), 130000);
    assert.ok((await text(page, '#toast-msg')).includes('another device'));
  });
  await test('without the Claude runtime the app stays local and shows no sync chip', O, async (page) => {
    assert.ok(await page.isHidden('#sync-chip'));
    assert.strictEqual(await page.evaluate(() => App.cloudActive), false);
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

# Money — personal finance tracker

A single self-contained HTML file (`index.html`): inline CSS and JS, no build
step, no dependencies, no server. Open it in a browser or host it on GitHub
Pages. Everything you enter stays in that browser's `localStorage`; use
**Settings → Export** to back it up or move it to another device.

## What it does

- **Overview** — month view with prev/next, income / spending / 401k / net and
  savings rate, an editable monthly budget with a progress bar (orange at 85%,
  red when over), spending by category, entries grouped by day, two-tap
  delete, "Copy month as CSV".
- **Add** — one form for spending, income and 401k contributions. Tap any entry
  on Overview to edit it in the same form.
- **Categories and tags** — each entry has one category (Groceries, Dining,
  Food delivery, Housing, Utilities, Streaming, Transport, Gaming, Recreation,
  Shopping, Health, Insurance, Debt payments, Other), so the budget breakdown
  adds up to 100%. On top of that it can carry up to 8 tags of your own, like
  `#doordash`, `#food`, `#streaming` or `#date night`. Tags are suggested from
  the category and the note as you type (DoorDash, Netflix, Steam…), can
  overlap, get their own "Spending by tag" totals and chart filter, and can be
  removed everywhere from Settings. Older data is moved into the new categories
  and given starter tags once, on first load.
- **Tips** — on Overview, suggestions worked out from your own numbers and
  ranked by what they're worth: a payment that doesn't cover a debt's
  interest, an emergency fund, going over budget this month, investing your
  monthly surplus (with the usual order: 401k match, debt over ~8%, emergency
  fund, Roth IRA at the 2026 $7,500 limit, more 401k), paying extra on
  high-interest debt, the full 401k match, food delivery, stacked streaming
  subscriptions, your biggest flexible category, and a category running hot
  this month. Each shows the yearly saving where there is one and links to the
  screen to act on it.
- **Recurring** — a paycheck model and a list of bills & subscriptions.
  - **Paycheck**: enter gross pay, pay frequency, next pay date, 401k %,
    employer match, health/HSA and other deductions straight off a pay stub.
    Federal withholding is estimated from the 2026 IRS brackets and standard
    deduction, with Social Security (6.2% to the wage base), Medicare (1.45%
    plus the 0.9% surtax) and a flat state rate, or switch to "Type from pay
    stub" and enter the exact tax lines. Shows take-home per check and per
    month, and logs a paycheck as net income plus the employee and employer
    401k entries, automatically on each pay day if you like.
  - **Bills & subscriptions**: recurring expenses or income (Netflix, rent,
    a car loan payment) with a frequency, a start date, an optional end date
    and tags. A start date in the past fills in every payment since then (the
    form previews how many before you save), an end date stops it, and
    changing either adds or removes history without doubling anything up.
    Due items are logged automatically when the app opens, with an undo, and
    the next 30 days are listed. The Add form's "Repeat" option creates one in
    a single step.
- **Charts** — date range presets or a custom range, applied to every chart and
  the totals beside them: income vs. spending (weekly or monthly bars with a
  net line), spending by category, savings rate by month, cumulative 401k
  contributions with your latest balance marked. Optional category filter,
  hover/keyboard tooltips and a table view for each chart.
- **Retirement** — enter your current age and target retirement age at the top;
  see the target number (annual spending ÷ withdrawal rate), net worth,
  progress, projected retirement age, a projection chart, a debt list with
  payoff dates and interest remaining, and the extra monthly contribution needed
  to hit your target age. Defaults come from your tracker averages and can be
  overridden.
  - **Debts** carry an interest option: compounds monthly (loans), compounds
    daily (credit cards), simple interest on the original balance, or no
    interest (0% promo).
  - **401k & forecast** — choose Roth or traditional, and the fund it's in:
    FXAIX (Fidelity 500 Index), LFIKX (MFS Lifetime 2055 R6) or a custom rate.
    The file stores the S&P 500's annual total returns for 1928–2025 and each
    fund's calendar-year returns, and uses them (rather than displaying them)
    to set the projection's default return and to replay history: the
    retirement projection shows a weak-to-strong-markets band and the share of
    400 replays that reach your target by your target age, and the 401k card
    forecasts the balance itself with a 10th–90th percentile range.
  - **Roth vs traditional**: a Roth 401k comes out of pay after tax and is
    counted in full at retirement; a traditional one comes out before tax and
    is reduced by the withdrawal tax rate.

The design is deliberately plain: flat cards, sentence-case labels, dark by
default with a light theme in Settings, and a validated colour-blind-safe chart
palette in both themes. Current age defaults to 33.

Sample entries are seeded on first run (flagged `sample: true`) and can be
cleared with one tap. The sample bills include three streaming subscriptions:
YouTube Premium Lite ($12/month for the past two years), YouTube TV
($60/month for the past three months, ending March 2027) and Twitch Turbo
($13/month). Data saved before they were added has its old $90 "TV" sample
bill swapped for them once.

## Adding transactions from your bank

**Settings → Add transactions** merges a transactions file into your data
instead of replacing it. It shows what will change first, and Undo puts
everything back. Entries already in the app are skipped one-for-one, so adding
the same file twice changes nothing, while identical purchases in one file all
stay. A transactions file can also update bills (their amounts and start dates;
payments due since then are filled in), debts, the pay setup and balances, and
can clear the sample entries. Picking one under **Import backup** routes it here
too, so it can never wipe your data.

File shape (`kind: "transactions"`):

```json
{ "kind": "transactions", "clearSamples": true,
  "entries": [{ "importId": "bank-123", "type": "expense", "date": "2026-10-13", "amount": 31.0,
                "cat": "Food delivery", "note": "DoorDash", "tags": ["food", "doordash"], "recurring": "rule-id?" }],
  "updates": { "recurring": [{ "id": "rule-6", "amount": 1700, "startDate": "2026-10-01" }],
               "debts": [{ "id": "debt-car", "balance": 18000 }], "paycheck": {}, "balances": { "savingsBalance": 3000 } } }
```

`updates` can also carry `removeEntries` (import ids) and `removeRecurring`
(bill ids, with their estimated entries) for things a newer file replaces. A
bill's real payments in a file replace the app's own estimates from the first
real payment on.

Credit cards whose purchases you import are treated as transfers: purchases and
interest are spending, payments are not. Mark such a card's debt "payments
aren't logged as spending" (`paidFromSurplus`); the projection then takes its
payment out of the monthly surplus until it's paid off, so nothing is counted
twice. Averages and tips use months with a paycheck logged, so months that only
hold card history don't read as months with no income; savings rates are only
shown for those months.

Transaction files made from real statements are personal; keep them out of
this repository.

## Where data is saved

- **On GitHub Pages or as a local file**: in that browser's `localStorage`
  only. Clearing site data, a private window, or another device starts fresh,
  so use Export/Import to move or back it up.
- **As a Claude artifact**: also in your Claude account, through the artifact
  `db` capability, under `data/users/<your id>/`, a folder that only you can
  read (not even the artifact's owner can see someone else's). Settings live in
  one document and entries in one document per month, so years of history fit.
  Open the artifact signed in on any device and your history is there; changes
  from another open device arrive live. On first open on a new device the
  account copy wins; after that the most recent save wins. The header shows
  Synced / Saving / Offline.

## Data format

State is stored under the `money-tracker-v2` key and exported as JSON:

```json
{
  "budget": 3000,
  "k401Balance": 0, "k401UpdatedAt": null,
  "rothBalance": 0, "savingsBalance": 0, "otherInvestments": 0,
  "debts": [{ "id": "…", "name": "Car loan", "balance": 9000, "rate": 6.5, "payment": 320, "compounding": "monthly" }],
  "k401Fund": "FXAIX", "k401ReturnOverride": null, "inflation": 3,
  "paycheck": { "gross": 3000, "frequency": "biweekly", "nextPayDate": "2026-11-13", "autoLog": true, "k401Pct": 6, "matchPct": 50, "matchCapPct": 6, "health": 100, "filingStatus": "single", "stateRate": 5, "taxMode": "auto" },
  "recurring": [{ "id": "…", "name": "Netflix", "type": "expense", "cat": "Streaming", "tags": ["streaming", "subscription"], "amount": 15.99, "frequency": "monthly", "startDate": "2025-03-07", "endDate": null, "nextDate": "2026-12-07", "anchorDay": 7, "active": true }],
  "retirement": { "age": 30, "targetAge": 65, "spendingOverride": null, "withdrawalRate": 4, "returnRate": 6, "taxRate": 15, "contributionOverride": null },
  "entries": [{ "id": "…", "type": "expense", "date": "2026-11-07", "amount": 12.5, "cat": "Dining", "note": "Tacos", "tags": ["food"] }],
  "schema": 3
}
```

Entries logged from a paycheck or a recurring item carry a `recurring` field
with the rule id. Entry `type` is `expense`, `income` or `k401`; entries with no `type` are
treated as `expense` on load. Imports are normalized and repaired, so a
hand-edited or older file still loads.

## How the numbers are computed

All money math lives in the `FinanceCore` script block at the top of the page
and is DOM-free so it can be unit-tested. Amounts are summed in integer cents.

- Savings rate = (income − spending + 401k) ÷ (income + 401k), where income is
  take-home pay.
- Target number = annual retirement spending ÷ withdrawal rate.
- Retirement assets = 401k × (1 − tax rate) + Roth IRA + savings + other.
- Net worth = assets − total debt. Progress = net worth ÷ target.
- Debt payoff is simulated month by month at the current payment using the
  debt's interest option (monthly APR ÷ 12, daily compounding converted to a
  monthly rate, simple interest on the original balance, or none); a payment
  that doesn't cover the interest is reported as "never".
- Paycheck: 401k = gross × % + fixed; match = min(401k, gross × cap) × match
  rate; taxable wages = gross − pre-tax deductions; federal = 2026 brackets on
  annualized taxable wages minus the standard deduction, divided by pay periods;
  FICA on wages after health/HSA; net = gross − pre-tax − taxes − after-tax.
  This mirrors the IRS percentage method with no W-4 adjustments, so it is an
  estimate; type the stub's exact lines for precision.
- Recurring: monthly rules keep their original day of month (a 31st falls on
  the 28th/30th in short months and returns to the 31st); every missed
  occurrence up to today is logged once, then the rule's next date advances.
- Historical odds: each of 400 runs draws one basis year per projection year,
  converts it to a real return with your inflation assumption, and applies it
  month by month to the same assets, contributions and debt payoffs as the
  main projection (fixed seed, so results are stable between renders).
- 401k forecast: the fund's long-run basis is its own calendar-year returns
  where recorded and, for earlier years, S&P 500 total return × beta −
  expense ratio (FXAIX: beta 1, 0.015%; LFIKX: beta 0.85, 0.40%). The
  expected path compounds monthly at the basis CAGR; the band resamples one
  basis year per forecast year with a fixed-seed generator so results are
  stable. Real return = (1 + nominal) ÷ (1 + inflation) − 1.

### Data sources

- S&P 500 total returns 1928–2025: Aswath Damodaran, NYU Stern,
  "Historical Returns on Stocks, Bonds and Bills" (updated January 2026).
- FXAIX calendar-year returns 2012–2025 and expense ratio: Yahoo Finance /
  Morningstar annual return history, Fidelity.
- LFIKX (class R6) calendar-year returns 2016–2025, expense ratios and
  allocation: mfs.com fund page and Q3 2026 fact sheet.
- The projection grows assets monthly at the real return rate, adds
  contributions, amortizes each debt, and moves a debt's payment into
  contributions once it is paid off. It runs until net worth reaches the
  target or 100 years pass.

These are rough estimates, not financial advice.

## Tests

```sh
npm test        # pure-function tests (Node only, no dependencies)
npm run test:ui # browser tests with Playwright/Chromium (npm i -D playwright)
```

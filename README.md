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
- **Charts** — date range presets or a custom range, applied to every chart and
  the totals beside them: income vs. spending (weekly or monthly bars with a
  net line), spending by category, savings rate by month, cumulative 401k
  contributions with your latest balance marked. Optional category filter,
  hover/keyboard tooltips and a table view for each chart.
- **Retirement** — target number (annual spending ÷ withdrawal rate), net worth,
  progress, projected retirement age, a projection chart, a debt list with
  payoff dates and interest remaining, and the extra monthly contribution needed
  to hit your target age. Defaults come from your tracker averages and can be
  overridden.

Sample entries are seeded on first run (flagged `sample: true`) and can be
cleared with one tap.

## Data format

State is stored under the `money-tracker-v2` key and exported as JSON:

```json
{
  "budget": 3000,
  "k401Balance": 0, "k401UpdatedAt": null,
  "rothBalance": 0, "savingsBalance": 0, "otherInvestments": 0,
  "debts": [{ "id": "…", "name": "Car loan", "balance": 9000, "rate": 6.5, "payment": 320 }],
  "retirement": { "age": 30, "targetAge": 65, "spendingOverride": null, "withdrawalRate": 4, "returnRate": 6, "taxRate": 15, "contributionOverride": null },
  "entries": [{ "id": "…", "type": "expense", "date": "2026-11-07", "amount": 12.5, "cat": "Dining", "note": "Tacos" }]
}
```

Entry `type` is `expense`, `income` or `k401`; entries with no `type` are
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
- Debt payoff is simulated month by month at the current payment; a payment
  that doesn't cover the interest is reported as "never".
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

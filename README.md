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
- **Retirement** — enter your current age and target retirement age at the top;
  see the target number (annual spending ÷ withdrawal rate), net worth,
  progress, projected retirement age, a projection chart, a debt list with
  payoff dates and interest remaining, and the extra monthly contribution needed
  to hit your target age. Defaults come from your tracker averages and can be
  overridden.
  - **Debts** carry an interest option: compounds monthly (loans), compounds
    daily (credit cards), simple interest on the original balance, or no
    interest (0% promo).
  - **401k fund & forecast** — pick FXAIX (Fidelity 500 Index) or LFIKX (MFS
    Lifetime 2055 R6), or a custom rate. The file stores the S&P 500's annual
    total returns for 1928–2025 and each fund's calendar-year returns, shows
    CAGR / best / worst / volatility / expense ratio, charts the returns on
    record, and forecasts your 401k balance to your target age: an expected
    path at the long-run return plus a 10th–90th percentile band from
    resampling the historical years 1,000 times. One tap applies the fund's
    real return (after your inflation assumption) to the retirement projection.

The design is a dark, glassy "HUD" look by default (light theme available in
Settings), with monospace figures and a validated colour-blind-safe chart
palette in both themes.

Sample entries are seeded on first run (flagged `sample: true`) and can be
cleared with one tap.

## Data format

State is stored under the `money-tracker-v2` key and exported as JSON:

```json
{
  "budget": 3000,
  "k401Balance": 0, "k401UpdatedAt": null,
  "rothBalance": 0, "savingsBalance": 0, "otherInvestments": 0,
  "debts": [{ "id": "…", "name": "Car loan", "balance": 9000, "rate": 6.5, "payment": 320, "compounding": "monthly" }],
  "k401Fund": "FXAIX", "k401ReturnOverride": null, "inflation": 3,
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
- Debt payoff is simulated month by month at the current payment using the
  debt's interest option (monthly APR ÷ 12, daily compounding converted to a
  monthly rate, simple interest on the original balance, or none); a payment
  that doesn't cover the interest is reported as "never".
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

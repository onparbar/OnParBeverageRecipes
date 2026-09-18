# Dashboard bug audit — September 17, 2026

The initial audit confirmed seven additional defects and fixed them locally. The two accounting/reporting findings below were subsequently fixed at the user's request. The local changes have **not been deployed**. The live walkthrough inspected the existing production version, not the new fixes.

## Follow-up fixes

- **Inventory undo:** preserve a signed accounting balance through a stored shortage amount while keeping the visible on-hand quantity at zero or above. Prep corrections, undo, receipt corrections, repeated saves, and storage round trips retain the amount that was previously lost by clamping. Physical counts clear the shortage and establish a new baseline. Saved operations surface a recount warning when movements exceed recorded stock. Old contributions lacking the new accounting evidence cannot receive an unverified credit: they require a newer physical count instead of guessing a historical shortage. No historical live balances were backfilled or repaired.
- **PMB-only history:** per the user's instruction, stop loading the two usage-history CSVs and remove their import code. Filter CSV-derived histories from shared loads, browser recovery, and local historical caches. The common usage validator excludes non-PMB readings from search, demand, trends, and profit inputs. PMB weekly periods must contain real Monday–Sunday dates; long, incomplete, reversed, and offset/overlapping ranges are excluded. Existing duplicate-week conflict checks remain. Older PMB captures with exact ounces but no source label remain supported; an explicit CSV/other source is excluded. Unrelated recipe, inventory setup, and approved changeover files remain in use.
- **Saved-report replay:** the previously audited revision 105 contains 5,722 history entries. The new policy excludes 2,641 non-PMB entries and retains all 3,081 PMB entries; none of those PMB date ranges failed validation. Latest-week usable coverage remains **102/102**. This was a read-only replay, not a production deletion.
- **Verification:** **1,151 tests passed**, zero-warning lint, production build, and whitespace checks passed. Added [inventory regressions](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/tests/inventory-shortfall-regressions.test.mjs) and [PMB-only regressions](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/tests/pmb-only-usage-regressions.test.mjs); extended durable recovery coverage. Original CSV files remain as unused source archives. No deployment or production-record mutation was performed.

## Original findings and reproductions — now addressed locally

### High: undoing prep after a shortage can create inventory

In-memory reproduction with the actual inventory reducer: initialize one bottle, apply a prep contribution of minus two bottles, then remove that contribution. The balance goes **1 → 0 → 2**, when undo should restore 1.

The reducer clamps the displayed balance to zero but records the full requested deduction. Undo adds that full deduction back. See [inventory adjustment](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/inventory-store.mjs:680). This was also reported in the September 13 audit and remains present. The reproduction did not modify production inventory and does not establish that a particular live balance was affected.

The fix must preserve reversible stock movements or shortage amounts across partial corrections, later deliveries, repeated saves, and physical recounts. Merely changing the amount added on undo is insufficient. Acceptance cases should include partial completion corrections and a receipt/recount between completion and undo. No ledger migration or business-data repair was made in this audit.

### Medium: all-time rankings accept incompatible historical intervals

The ranking parser validates only the first date in each label. A bounded reproduction using six date labels from the historical CSV accepted the August 25–November 2, 2025 interval as one week, along with November 25–December 1 and December 1–7 intervals that overlap on December 1. It reported six usable samples, zero ignored samples, and zero conflicts.

Evidence: [date parser](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/weekly-usage-seller-rankings.mjs:120), [original history](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/data/weekly-usage-history.csv:5). The reproduction used synthetic quantities with those real labels; it demonstrates invalid interval admission, not a measured dollar error in live all-time results. It does not establish a problem with recent six-week reporting.

Validate the entire interval and detect overlapping periods per product before calculating weekly averages. Preserve questionable records for review; do not guess corrected dates or silently rewrite old history.

## Fixed locally during this audit

| Defect | Change and verification |
| --- | --- |
| Search could convert missing data to zero or reuse a reading rejected by the shared validator. | Removed the fallback; search now uses the canonical poured-ounces validator. Tests cover null, blank, unknown zero, explicitly unusable readings, incompatible sales data, verified zero, and valid keg conversion. [Search adapter](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:3635). |
| Inventory reality checks always received null usage because the conversion helper was called with the wrong arguments; uppercase PMB also failed the source check. | Pass the product, entry, and full-size resolver, normalize source case, and reject invalid date labels. A regression checks a real adapter invocation. This does not solve all recipe-to-ingredient matching limitations. [Usage adapter](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:15994). |
| Clearing an individual count left a timestamp that could make it look counted. | Remove the timestamp for blank individual and mixed-batch edits; entered zero remains counted. Reducer tests verify both paths. [Count handling](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/inventory-store.mjs:590). |
| Weekly comparisons lost the previous week at daylight-saving transitions. | Shift by calendar days instead of a fixed number of milliseconds. Tests run in America/New_York and verify both March and November transitions. [Week calculation](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/weekly-usage-performance.mjs:5). |
| Saved liquor prep could require inventory review without showing the warning. | Convert review items into the warning field consumed by clients, preserve existing warnings, and show the warning on both staff prep panels. The warning builder is tested; client wiring was source-reviewed. [API response](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/api/staff-prep-plan/route.js:199), [warning builder](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/inventory-backed-operation.mjs:3), [staff panels](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/staff-dashboard.js:1045). |
| Concurrent staff reads shared one consumable Response body. | Clone the response for each caller while retaining request deduplication. The test reads both bodies and verifies one network request. [Staff fetch](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/staff-resilience.mjs:60). |
| A failed read after a save could restore an older checklist from the fallback cache. | Invalidate fallback snapshots when a write starts and finishes, including uncertain/failed saves; prevent reads started before or during a save from restoring an old fallback afterward. Tests cover success, server error, lost connection, and overlapping reads. This protects the fallback cache; it is not a general guarantee against every concurrent UI refresh race. [Staff fetch](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/staff-resilience.mjs:73). |

## Earlier fixes retained in this workspace

- The repeated Weekly Usage warning: failed initial reads and pending recovery writes can now retry, and startup rechecks shared usage. Seven regression tests include a simulated 99/102 → 102/102 recovery. The shared report inspected contains all 102 current readings; the exact failure on the boss's device remains unconfirmed.
- Estimated-profit dollars were restored. Multiweek calculations now use each week's saved rate instead of applying the first rate to every week. The separate saved-data audit isolated a $96.58 six-week overstatement from that rate-reuse defect. Doubles remain 2 oz, as confirmed by the user; profit remains an estimate using the modeled portion mix.
- The redundant Weekly Plan tab heading was removed locally.

## Coverage and limits

Read-only production navigation covered Home, Keg Levels, Inventory, Weekly Plan, Weekly Snapshots, Weekly Usage, Tap Pricing, Ingredient & Keg Costs, Recipes, Add Product, Tap Performance, and Print. Staff View was inspected using the administrator's existing session: Home, Cocktails, Liquor, and Deliveries. These screens loaded. Staff counts agreed across its summary and detail screens: four cocktails, two liquor refills, and two delivery lines remaining.

One wording ambiguity remains: owner “Weekly Run — Complete” means counts/snapshot/orders are complete; staff prep and delivery work can still remain. Source inspection confirmed these are separate progress models. This is not evidence of a failed save, but the label can suggest broader completion than it measures.

Source review and automated coverage included startup/recovery, weekly usage validity, pricing/profit, inventory mutations and contributions, prep responses, staff loading, date boundaries, and API authorization. The older claim that a name-only recipe can be saved is no longer valid: current recipe validation requires at least one ingredient and checks its setup. The UI still calls the action “Save recipe draft,” while saved recipes enter the current collection; a separate draft lifecycle would be a product change.

No orders were submitted, prices/counts changed, recipes created, prep or delivery items checked, or print jobs started. Navigation may invoke the application's normal background synchronization. A separate employee login, the boss's device, speech recognition, external vendor checkout, and physical mobile use were not exercised. Passing tests and screen loads do not prove the dashboard is free of other bugs.

## Verification

- Full suite: **1,137 passed; zero failures**.
- ESLint: passed with zero warnings.
- Production build check: passed.
- Git whitespace check: passed.
- New regression files: [dashboard audit regressions](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/tests/dashboard-audit-regressions.test.mjs), [staff read recovery regressions](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/tests/staff-read-recovery-regressions.test.mjs).

Existing unrelated working-tree changes were preserved. No commit, deployment, or operational-data repair was performed.

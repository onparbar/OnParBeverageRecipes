# PMB history recovery through Cloudflare — September 18, 2026

Recovered operational reports through the existing authenticated onparbev.com connection. No PMB configuration, prices, keg levels, inventory counts, or active tap weekly histories were changed.

**Status: partial source recovery only; historical weekly replacement is not complete.** The native monthly reports and recovered daily transactions disagree materially. Matching reads must not be mistaken for complete history.

## Saved source data

Checked and saved 238 daily reports covering 34 missing Monday–Sunday periods: nine summer 2025 weeks plus 25 gaps between December 2025 and June 2026. Five of these reports were already saved; 233 were added during this task. A fresh GET verified every target day, coverage status, pour count, and per-product ounce total.

There are 227 matching-overlap days and 11 empty-unverified days, representing 45,044 recorded pours and 422,059.249 recorded ounces across 197 product IDs. These are retained-record totals, not vendor-certified totals of all business activity. 28 weeks have matching nonempty reads for all seven days. Empty days are unknown, not confirmed zero sales.

## Historical product identity

None of these recovered historical rows has a verified physical tap assignment. The PMB records retain product IDs; suggested names and taps come from the current lineup. Products may have been renamed or replaced since the pour date. The recovered records are saved in the live daily-report archive and the accompanying weekly JSON, but have not been merged into active per-product Weekly Usage, demand averages, category sales, or profit. Doing that without historical identity evidence would risk attributing old pours to replacement products.

## Weekly date-range defect

The existing weekly endpoint groups PMB responses without checking original pour timestamps. December 1–7 returned 2,547 rows through the weekly endpoint versus 2,549 across the matching daily reads. Query labels alone are not enough to establish coverage.

A local fix now filters weekly and pre-Thursday reports by original tst_start, uses Eastern boundaries independent of server timezone, rejects unreadable timestamps, and applies sparse-report checks after filtering. It prevents out-of-range inclusion; it cannot recover rows the PMB source fails to return. The recovery itself used two padded daily reads. The code fix is not deployed. All 1,156 tests, scoped lint, production build, and whitespace checks passed.

## Report types and reconciliation

Through Cloudflare, 102 overlapping transaction searches covered October 31, 2023 through July 4, 2025. The first 101 returned zero rows; the last returned three. A separate June 28–29 query and the saved June 30–July 2 daily reports returned no records. July 3, 2025 is the earliest returned pour day in these sources, not a verified opening date or a proven limit of every PMB report.

The native poured-volume report provides daily, weekly, and monthly tables. The monthly table runs September 2025–September 2026. The weekly table shows 2026W30–W38. I directly tested weekly exports for December 1–7, 2025 and November 1–30, 2023. Both accepted the date filter but returned the same 2026W29–W38 rows (July 13–September 20, 2026). These exports cannot be imported under the requested older dates.

The reporting page also advertises separate money, servings, cleaning, staff, sold-versus-dispensed, and explicit-date transaction exports. Their presence is not proof of historical volume availability. They have not all been downloaded; the current read-only bridge exposes poured-volume exports only. No claim is made that every possible PMB report has been exhausted.

Every day of the months below has a saved daily response, yet totals disagree with native monthly volume. Cells marked ?? are excluded from native totals. No scaling, allocation of monthly totals into weeks, or synthetic historical identity has been applied.

| Month | Recorded daily ounces | Native readable monthly ounces | Unreadable native cells |
| --- | ---: | ---: | ---: |
| 2025-12 | 69,339.308 | 182,636.7 | 32 |
| 2026-02 | 12,348.692 | 121,329.4 | 24 |
| 2026-03 | 22,104.286 | 163,759 | 13 |
| 2026-04 | 77,726.205 | 135,366.5 | 0 |
| 2026-05 | 150,081.564 | 142,306.6 | 0 |

The discrepancy is unresolved: transaction retention, report inclusion rules, or another PMB reporting difference may contribute. The recovered records remain available for reconciliation, and active Weekly Usage has not been replaced.

## Recovered periods

| Week beginning | Recorded pours | Recorded ounces | Daily coverage |
| --- | ---: | ---: | --- |
| 2025-06-30 | 339 | 6,439.528 | 3 matching; remainder empty-unverified |
| 2025-07-07 | 433 | 3,563.416 | 5 matching; remainder empty-unverified |
| 2025-07-14 | 866 | 8,433.438 | 7 matching reads |
| 2025-07-21 | 673 | 8,854.19 | 6 matching; remainder empty-unverified |
| 2025-07-28 | 273 | 2,316.43 | 7 matching reads |
| 2025-08-04 | 515 | 9,191.477 | 7 matching reads |
| 2025-08-11 | 194 | 1,690.454 | 7 matching reads |
| 2025-08-18 | 631 | 9,320.559 | 7 matching reads |
| 2025-08-25 | 99 | 627.341 | 7 matching reads |
| 2025-12-01 | 2,549 | 19,382.513 | 7 matching reads |
| 2025-12-08 | 2,091 | 20,315.59 | 7 matching reads |
| 2025-12-15 | 2,939 | 24,177.897 | 7 matching reads |
| 2025-12-22 | 255 | 4,333.946 | 6 matching; remainder empty-unverified |
| 2025-12-29 | 234 | 1,760.928 | 7 matching reads |
| 2026-01-05 | 751 | 8,155.375 | 7 matching reads |
| 2026-01-26 | 302 | 2,539.113 | 5 matching; remainder empty-unverified |
| 2026-02-02 | 407 | 5,426.183 | 7 matching reads |
| 2026-02-09 | 27 | 261.443 | 7 matching reads |
| 2026-02-16 | 501 | 4,565.341 | 7 matching reads |
| 2026-02-23 | 257 | 2,459.15 | 7 matching reads |
| 2026-03-02 | 302 | 3,746.803 | 6 matching; remainder empty-unverified |
| 2026-03-09 | 518 | 4,222.316 | 7 matching reads |
| 2026-03-16 | 488 | 4,818.144 | 7 matching reads |
| 2026-03-23 | 318 | 2,745.414 | 7 matching reads |
| 2026-03-30 | 562 | 6,835.997 | 7 matching reads |
| 2026-04-06 | 181 | 1,303.583 | 7 matching reads |
| 2026-04-13 | 3,569 | 33,106.651 | 7 matching reads |
| 2026-04-20 | 3,209 | 28,037.076 | 7 matching reads |
| 2026-04-27 | 4,303 | 38,543.518 | 7 matching reads |
| 2026-05-04 | 2,942 | 25,098.357 | 7 matching reads |
| 2026-05-11 | 3,829 | 34,893.653 | 7 matching reads |
| 2026-05-18 | 4,682 | 42,039.726 | 7 matching reads |
| 2026-05-25 | 2,572 | 24,107.229 | 7 matching reads |
| 2026-06-01 | 3,233 | 28,746.47 | 7 matching reads |

Detailed product-ID aggregates: [recovered weekly history](../output/pmb-recovered-weekly-history-2026-09-18.json).

## Direct export tests after the weekly-report follow-up

| Requested report | Requested dates | Dates actually exported |
| --- | --- | --- |
| Weekly poured volume | 2025-12-01–2025-12-07 | 2026W29 through 2026W38 |
| Weekly poured volume | 2023-11-01–2023-11-30 | 2026W29 through 2026W38 |
| Monthly poured volume | 2023-11-01–2023-11-30 | 2026-04 through 2026-09 |
| Daily poured volume | 2025-12-01–2025-12-07 | 2026-09-07 through 2026-09-17 |

All four report forms accepted the selected dates, but their exported rows were from recent periods. The native monthly HTML table goes further back than its monthly CSV download (September 2025 versus April 2026), so export format also changes available coverage. None of these tests establishes that every other PMB report lacks older history. The separately advertised dated transaction, money, servings, cleaning, and staff exports have not all been fetched through the current bridge.

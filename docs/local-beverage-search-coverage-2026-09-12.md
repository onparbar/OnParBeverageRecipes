# Local beverage question coverage

The search reads dashboard data already loaded in the browser. It does not send
questions to an external AI service and does not mutate business records.
This is a bounded local question engine, not an unrestricted language model.

## Question families

- Usage: recorded total ounces, weekly averages, and configured keg equivalents.
- Windows: last or past 1-104 saved weeks; number words one through twelve.
- Scope: product names, tap numbers, walls, and beverage categories.
- Comparisons: named products or walls over the same saved-week window.
- Trends: latest window versus the preceding equal-length window, using matching
  tap/product observations in both periods; zero baselines have no percentage gain.
- Peaks: highest or lowest fully covered saved week in the requested window.
- Zeros: only products with verified readings throughout the full requested window.
- Pricing: saved ingredient package and keg purchase prices, supplier, timestamp.
- Recipes: active recipes, ingredient quantities, batch ounces, ingredient costs,
  calculated ABV, and reverse ingredient lookup.
- Counts: current operating-week physical-count receipts, excluding policy assumptions.
- Stock: existing cabinet/on-hand question handler and its count freshness policy.
- Ordering: saved inventory-plan needs, count/save holds, explanation and estimated
  item cost; does not represent complete vendor orders or submit anything.
- Levels: available PMB tap readings; empty means an available zero, not missing data.
- Save status: existing inventory, weekly-usage, and keg-count pending/error state.
- Existing search handles ranking/threshold questions and current estimated margins.
- Existing what-if planning remains available as a read-only volume scenario.

## Evidence rules

Unknown and unverified usage is excluded, not imputed as zero. Totals with missing
coverage are subtotals. Product averages use fully covered weeks. Historical
records participate in volume questions, with identical tap/product/week readings
deduplicated and conflicting duplicate values withheld. Trend comparisons use
the same available observations on both sides. New-product weeks are not invented.
Prices used for financial estimates are current assumptions, not historical POS
sales or net profit. Keg equivalents use configured sizes, not physical keg swaps.
Pending inventory saves and missing count receipts prevent reliable order answers.

## Explicit boundaries

Daily data, calendar-date ranges, calendar-month totals, guest counts, actual POS
sales, labor costs, net profit, weather, guaranteed stockout dates, and arbitrary
serving counts are not supplied by this engine. Unsupported time windows ask for
completed saved weeks. Search never clears inventory, places orders, changes
prices, repairs taps, or marks the weekly plan complete.

## Release status

Implementation only. Automated and browser validation have not been run for these
changes, and they have not been deployed. Exercise the example questions against
known source totals and the incomplete/zero/conflicting-data cases before release.

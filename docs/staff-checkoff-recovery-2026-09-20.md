# Staff checkoffs and dashboard recovery — September 20, 2026

The live dashboard returned HTTP 503 because all seven shared-storage checks failed. With the user's previously explicit approval, restarted the Beverage Supabase project around 21:30 Eastern. Database access returned and all seven storage checks subsequently passed. The precise cause of the recurring database outage remains unconfirmed; a restart restores service but does not prove the underlying capacity/platform issue is resolved.

Fixed the three cocktail preparation blockers:
- Normalize the source spelling `Pomegrante Schnapps` to counted `Pomegranate Schnapps`.
- Exclude strawberry lemonade and cranberry juice (including the recipe label `Cranberry`) from prep deductions, as explicitly requested by the user.
- Retain excluded juice ounces in recipe yield calculations so liquor deductions scale correctly. Do not invent inventory counts or suppress unmatched errors for other counted ingredients.

Validated against live shared recipes/inventory without saving completion records: Pomegranate Martini, Spiked Pink Lemonade, and Vodka Cran all produce valid contribution plans. Pink Lemonade and Vodka Cran each deduct six Tito's bottles and no juice.

Isolated release: `/tmp/onpar-staff-checkoff-fix-20260920`, commit `04634a90b39512dd9052395d40135d54677ffd19`, based on the then-live `c3e6cba`. Only `lib/inventory-contributions.mjs` and `tests/inventory-data-trust.test.mjs` changed. Existing unrelated working-tree edits were preserved.

All 1,156 tests, zero-warning lint, production build, and whitespace checks passed. Following explicit user deployment approval, GitHub Quality checks run 35551268229 and Deploy on-site run 35551322196 succeeded. The live version endpoint reported the exact fix commit; health and authenticated staff-plan reads returned HTTP 200 with all required storage resources reachable. The health endpoint still reports an older par-agent error from September 14, distinct from current shared-storage readiness.

No cocktail completions or inventory quantities were manually changed. Raspberry Margarita remains completed by Molly; the three other cocktails remain available to check off.

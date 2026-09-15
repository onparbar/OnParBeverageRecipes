# Product-name collection from September 15, 2026

The owner chose forward collection only. Existing reports, historical labels,
prices, amounts, and tap assignments must remain unchanged.

When an owner reads or successfully saves Weekly Usage, the server observes only
`activeItems` and starts a best-effort background name capture. It does not scan
archived items or read old PMB monthly tables. The report response does not wait
for capture. Storage errors are caught, logged without private data, and retried
on the next observation. Concurrent captures from this process are coalesced;
already-successful unchanged names are skipped until the process restarts.

Names are stored in the existing private Supabase `pmb_data_backup` table under
`pmb-product-name-<PLU>-<digest>`. Newly collected records use evidence source
`weekly-usage-forward` and their observation timestamp. Each record contains only
an exact PLU, name including the wall suffix, evidence source, and timestamp.
Generic PLU labels and unnamed products are ignored. Distinct names remain as
separate evidence. No names are guessed or used to relabel past reports.

Insert-ignore semantics retain existing records and prevent concurrent writes
from replacing earlier evidence. Existing row-level security remains unchanged;
only server-side service credentials are used. Preserve this source prefix in
any future backup-retention job: these are lasting identity records.

## Previously completed reference capture

Before the forward-only instruction arrived, 750 corroborating name-evidence
records covering 119 verified products were appended from available snapshots.
Those separate reference records did not modify any existing report. They remain
stored, but the deployed path does not backfill or relabel historical data.

The 101 unidentified old PMB product IDs remain unresolved. Do not infer their
names from current taps, similar volumes, or Main-wall recipes.

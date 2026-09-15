# Dashboard reporting history in Supabase

The production on-site Node service runs a backup cycle on startup and every 15 minutes. It does not depend on an open dashboard tab. Builds and development do not run it. Set `ONPAR_DASHBOARD_BACKUP_ENABLED=false` to pause. It uses the existing server-only `pmb_data_backup` table and existing RLS protections; no browser receives database credentials.

## Preserved information

- Shared recipes, product definitions, Coming Soon/On Deck assignments and pricing overrides.
- Running inventory, inventory contribution ledgers, Monday snapshots, weekly plans, order and prep state.
- Weekly usage and source CSVs needed to reproduce historical drink rankings.
- Existing PMB reports, recorded sales amounts, available cost snapshots and their evidence.
- Tap assignment events, dashboard activity, a daily keg-level snapshot, and observations of each tap's product and PMB-reported last refill.
- No application passwords, tokens, customer/card identifiers or environment files.

History records use `history-*` source keys, checksums, schema versions and observation times. They are insert-only in this code. Meaningful changes create a new version rather than replacing an old one. Repeated observations do not create new versions. The job never deletes existing history or changes PMB configuration, inventory quantities, prices or orders.

## Daily pours and catch-up

Each cycle imports at most two completed Eastern-calendar days. Recent days get priority, then missing older days are filled from the earliest known weekly usage date. `ONPAR_DAILY_BACKFILL_START_DATE=YYYY-MM-DD` can extend that date explicitly. An imported day is stored by date and read through the existing Performance page. Two overlapping PMB reads are reconciled without adding duplicates. Existing better-coverage reports are never replaced by poorer reads. Failed days retry after an hour; partial or empty-unverified days retry after six hours.

Costs are preserved when available, not invented. Saved cost estimates are not accounting-grade historical COGS. Rankings can be reconstructed from saved usage and the matching configuration; no separate contradictory ranking ledger is maintained.

## Status and history

Owner-only `GET /api/dashboard-backup` reports the last run, failures, stale status, saved datasets and remaining daily backfill. `?kind=tap-observation&identity=TAP:DEVICE:LINE&before=ISO_DATE` returns observed tap history. Other supported kinds are documented by the endpoint's allowlist. The endpoint is read-only and returns at most 100 versions per request; use a prior observation date to request older records.

An operator can run `node --env-file=.env.local scripts/dashboard-backup.mjs` on the service computer. `--storage-only` archives existing Supabase and CSV data without reading PMB. Runtime workers use a ten-minute compare-and-swap lease, and each process avoids overlapping runs.

## Limits and recovery

This is operational version history within Supabase, not an independent disaster-recovery copy of the Supabase project. It does not protect against deleting the entire project or all backups. Provider-managed database backups/PITR or a separate off-site export are a separate requirement.

A reported refill timestamp is evidence of a PMB reset, not proof that staff physically changed a keg. Historical assignments before our first observation remain unknown unless transaction or older saved evidence supports them. Multiple changes between 15-minute observations may not be captured. Days PMB no longer retains cannot be recreated; missing/partial data is never represented as zero or complete. A successful storage cycle does not mean historical daily backfill has finished: check `remainingDailyDays`.

Recovery is explicit, not automatic: locate the dated record, verify its checksum and identity, and use the normal revision-checked application write path. Restoring history must not silently overwrite newer counts, orders or prep completion.

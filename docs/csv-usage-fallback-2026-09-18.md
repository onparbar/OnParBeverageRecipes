# CSV usage fallback — September 18, 2026

The user reversed the PMB-only history preference after the historical PMB investigation. Usable PMB readings remain authoritative for each product/week. Valid CSV weeks fill missing or unusable readings, with visible CSV labels. Verified PMB zeros take priority; blank spreadsheet cells and unverified PMB zeros are not invented readings. Invalid, overlapping, and nonweekly date ranges remain excluded.

Source selection is shared by dashboard loading/recovery, demand calculations, performance, and rankings. Known spreadsheet spelling variants resolve to the same product on the same tap; distinct products and walls remain separate. Archived observations cannot cause the same product/week to count both PMB and CSV. Automatic PMB recovery may replace a CSV fallback only with usable PMB evidence. The original shared revision is retained for conflict-safe saves.

Read-only rehearsal using live shared revision 108 and the original CSV files selected 979 CSV fallback entries, preserving all 5,066 PMB entries and latest-week 102/102 coverage. Two distinct former products remain archived. Original CSV files are unchanged. Final production restoration uses a fresh revision, checks preservation of every existing PMB entry and current count, and verifies the saved result.

The isolated release excludes unrelated local edits. Validation: 1,160 tests passed, zero-warning lint, production build, and whitespace checks passed. Eleven CSV regression cases plus the recovery upgrade test cover source priority, alternate date labels, zeros, bad dates, product changes, archive overlap, spelling variants, shared-load baselines, and repeat imports.

## Release status

Prepared commit `a4f036c` in `/tmp/onpar-csv-fallback-release`. Automatic approval review rejected pushing to `main` because that triggers production deployment without the explicit deployment approval it requires. Deployment approval was requested; neither this release nor its CSV data restoration has been applied to production. The latest inspected live commit is `7dd13e5`, which still filters out CSV history.

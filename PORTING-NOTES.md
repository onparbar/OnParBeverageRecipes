# Porting Notes

> Historical handoff note: the Mac service layout and current deployment
> procedure now live in `OPERATIONS.md`. Do not use the old Vercel guidance in
> this file as a production runbook.

## Why this file exists

- This desktop copy appears behind the newer active working repo used for recent dashboard development.
- If this becomes the new main repo on your new computer, compare before pushing or deploying.

## Newer work noted from the active repo

These items were part of the newer dashboard work and may need to be ported into this copy:

- inventory tab
- keg levels tab
- weekly usage tab
- pricing tab split into ingredient pricing and keg pricing
- vendor mappings for beer kegs
- recipe card gallon display improvements
- recipe card bottle-size display like `(1L)` and `(1.75L)`
- ingredient edit/update workflows
- vendor sync work for OHLQ / Provi / Proof
- local PMB / keg sync routes

## Safe handoff approach

1. Open this repo on the new computer.
2. Read `scratchpad.md`.
3. Compare this copy against the newer active repo if that repo is still available.
4. Decide which repo should be the real source of truth before pushing to GitHub.

## If this copy becomes the source of truth

- Port the newer dashboard features into this repo first.
- Run `npm run build`.
- Test locally.
- Only then push. Production deployment is performed from the on-site service
  checkout using `scripts/deploy-on-site.sh`.

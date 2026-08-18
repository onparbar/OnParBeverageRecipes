# Production deployment on the service Mac

This is the authoritative deployment guide for the current service Mac. The
dashboard is supervised by PM2. Cloudflare and the par-agent are separate
system services and must not be changed during a dashboard deployment.

## Production paths

- Clean source checkout: `/Users/onpar/OnParBeverageRecipes-source`
- Persistent runtime: `/Users/onpar/OnParBeverageRecipes-service`
- Immutable releases: `/Users/onpar/OnParBeverageRecipes-release-<commit>`
- Dashboard PM2 app: `onpar-dashboard`
- Local dashboard: `http://127.0.0.1:3000`
- Public dashboard: `https://onparbev.com`

The runtime `.env.local`, `data`, and `logs` paths are persistent. They must
never be replaced by Git, copied into GitHub, or removed during deployment.

## One-time source checkout

Create the source checkout outside Desktop so a background runner is not
blocked by macOS privacy controls:

```bash
git clone https://github.com/onparbar/OnParBeverageRecipes.git \
  /Users/onpar/OnParBeverageRecipes-source
```

The checkout must remain clean. Deployment fetches reviewed commits but does
not check out, reset, or hand-edit the source tree.

## Automatic deployment

Register the GitHub runner under the `onpar` account with the name
`onpar-service-mac` and label `onpar-production`. After a push to `main` passes
`Quality checks`, `.github/workflows/deploy-on-site.yml` extracts the PM2
helpers from that exact commit and runs the guarded deployment.

The deployment:

1. Requires the existing `onpar-dashboard` process to be online.
2. Builds and tests an immutable sibling release.
3. Links the private runtime environment, data, and logs.
4. Switches only the PM2 dashboard process.
5. Verifies exact build identity and storage health locally and publicly.
6. Restores the previous PM2 release if validation fails.
7. Leaves Cloudflare and `com.onpar.par-agent` untouched.

The workflow intentionally does not run `pm2 save` or change PM2 startup
services. Repair PM2 reboot persistence in a separate approved maintenance
window.

## Manual rollback

After the first successful guarded deployment:

```bash
/Users/onpar/OnParBeverageRecipes-service/.deploy/rollback-on-site-pm2.sh
```

An explicit commit can be supplied only when it exists in the clean source
checkout:

```bash
/Users/onpar/OnParBeverageRecipes-service/.deploy/rollback-on-site-pm2.sh <commit-sha>
```

Do not use the legacy LaunchAgent deployment or rollback scripts on this Mac.

## Inspection

Read-only checks:

```bash
pm2 status onpar-dashboard
curl -fsS http://127.0.0.1:3000/api/version
curl -fsS 'http://127.0.0.1:3000/api/health?storage=1'
curl -fsS https://onparbev.com/api/version
```

Never print `.env.local`, PM2 environment values, runner tokens, PMB
credentials, Supabase credentials, or Cloudflare credentials.

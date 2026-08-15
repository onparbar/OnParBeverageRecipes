# On-site service operations

## Production architecture

The production dashboard runs on the on-site Mac at `127.0.0.1:3000`. A
Cloudflare tunnel publishes that local service at `onparbev.com`. This Mac is
also the only production host that can reach the PourMyBeer service on the
venue network.

Vercel may be used for code previews, but it is not the production target and
cannot perform local PourMyBeer reads or writes. Do not point `onparbev.com` at
a Vercel preview.

The canonical checkout is:

```text
/Users/onparmarketing/OnParBeverageRecipes-service
```

Keep that checkout free of hand-edited or uncommitted files. Operational data,
logs, secrets, and deploy markers are ignored by Git.

## Required service configuration

Copy `.env.local.example` to `.env.local` and keep the resulting file readable
only by the service account. At minimum, configure:

- `DASHBOARD_PASSWORD`
- `DASHBOARD_SESSION_SECRET` with at least 32 characters; generate one with
  `openssl rand -base64 48`
- the credentials for each enabled integration

Before the first launch, apply these five SQL files in filename order using the
Supabase SQL editor:

1. `20260730000000_create_dashboard_shared_state.sql`
2. `20260731000000_create_inventory_shared_state.sql`
3. `20260731010000_create_weekly_usage_shared_state.sql`
4. `20260731020000_create_keg_par_agent_shared_state.sql`
5. `20260731030000_create_dashboard_activity_log.sql`

They create the four required singleton state rows plus the activity log
table. Confirm the singleton IDs are `dashboard-config`, `inventory-state`,
`weekly-usage`, and `keg-par-agent`. After `.env.local` is complete, verify all
five tables and those four rows without writing data:

```bash
npm run check:storage
```

Do not start or deploy the service until this check passes. A configured
Supabase URL by itself does not prove that the application tables exist.

`EMPLOYEE_DASHBOARD_PASSWORD` is optional. PMB username and password must be
supplied explicitly; the app does not rely on example admin credentials. The
client ID and name can override the integration defaults. PMB keg device and
line identities are auto-discovered from the authenticated tap configuration
and rejected unless they provide complete, unambiguous coverage for the
checked-in tap template.

Changing `DASHBOARD_SESSION_SECRET` or a role password invalidates that role's
existing sessions. The stronger session format is intentionally incompatible
with older password-derived cookies, so the first release containing it signs
everyone out once.

## Staff prep and recipe access

The employee password opens the dedicated `/staff` prep-and-recipe page. It
shows the cocktail kegs from the current Monday-Sunday Weekly Plan and lets a
staff member record their name and shared completion status. Employee sessions
cannot open the owner dashboard, its client bundle, pricing, inventory, keg
levels, ordering APIs, or direct data files. The staff page receives only the
current cocktail prep checklist and sanitized recipe quantities; pricing and
ordering code is not shipped to that page.

Use a separate browser profile reserved for staff. The staff page fails closed
if the profile contains any owner dashboard storage, and it does not read or
delete those stored values. Never clear an owner profile merely to pass this
check: it may contain unsynced edits. Create a new staff browser profile, sign
in there with `EMPLOYEE_DASHBOARD_PASSWORD`, and keep owner work in the owner
profile.

## Monday order plan

Publish the Weekly Plan on Monday for Thursday delivery. Publishing stores one
shared order-and-prep snapshot and locks it through Sunday. Later PMB keg-level
refreshes, inventory counts, and staff prep checkoffs remain live but do not
rewrite that published order. On the next Monday, publish the new week's plan.

Purchasing is grouped by distributor by default. Bonbright and Heidelberg are
shown as separate orders and remain separate sections in the CSV export. Items
with a par of zero are excluded from both ordering and review warnings, and new
products waiting in the product workflow do not create a dashboard alert merely
because they are new.

Straight-liquor taps use a per-physical-tap bottle rule. When the ounces left in
a Patio or Karaoke liquor keg are below that tap's saved weekly average plus
100 oz, that tap adds two bottles to the active order. Matching products across
walls are combined after the per-tap calculation, so two low Patron taps create
one four-bottle Patron order line.

Each vendor order also has shared handoff tracking. An owner records who placed
the order from Weekly Plan. Employees use the dedicated `/staff` page to mark
each delivery line `Received` or `Not received` and enter their name. A line
marked `Not received` creates a critical owner-dashboard alert containing the
vendor, item, quantity, and reporting employee. Returning the line to
`Received` clears it from that alert.

## First installation

Production is pinned to Node.js 22. The setup script installs Homebrew's
`node@22`, and the service/deploy wrappers stop with an error if another major
version would be used.

From the service checkout, run:

```bash
./scripts/setup-mac-tools.command
```

The setup installs dependencies, runs tests and a production build, creates
private runtime directories, and copies the two LaunchAgent definitions. It
does not start them, so `.env.local` can be completed first.

Start the dashboard and weekly par agent:

```bash
launchctl bootstrap gui/$(id -u) /Users/onparmarketing/Library/LaunchAgents/com.onpar.beverage-dashboard.plist
launchctl bootstrap gui/$(id -u) /Users/onparmarketing/Library/LaunchAgents/com.onpar.par-agent.plist
```

Install the Cloudflare tunnel separately using credentials held outside this
repository. Its checked-in route points to `http://127.0.0.1:3000`.

## Deploy a release

### One-time bootstrap from the pre-deploy checkout

The production checkout at commit `7e7f3c3` does not contain the guarded
deployment scripts. Run this exact bootstrap once from the on-site Mac. It
extracts the bootstrap script and its deployment helpers from the reviewed
`origin/main` commit without changing the old checkout first:

```bash
cd /Users/onparmarketing/OnParBeverageRecipes-service
git fetch --prune origin main
BOOTSTRAP_DIR="$(mktemp -d /tmp/onpar-bootstrap.XXXXXX)"
git archive origin/main -- scripts/bootstrap-deploy-on-site.sh | tar -x -C "${BOOTSTRAP_DIR}"
chmod 700 "${BOOTSTRAP_DIR}/scripts/bootstrap-deploy-on-site.sh"
ONPAR_SERVICE_DIR="$PWD" "${BOOTSTRAP_DIR}/scripts/bootstrap-deploy-on-site.sh" origin/main
```

The bootstrap refuses a dirty checkout, resolves the target to an exact commit,
and verifies the required helpers exist in that commit before executing them.
After this first release, use the durable guarded helpers installed in
`.deploy`; the source checkout remains unchanged while releases are staged.

Deploy the latest fetched `origin/main` from the service Mac:

```bash
./.deploy/deploy-on-site.sh
```

To deploy a reviewed commit already present in the local repository:

```bash
./.deploy/deploy-on-site.sh <commit-sha>
```

The script refuses a dirty checkout, resolves the exact target commit, and
builds it in a private staged release directory without changing the running
checkout. It links the root private `.env.local`, persistent `data`, and logs
into the release, runs `npm ci`, tests, lint, and a production build, atomically
switches `current`, reloads the dashboard LaunchAgent, and validates exact
build identity plus storage-backed health. If validation fails, it restores
the prior release and service definition. It never runs `git reset --hard` or
deletes local data.

The initial rollback target predates `/api/version` and `/api/health`. Smoke
validation uses root-page reachability only for a target commit that contains
neither endpoint. Targets containing the modern endpoints always receive the
strict service-identity, exact-commit, and health checks.

### Reload updated LaunchAgent definitions

`kickstart` restarts a loaded job but does not reload changed plist content.
After a reviewed release changes either checked-in plist, reload it during an
approved maintenance window with the guarded helper:

```bash
./.deploy/reload-launch-agents.sh all
```

Use `dashboard` or `par-agent` instead of `all` to reload only one service. The
helper validates the source plist and label, backs up the installed definition,
boots out the running job, installs and bootstraps the new definition, restores
the prior plist if loading fails, and smoke-tests the dashboard afterward.

## Smoke checks

Run the local non-destructive check at any time:

```bash
./.deploy/smoke-on-site.sh
```

For an integration reachability check as well:

```bash
ONPAR_SMOKE_DEEP=1 ./.deploy/smoke-on-site.sh
```

The public, sanitized endpoints are:

- `/api/version`: service version, commit, build time, and deployment target
- `/api/health`: auth/integration configuration and last par-agent heartbeat
- `/api/health?storage=1`: read-only verification of all required Supabase
  tables and singleton rows
- `/api/health?storage=1&deep=1`: required storage verification plus cached
  short-timeout integration reachability checks, with no URLs, credentials,
  response bodies, or stack traces returned

## Roll back

Restore the commit recorded immediately before the last deployment:

```bash
./.deploy/rollback-on-site.sh
```

Or choose an explicit known-good commit:

```bash
./.deploy/rollback-on-site.sh <commit-sha>
```

Rollback reuses a previously validated immutable release when available. For
an explicit commit not yet staged, it repeats dependency installation, tests,
lint, and build first. It atomically switches `current`, restarts, performs the
same smoke validation, and records the release it replaced so the operation
remains reversible.

## Service inspection

```bash
launchctl print gui/$(id -u)/com.onpar.beverage-dashboard
launchctl print gui/$(id -u)/com.onpar.par-agent
tail -n 100 logs/dashboard.err.log
tail -n 100 logs/par-agent.err.log
```

The par agent writes a private atomic heartbeat to
`logs/par-agent-status.json` after both successful and failed runs. The health
endpoint exposes only its state and timestamps, never its error text.

## Access needed before production deployment

- shell access as the `onparmarketing` service account
- read access to the GitHub repository from the service Mac
- a completed `.env.local` with a new session secret and current integration
  credentials
- the Cloudflare tunnel already installed for `onparbev.com`
- venue-network access to the configured PMB address

No production deployment is performed merely by changing this repository.

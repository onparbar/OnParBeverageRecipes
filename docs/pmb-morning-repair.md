# Daily PMB tap connection repair

The dashboard can send the same full-wall PMB configuration update used by
**Repair tap connection** every day at **10:00 a.m. America/New_York**, plus
**7:00 a.m. every Monday**, at the weekly plan-reset time, before
the venue opens at 11 a.m. The IANA time zone follows Eastern daylight saving
time automatically. The repair can interrupt pouring for several minutes.

## Activation

This feature is activated when a release containing it is started through the
approved on-site PM2 deployment helper. The helper sets
`ONPAR_PMB_REPAIR_SCHEDULER=1` only for the running dashboard process. Preparing
these files, running tests, and building a release do not activate a repair.
No production deployment or live repair is part of preparing this change.

The scheduler also requires the Node.js production runtime and the explicit
`on-site` deployment target. It does not run in development, production builds,
Vercel previews, or an ordinary local preview. Do not put the runtime arming
switch in `.env.local` or add it to build commands.

The service Mac and dashboard must be running at each scheduled time. An open browser tab or
signed-in manager is not required. This scheduler is part of the existing PM2
dashboard process; it does not install another service or a Codex automation.

## Timing and interruption safeguards

- A configuration update may start only during **10:00:00–10:00:59 Eastern**
  daily or **07:00:00–07:00:59 Eastern** on Monday.
  The scheduler rechecks the time immediately before sending the PMB write,
  including after authentication. It does not perform a late catch-up if the
  computer wakes or the service restarts later.
- The first attempt claims that venue date and schedule slot in the persistent
  `data/pmb-morning-repair` directory before issuing a repair. Other processes,
  restarts, and overlapping releases cannot claim the same slot again.
  Monday's 7:00 repair does not consume the separate 10:00 repair claim.
  The reset itself is unchanged; the early repair shares its scheduled time
  rather than being triggered by a user resetting a plan.
- Claims are retained after success, failure, or an interrupted process. An
  uncertain outcome is never retried automatically for that slot. If the claim
  cannot be persisted, no repair is sent.
- Only an explicit endpoint-not-found response permits trying PMB's alternate
  configuration-update path. Network errors, timeouts, and other ambiguous
  responses never cause another configuration update.
- The existing manual **Repair tap connection** action still requires the
  manager's guest-clear confirmation. There is no new **Run now** control.
- The owner explicitly authorized the scheduled pre-opening interruption.
  This scheduled server action does not wait for a browser warning to be
  clicked. Its durable daily record includes that authorization; manual
  confirmation and dashboard authentication remain unchanged.

## Read-only verification

After PMB accepts the update, the scheduler waits three minutes for the tap
walls to reconnect. It then refreshes keg levels and tap pricing using the
dashboard's existing server readers. Those readers also update shared
dashboard snapshots when their data is valid.

If verification is incomplete, the scheduler repeats read-only checks until
confirmed, separated by one minute after each completed attempt. It does not begin another verification
attempt at or after 7:50 a.m. for Monday's early run, or 10:50 a.m. for the
daily run. Failed verification never resends that scheduled repair.
An accepted repair and successfully restored readings are recorded separately:
old backup data or missing taps do not count as a complete live verification.

Each reader has a two-minute deadline for reporting its result. Existing
underlying read requests may finish after that deadline, but cannot issue a
configuration update. A refresh can continue reading after opening if an
upstream service stalls; disruptive repairs remain restricted to their scheduled minutes.
If either reader reaches its deadline, the scheduler stops further verification
attempts for that run so it cannot stack more reads behind the stalled request.

## Status and persistence

The daily run retains its `YYYY-MM-DD.json` claim for compatibility. Monday's
early run uses `YYYY-MM-DD-monday-reset.json`. These status files and `latest.json` are stored under
`data/pmb-morning-repair`. The production release's `data` directory points to
the service Mac's persistent runtime data, so deployment and rollback retain
the claims and history. Do not delete these files to retry a repair.

Scheduled repairs run silently in the background. The dashboard does not show
schedule messages, poll the repair-status endpoint, or add scheduled repairs
to its activity feed. Outcomes remain in the persistent service-side status
files and server logs for troubleshooting. The owner-only status endpoint is
retained for diagnostics, without a dashboard control or notification.

## Pause

Set `PMB_MORNING_REPAIR_ENABLED=false` in the service's private `.env.local`,
then restart only the dashboard through the approved maintenance process.
The scheduler will stay off until the setting is removed or changed and the
dashboard is restarted. Do not change the separate Cloudflare or par-agent
services to control this schedule.

Production activation and any pause/restart must follow
[the PM2 deployment guide](../PRODUCTION-PM2.md). Validate the implementation
with simulated clocks and fake PMB responses; do not test it by triggering a
live repair while guests are using the walls.

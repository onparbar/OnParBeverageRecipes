import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardSessionGuard } from "../public/dashboard-session.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const owner = { id: "manager-1", name: "Manager", role: "owner" };

test("expired dashboard login is reported once and subsequent writes are held without replay", async () => {
  let requests = 0;
  let notices = 0;
  const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner,
    onRequired: () => notices++, fetcher: async () => { requests++; return json({ error: "Login required." }, 401); } });
  const result = await guard.fetch("/api/keg-levels");
  assert.equal(result.status, 401);
  assert.equal((await result.json()).error, "Login required.");
  assert.equal(guard.isBlocked(), true);
  await guard.fetch("/api/inventory", { method: "POST", body: "pending edit" });
  await guard.fetch("/api/pmb-repair-queue");
  assert.equal(requests, 1);
  assert.equal(notices, 1);
});

test("PMB authentication and network errors do not masquerade as dashboard login expiry", async () => {
  for (const reply of [() => json({ error: "PMB authtoken failed (401)" }, 401), () => json({ error: "Unavailable" }, 503), () => { throw new TypeError("Failed to fetch"); }]) {
    const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner, fetcher: reply });
    await guard.fetch("/api/keg-levels").catch(() => {});
    assert.equal(guard.isBlocked(), false);
  }
});

test("signing back in requires the same identity, resumes reads, and never replays failed writes", async () => {
  let session = null;
  const calls = [];
  const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner, fetcher: async (path) => {
    calls.push(path);
    if (path === "/api/session") return json({ user: session }, session ? 200 : 401);
    return session ? json({ ok: true }) : json({ error: "Login required." }, 401);
  } });
  await guard.fetch("/api/save", { method: "POST" });
  session = { ...owner, id: "different-manager" };
  await assert.rejects(guard.resume(), /same account/);
  assert.equal(guard.isBlocked(), true);
  session = { ...owner, role: "employee" };
  await assert.rejects(guard.resume(), /same account/);
  session = owner;
  await guard.resume();
  assert.equal(guard.isBlocked(), false);
  assert.equal(calls.filter(path => path === "/api/save").length, 1);
  assert.equal((await guard.fetch("/api/keg-levels")).status, 200);
});

test("a late unauthorized response cannot invalidate a newly verified session", async () => {
  let finish;
  const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner, fetcher: async (path) => {
    if (path === "/api/session") return json({ user: owner });
    if (path === "/api/slow") return new Promise(resolve => { finish = resolve; });
    return json({ error: "Login required." }, 401);
  } });
  const pending = guard.fetch("/api/slow");
  await guard.fetch("/api/fast");
  await guard.resume();
  finish(json({ error: "Login required." }, 401));
  await pending;
  assert.equal(guard.isBlocked(), false);
});

test("external requests, login failures, and ordinary permission denials do not block the dashboard", async () => {
  for (const path of ["https://other.test/api/session", "/api/login", "/api/restricted"]) {
    const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner, fetcher: async () => json({ error: "Permission denied." }, 403) });
    await guard.fetch(path);
    assert.equal(guard.isBlocked(), false);
  }
});

test("owner-only rejection and concurrent failures open one recovery prompt without consuming bodies", async () => {
  let notices = 0;
  const guard = createDashboardSessionGuard({ origin: "https://dashboard.test", getIdentity: () => owner,
    onRequired: () => notices++, fetcher: async () => json({ error: "Owner login required." }, 403) });
  const results = await Promise.all([guard.fetch('/api/keg-levels'), guard.fetch('/api/pmb-repair-queue')]);
  assert.equal(notices, 1);
  for (const result of results) assert.equal((await result.json()).error, "Owner login required.");
  assert.equal(guard.isBlocked(), true);
});

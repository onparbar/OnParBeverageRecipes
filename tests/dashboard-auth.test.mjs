import assert from "node:assert/strict";
import test from "node:test";

import {
  getDashboardAuthStatus,
  getDashboardRequestRole,
  getDashboardSessionIdentity,
  getDashboardSessionRole,
  matchDashboardRole,
  requireDashboardRequestRole,
  signDashboardSession,
} from "../lib/dashboard-auth.mjs";
import { getSafeDashboardNextPath } from "../lib/dashboard-navigation.mjs";
import { createLoginThrottle, getLoginClientKey } from "../lib/login-rate-limit.mjs";

const env = {
  DASHBOARD_PASSWORD: "owner-password",
  EMPLOYEE_DASHBOARD_PASSWORD: "employee-password",
  DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
};

test("requires a separate strong session secret", () => {
  assert.deepEqual(getDashboardAuthStatus({ DASHBOARD_PASSWORD: "owner" }).issues, ["missing-session-secret"]);
  assert.deepEqual(getDashboardAuthStatus({
    DASHBOARD_PASSWORD: "owner",
    DASHBOARD_SESSION_SECRET: "too-short",
  }).issues, ["weak-session-secret"]);
  assert.equal(getDashboardAuthStatus(env).ready, true);
});

test("creates expiring identity sessions and rejects tampering or expiry", async () => {
  const issuedAt = new Date("2026-08-12T14:00:00.000Z");
  const session = await signDashboardSession("owner", { env, now: issuedAt });
  const secondSession = await signDashboardSession("owner", { env, now: issuedAt });
  assert.match(session, /^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(session, secondSession);
  assert.equal(await getDashboardSessionRole(session, { env, now: issuedAt }), "owner");
  assert.deepEqual(await getDashboardSessionIdentity(session, { env, now: issuedAt }), {
    id: "recovery-owner",
    name: "Administrator",
    role: "owner",
  });
  assert.equal(await getDashboardSessionRole(`${session}x`, { env, now: issuedAt }), "");
  assert.equal(await getDashboardSessionRole(session, {
    env,
    now: new Date("2026-08-20T14:00:00.000Z"),
  }), "");
});

test("rejects legacy password-derived cookies and sessions signed by a rotated secret", async () => {
  const now = new Date("2026-08-12T14:00:00.000Z");
  assert.equal(await getDashboardSessionRole(`owner.${"a".repeat(64)}`, { env, now }), "");

  const session = await signDashboardSession("owner", { env, now });
  assert.equal(await getDashboardSessionRole(session, {
    env: { ...env, DASHBOARD_SESSION_SECRET: "a-different-session-secret-that-is-long-enough" },
    now,
  }), "");
});

test("changing a role password revokes that role's sessions", async () => {
  const now = new Date("2026-08-12T14:00:00.000Z");
  const session = await signDashboardSession("employee", { env, now });
  assert.equal(await getDashboardSessionRole(session, { env, now }), "employee");
  assert.equal(await getDashboardSessionRole(session, {
    env: { ...env, EMPLOYEE_DASHBOARD_PASSWORD: "changed" },
    now,
  }), "");
});

test("signed employee identities retain their verified name and access role", async () => {
  const now = new Date("2026-08-12T14:00:00.000Z");
  const identity = {
    id: "molly-adams",
    name: "Molly Adams",
    role: "employee",
  };
  const session = await signDashboardSession(identity, { env, now });
  assert.deepEqual(await getDashboardSessionIdentity(session, { env, now }), identity);
  assert.equal(await getDashboardSessionRole(session, { env, now }), "employee");
});

test("shared request helpers enforce owner-only operations", async () => {
  const now = new Date("2026-08-12T14:00:00.000Z");
  const employeeSession = await signDashboardSession("employee", { env, now });
  const request = {
    cookies: {
      get: () => ({ value: employeeSession }),
    },
  };
  assert.equal(await getDashboardRequestRole(request, { env, now }), "employee");
  await assert.rejects(
    requireDashboardRequestRole(request, { owner: true, env, now }),
    (error) => error?.status === 403 && error?.code === "OWNER_REQUIRED",
  );
});

test("matches configured roles without accepting partial passwords", () => {
  assert.equal(matchDashboardRole("owner-password", env)?.role, "owner");
  assert.equal(matchDashboardRole("employee-password", env)?.role, "employee");
  assert.equal(matchDashboardRole("owner", env), null);
});

test("allows only same-origin dashboard paths after login", () => {
  assert.equal(getSafeDashboardNextPath("/weekly?view=vendor#orders"), "/weekly?view=vendor#orders");
  assert.equal(getSafeDashboardNextPath("//evil.example/steal"), "/");
  assert.equal(getSafeDashboardNextPath("/\\evil.example/steal"), "/");
  assert.equal(getSafeDashboardNextPath("https://evil.example/steal"), "/");
  assert.equal(getSafeDashboardNextPath("invalid", "//evil.example/fallback"), "/");
});

test("throttles repeated failures and resets after a successful login", () => {
  const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 1000, lockMs: 5000 });
  assert.equal(throttle.recordFailure("client", 100).allowed, true);
  assert.equal(throttle.recordFailure("client", 200).allowed, true);
  assert.equal(throttle.recordFailure("client", 300).allowed, false);
  assert.equal(throttle.check("client", 1000).allowed, false);
  throttle.reset("client");
  assert.equal(throttle.check("client", 1000).allowed, true);
});

test("prefers Cloudflare's client address for login throttling", () => {
  const request = {
    headers: {
      get(name) {
        return {
          "cf-connecting-ip": "203.0.113.20",
          "x-forwarded-for": "198.51.100.2, 10.0.0.1",
        }[name] || "";
      },
    },
  };
  assert.equal(getLoginClientKey(request), "203.0.113.20");
});

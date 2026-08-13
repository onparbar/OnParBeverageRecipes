import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDashboardBuildInfo } from "../lib/dashboard-build-info.mjs";
import { buildDashboardHealth } from "../lib/dashboard-health.mjs";

test("sanitizes public build metadata", () => {
  assert.deepEqual(getDashboardBuildInfo({
    NODE_ENV: "production",
    ONPAR_APP_VERSION: "1.2.3",
    ONPAR_BUILD_SHA: "ABCDEF1234567890",
    ONPAR_BUILD_TIMESTAMP: "2026-08-12T14:00:00Z",
    ONPAR_DEPLOYMENT_TARGET: "on-site",
  }), {
    service: "onpar-beverage-dashboard",
    version: "1.2.3",
    commit: "abcdef1234567890",
    builtAt: "2026-08-12T14:00:00.000Z",
    target: "on-site",
  });
});

test("health reports configuration without exposing secret values", async () => {
  const env = {
    NODE_ENV: "test",
    DASHBOARD_PASSWORD: "owner-password",
    DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
    EMPLOYEE_DASHBOARD_PASSWORD: "employee-password",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "super-secret-value",
    PMB_API_BASE_URL: "http://192.168.1.10",
    PMB_API_USERNAME: "pmb-user",
    PMB_API_PASSWORD: "pmb-password",
    PMB_API_CLIENT_ID: "910423",
    PROVI_SESSION_STATE_PATH: "/path/that/does/not/exist",
  };
  const health = await buildDashboardHealth({ env, deep: false, now: new Date("2026-08-12T14:00:00Z") });
  assert.equal(health.ok, true);
  assert.equal(health.configuration.authentication.employeeRoleEnabled, true);
  assert.equal(health.configuration.supabase.configured, true);
  assert.equal(health.configuration.pmb.configured, true);
  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes("super-secret-value"), false);
  assert.equal(serialized.includes("pmb-password"), false);
});

test("health exposes a sanitized par-agent heartbeat and marks errors degraded", async (context) => {
  const statusDirectory = await mkdtemp(path.join(os.tmpdir(), "onpar-health-"));
  context.after(() => rm(statusDirectory, { recursive: true, force: true }));
  const statusPath = path.join(statusDirectory, "par-agent-status.json");
  await writeFile(statusPath, JSON.stringify({
    status: "error",
    checkedAt: "2026-08-12T13:55:00Z",
    generatedAt: "2026-08-12T13:55:01Z",
    errorMessage: "credential super-secret-value failed",
  }));

  const health = await buildDashboardHealth({
    env: {
      DASHBOARD_PASSWORD: "owner",
      DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "supabase-secret",
      PMB_API_BASE_URL: "http://192.168.1.10",
      PMB_API_USERNAME: "pmb-user",
      PMB_API_PASSWORD: "pmb-password",
      PMB_API_CLIENT_ID: "910423",
      PAR_AGENT_STATUS_PATH: statusPath,
      PROVI_SESSION_STATE_PATH: path.join(statusDirectory, "missing-provi-session.json"),
    },
    now: new Date("2026-08-12T14:00:00Z"),
  });

  assert.equal(health.status, "degraded");
  assert.deepEqual(health.lastKnown.parAgent, {
    available: true,
    status: "error",
    checkedAt: "2026-08-12T13:55:00.000Z",
    generatedAt: "2026-08-12T13:55:01.000Z",
    stale: false,
    ageSeconds: 300,
  });
  assert.equal(JSON.stringify(health).includes("super-secret-value"), false);
});

test("deep health checks integrations in parallel without returning URLs", async () => {
  const requestedUrls = [];
  const env = {
    DASHBOARD_PASSWORD: "owner",
    DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
    SUPABASE_URL: "https://tenant.example.test/private-path",
    SUPABASE_SECRET_KEY: "supabase-secret",
    PMB_API_BASE_URL: "http://192.0.2.10/private-path",
    PMB_API_USERNAME: "pmb-user",
    PMB_API_PASSWORD: "pmb-secret",
    PMB_API_CLIENT_ID: "123",
    PROVI_SESSION_STATE_PATH: "/path/that/does/not/exist",
  };
  const health = await buildDashboardHealth({
    env,
    deep: true,
    fetchImpl: async (url) => {
      requestedUrls.push(url.toString());
      if (url.hostname === "192.0.2.10") throw new Error("not reachable");
      if (url.pathname.includes("/rest/v1/")) {
        const expectedId = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
        return {
          ok: true,
          status: 200,
          json: async () => expectedId ? [{ id: expectedId }] : [],
        };
      }
      return { ok: true, status: 204 };
    },
    now: new Date("2026-08-12T14:00:00Z"),
  });

  assert.equal(requestedUrls.length, 6);
  assert.equal(health.reachability.supabase.reachable, true);
  assert.equal(health.reachability.supabase.provisioned, true);
  assert.equal(health.reachability.pmb.reachable, false);
  assert.equal(health.status, "degraded");
  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes("private-path"), false);
  assert.equal(serialized.includes("pmb-secret"), false);
});

test("storage health fails readiness when a required singleton row is missing", async () => {
  const env = {
    DASHBOARD_PASSWORD: "owner",
    DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
    SUPABASE_URL: "https://tenant.example.test",
    SUPABASE_SECRET_KEY: "supabase-secret",
    PMB_API_BASE_URL: "http://192.0.2.10",
    PMB_API_USERNAME: "pmb-user",
    PMB_API_PASSWORD: "pmb-secret",
    PMB_API_CLIENT_ID: "123",
  };
  const health = await buildDashboardHealth({
    env,
    storage: true,
    fetchImpl: async (url) => {
      const expectedId = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
      return {
        ok: true,
        status: 200,
        json: async () => expectedId === "weekly-usage" ? [] : expectedId ? [{ id: expectedId }] : [],
      };
    },
  });

  assert.equal(health.ok, false);
  assert.equal(health.reachability.supabase.provisioned, false);
  assert.equal(health.reachability.supabase.missingResourceCount, 1);
  assert.deepEqual(health.readiness.missing, ["supabase-resources"]);
});

test("health fails when authentication cannot verify sessions", async () => {
  const health = await buildDashboardHealth({
    env: { DASHBOARD_PASSWORD: "owner" },
    deep: false,
  });
  assert.equal(health.ok, false);
  assert.equal(health.status, "misconfigured");
  assert.deepEqual(health.configuration.authentication.issues, ["missing-session-secret"]);
});

test("health fails deployment readiness when core storage or PMB configuration is missing", async () => {
  const health = await buildDashboardHealth({
    env: {
      DASHBOARD_PASSWORD: "owner",
      DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
    },
    deep: false,
  });

  assert.equal(health.ok, false);
  assert.equal(health.status, "misconfigured");
  assert.deepEqual(health.readiness.missing, ["supabase", "pmb"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardBackupJob } from "../lib/dashboard-backup.mjs";

test("scheduled backup skips unchanged singleton payloads and never recursively scans its cache", async () => {
  const calls = [];
  let savedStatus = null;
  const revisions = {
    "dashboard_shared_state:revision": 10,
    "inventory_shared_state:revision": 20,
    "keg_par_agent_shared_state:revision": 30,
    "weekly_usage_shared_state:revision": 40,
  };
  const store = {
    acquire: async () => "lease",
    release: async () => {},
    read: async () => ({ data: {
      cursors: revisions,
      heads: {},
      levelSnapshotDay: "2026-09-28",
      backfillStartDay: "2026-09-27",
      dailyAttempts: {},
    } }),
    rest: async (table, query) => {
      calls.push({ table, query });
      if (query.select === "revision") {
        return [{ revision: revisions[`${table}:revision`] }];
      }
      return [];
    },
    archive: async (_records, heads) => ({ heads, added: 0 }),
    save: async (_source, status) => { savedStatus = status; },
  };
  const run = createDashboardBackupJob({
    store,
    now: () => new Date("2026-09-28T16:00:00.000Z"),
    readDataFile: async () => "",
  });

  await run({ includePmb: false });

  const cacheReads = calls.filter((call) => call.table === "pmb_data_backup");
  assert.equal(cacheReads.length, 1);
  assert.equal(cacheReads[0].query.and, "(source.gte.pmb-daily-2000-00-00,source.lt.pmb-daily-3000-00-00)");
  assert.equal(calls.some((call) => call.table === "weekly_usage_shared_state" && call.query.select === "*"), false);
  assert.equal(savedStatus.datasets["weekly-usage"].unchanged, true);
});

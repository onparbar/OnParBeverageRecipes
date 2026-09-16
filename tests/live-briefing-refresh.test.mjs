import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const dashboard = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const start = dashboard.indexOf("async function refreshTapRepairBriefing() {");
const end = dashboard.indexOf("function formatComingSoonFollowUpTime", start);
assert.ok(start >= 0 && end > start);

for (const failure of ["network", "http", "json"]) {
  test(`failed live preview (${failure}) clears old recommendations without blocking the repair briefing`, async () => {
    const calls = [];
    let renders = 0;
    const context = {
      tapRepairBriefingLoading: false,
      liveParRecommendations: { stale: true },
      tapRepairBriefing: { unavailable: true },
      AbortSignal,
      renderDashboardOverview: () => { renders++; },
      fetch: async (url) => {
        calls.push(url);
        if (url === "/api/live-par") {
          if (failure === "network") throw new Error("Disconnected");
          return { ok: failure !== "http", json: async () => { throw new Error("Invalid JSON"); } };
        }
        return { ok: true, json: async () => ({ items: [], statusUnavailable: false }) };
      },
    };
    const refresh = vm.runInNewContext(`${dashboard.slice(start, end)}\nrefreshTapRepairBriefing;`, context);
    await refresh();
    assert.equal(context.liveParRecommendations, null);
    assert.equal(context.tapRepairBriefing.unavailable, false);
    assert.equal(context.tapRepairBriefingLoading, false);
    assert.deepEqual(calls, ["/api/live-par", "/api/pmb-repair-queue"]);
    assert.equal(renders, 1);
  });
}

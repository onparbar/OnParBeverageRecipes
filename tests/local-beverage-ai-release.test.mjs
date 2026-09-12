import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { LOCAL_AI_COLUMNS, executeLocalAiTool, sanitizeLocalAiSnapshot } from "../lib/local-ai-data.mjs";
import { answerWithLocalAi, getLocalAiConfiguration } from "../lib/local-dashboard-ai.mjs";
import { captureLocalAiSnapshot } from "../public/local-ai-client.mjs";
import { answerLocalBeverageQuestion } from "../public/local-beverage-answers.mjs";
import { parseDashboardDataQuery } from "../public/global-dashboard-search.mjs";
import { verifyWeeklyReportZeros } from "../lib/pmb-weekly-zero-verification.mjs";
import { recoverLegacyInventoryCountReceipts } from "../public/inventory-count-receipts.mjs";

const labels = ["8/31/26 - 9/6/26", "8/24/26 - 8/30/26", "8/17/26 - 8/23/26", "8/10/26 - 8/16/26"];
const product = (tapNumber, values, name = "Angry Orchard 1", wall = "main") => ({
  id: String(tapNumber), name, tapNumber, wall, category: "beer", kegOz: 1000, profitPerOz: 0.5, sellingPricePerOz: 1,
  history: values.map((ounces, index) => ({ label: labels[index], ounces })),
});
const ready = { initialized: true, savePending: false, saveError: "", unsavedCount: 0 };
function context(items = [product(43, [100, 200, 300, 400]), product(82, [20, 30, 40, 50], "Angry Orchard 2", "karaoke")]) {
  return {
    usage: () => ({ labels, items }),
    inventory: () => ({ items: [], countedAt: {}, state: ready }),
    levels: () => [], recipes: () => [], prices: () => [], health: () => [{ name: "Inventory", state: ready }],
  };
}
const snapshot = () => captureLocalAiSnapshot(context());

test("regular three-week phrasing selects a total, not a name token or weekly average", () => {
  const query = "how much angry orchard have we poured in the last 3 weeks";
  const parsed = parseDashboardDataQuery(query);
  assert.equal(parsed.intent.weekCount, 3);
  assert.equal(parsed.intent.aggregation, "total");
  assert.deepEqual(parsed.intent.nameTerms, ["angry", "orchard"]);
  const result = answerLocalBeverageQuestion(query, context());
  assert.match(result.text, /690 oz total/);
  assert.equal(result.rows.length, 1);
});

test("usage totals deduplicate copies and flag conflicting readings instead of inventing zero", () => {
  const main = product(43, [100, 200, 300, 400]);
  const duplicate = structuredClone(main);
  assert.match(answerLocalBeverageQuestion("total Angry Orchard last 3 weeks", context([main, duplicate])).text, /600 oz total/);
  duplicate.history[0].ounces = 50;
  const answer = answerLocalBeverageQuestion("total Angry Orchard last 3 weeks", context([main, duplicate]));
  assert.match(answer.text, /500 oz recorded subtotal/);
  const data = captureLocalAiSnapshot(context([main, duplicate]));
  assert.equal(data.tables.usage.find((row) => row.weekIndex === 0).ounces, null);
});

test("zero-use answers require the full requested window to be verified", () => {
  const answer = answerLocalBeverageQuestion("what had zero pours last 3 weeks", context([
    product(1, [0, 0, 0, 0], "Verified Beer"), product(2, [0, null, 0, 0], "Unknown Beer"),
  ]));
  assert.deepEqual(answer.rows.map((row) => row.name), ["Verified Beer"]);
});

test("wall comparisons and equal-window trends report source periods", () => {
  const comparison = answerLocalBeverageQuestion("compare main and karaoke walls last 3 weeks", context());
  assert.equal(comparison.rows.length, 2);
  assert.equal(comparison.rows.find((row) => row.name === "main").value, 600);
  const trend = answerLocalBeverageQuestion("is Angry Orchard declining", context());
  assert.match(trend.rows[0].text, /230 oz to 120 oz/);
  assert.match(trend.rows[0].text, /down/);
});

test("AI query arithmetic uses all matching rows before result limits", () => {
  const data = sanitizeLocalAiSnapshot(snapshot());
  const result = executeLocalAiTool(data, "query_dashboard", { dataset: "usage", filters: [{ field: "weekIndex", op: "lt", value: 3 }],
    measures: [{ field: "ounces", op: "sum", as: "totalOz" }], limit: 1 });
  assert.equal(result.rows[0].totalOz, 690);
  assert.equal(result.rows[0].unknownCounts.totalOz, 0);
  assert.equal(result.matchedReadings, 6);
  assert.equal(executeLocalAiTool(data, "calculate", { operation: "percent_change", values: [0, 10] }).value, null);
});

test("AI datasets preserve unknowns, reject writes and invalid aggregate aliases", () => {
  const raw = snapshot();
  raw.tables.usage[0].ounces = null;
  raw.tables.usage[0].secret = "never pass through";
  const data = sanitizeLocalAiSnapshot(raw);
  assert.equal(data.tables.usage[0].secret, undefined);
  const result = executeLocalAiTool(data, "query_dashboard", { dataset: "usage", filters: [{ field: "weekIndex", op: "eq", value: 0 }],
    measures: [{ field: "ounces", op: "sum", as: "totalOz" }] });
  assert.equal(result.rows[0].unknownCounts.totalOz, 1);
  assert.throws(() => executeLocalAiTool(data, "run_sql", { query: "delete from inventory" }));
  for (const alias of ["readingCount", "unknownCounts", "constructor", "__proto__"]) {
    assert.throws(() => executeLocalAiTool(data, "query_dashboard", { dataset: "usage", measures: [{ field: "ounces", op: "sum", as: alias }] }));
  }
  assert.throws(() => sanitizeLocalAiSnapshot({ ...raw, capturedAt: "2020-01-01" }));
});

test("AI snapshot withholds stale inventory and unavailable tap readings", () => {
  const source = context();
  source.inventory = () => ({ state: ready, countedAt: {}, items: [{ id: "one", name: "Vodka", physicalCountRequired: true, onHandDisplay: "24", orderUnits: 5 }] });
  source.levels = () => [{ name: "Unknown tap", fraction: null, ounces: null }];
  const data = captureLocalAiSnapshot(source);
  assert.equal(data.tables.inventory[0].onHand, null);
  assert.equal(data.tables.inventory[0].orderUnits, null);
  assert.equal(data.tables.levels[0].fraction, null);
});

test("local inference is disabled by default and rejects cloud-model configuration", () => {
  assert.equal(getLocalAiConfiguration({}).enabled, false);
  assert.equal(getLocalAiConfiguration({ ONPAR_LOCAL_AI_ENABLED: "1", ONPAR_LOCAL_AI_MODEL: "model:cloud" }).enabled, false);
});

test("local model must read data before replying and cannot invoke write tools", async () => {
  const previous = globalThis.fetch;
  const seen = [];
  let turn = 0;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("http://127.0.0.1:11435/"));
    const body = JSON.parse(options.body);
    seen.push(body);
    if (String(url).endsWith("/show")) return Response.json({ details: { format: "gguf" }, model_info: { architecture: "test" }, capabilities: ["tools"] });
    turn += 1;
    if (turn === 1) return Response.json({ message: { content: "An unsupported answer without evidence." } });
    if (turn === 2) return Response.json({ message: {
      content: "",
      tool_calls: [{ function: {
        name: "query_dashboard",
        arguments: { dataset: "usage", filters: [{ field: "weekIndex", op: "eq", value: 0 }], measures: [{ field: "ounces", op: "sum", as: "totalOz" }] },
      } }],
    } });
    assert.equal(JSON.parse(body.messages.at(-1).content).rows[0].totalOz, 120);
    return Response.json({ message: { content: "120 oz recorded for the latest saved week." } });
  };
  try {
    const result = await answerWithLocalAi({ question: "How much last week?", snapshot: snapshot() }, { env: { ONPAR_LOCAL_AI_ENABLED: "1", ONPAR_LOCAL_AI_MODEL: "test:local" } });
    assert.equal(result.local, true);
    assert.equal(result.sources[0].matchedReadings, 2);
    assert.equal(turn, 3);
    assert.ok(seen[1].tools.every((tool) => ["query_dashboard", "calculate"].includes(tool.function.name)));
  } finally { globalThis.fetch = previous; }
});

test("local model aliases pointing to cloud are blocked before any question is sent", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith("/show"));
    return Response.json({ remote_host: "https://example.com", capabilities: ["tools"] });
  };
  try {
    await assert.rejects(answerWithLocalAi({ question: "usage?", snapshot: snapshot() }, { env: { ONPAR_LOCAL_AI_ENABLED: "1", ONPAR_LOCAL_AI_MODEL: "alias" } }), /Cloud models are not allowed/);
  } finally { globalThis.fetch = previous; }
});

test("historical zero verification requires full-period exact assignment coverage", () => {
  const item = { tapNumber: 7, plu: 123, name: "Beer 1", isCurrentTap: true, transactionCount: 0, volumeOz: 0, hasValue: false };
  const report = { startDate: "2026-09-14", endDate: "2026-09-20", transactionCount: 300, items: [item] };
  const tap = { ...item, deviceId: 2, lineNum: 3 };
  const options = { startTime: Date.parse("2026-09-14T04:00:00Z"), endTime: Date.parse("2026-09-21T04:00:00Z"), currentTaps: [tap],
    assignments: [{ ...tap, firstSeenAt: "2026-09-12T04:00:00Z", lastSeenAt: "2026-09-21T05:00:00Z" }] };
  assert.equal(verifyWeeklyReportZeros(report, options).items[0].zeroUsageVerified, true);
  options.assignments[0].firstSeenAt = "2026-09-17T04:00:00Z";
  assert.equal(verifyWeeklyReportZeros(report, options).items[0].hasValue, false);
  options.assignments[0].firstSeenAt = "2026-09-12T04:00:00Z";
  options.assignments[0].plu = 999;
  assert.equal(verifyWeeklyReportZeros(report, options).items[0].hasValue, false);
});

test("legacy receipts retain their original count date and never migrate modern cleared receipts", () => {
  const savedAt = "2026-09-07T19:59:26.559Z";
  const state = { current: { countedAt: savedAt, countedItemsAt: {} }, snapshots: [{ savedAt, captureMetadata: { capturedAt: savedAt, sourceFreshness: { inventory: "current" } }, items: [{ id: "vodka", onHandDisplay: "0" }] }] };
  assert.deepEqual(recoverLegacyInventoryCountReceipts(state), { vodka: savedAt });
  state.current.countEvidenceVersion = 1;
  assert.deepEqual(recoverLegacyInventoryCountReceipts(state), {});
});

test("browser AI timeout falls back; user cancellation does not reopen results", async () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function runLocalAiDashboardSearch()"), source.indexOf("function getLocalBeverageQuestionContext()"));
  for (const timeOut of [true, false]) {
    let timer, controller, fallback = 0, notice;
    const sandbox = {
      AbortController, clean: (value) => String(value || "").trim(),
      window: { setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout: () => {} },
      document: { createElement: () => ({}) },
      dashboardDataSearchInput: { value: "Angry Orchard" }, dashboardDataSearchFeedback: {},
      dashboardDataSearchResults: { prepend: (value) => { notice = value.textContent; } },
      setHeaderSearchResultsVisible: () => {}, getLocalBeverageQuestionContext: () => ({}),
      renderDashboardDataSearch: () => { fallback += 1; },
      requestLocalAiAnswer: ({ signal }) => new Promise((resolve, reject) => { controller = signal; signal.addEventListener("abort", () => reject(new Error("aborted"))); }),
    };
    vm.runInNewContext(`let dashboardAiController = null; let dashboardAiHistory = []; ${fn}; globalThis.run = runLocalAiDashboardSearch; globalThis.cancel = () => dashboardAiController.abort();`, sandbox);
    const running = sandbox.run();
    assert.ok(controller);
    if (timeOut) timer(); else sandbox.cancel();
    await running;
    assert.equal(fallback, timeOut ? 1 : 0);
    if (timeOut) assert.match(notice, /took too long/);
  }
});

test("all AI datasets have explicit field allowlists", () => {
  assert.deepEqual(Object.keys(snapshot().tables).sort(), Object.keys(LOCAL_AI_COLUMNS).sort());
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderWeeklyOrderView, WEEKLY_ORDER_STEPS } from "../public/weekly-order-view.mjs";

const completed = WEEKLY_ORDER_STEPS.map((step) => step.id);
const action = (html, name) => html.match(new RegExp(`<button\\b[^>]*data-weekly-order-action="${name}"[^>]*>`))?.[0];

test("weekly order starts immediately without an instruction list or route overview", () => {
  assert.deepEqual(completed, ["main", "karaoke", "patio", "liquor", "mixers", "other"]);
  assert.deepEqual(WEEKLY_ORDER_STEPS.map((step) => step.type), ["cooler", "cooler", "inventory", "inventory", "inventory", "inventory"]);
  const html = renderWeeklyOrderView({ screen: "start", weekLabel: "Week of October 12" });
  assert.match(html, /WEEKLY ORDER/);
  assert.match(html, /START HERE/);
  assert.match(html, /Week of October 12/);
  assert.ok(action(html, "start"));
  assert.equal(action(html, "resume"), undefined);
  assert.match(html, /data-weekly-order-action="start"[^>]*>Start<\/button>/);
  assert.doesNotMatch(html, /<ol|weekly-order-instructions|weekly-order-route/);
  assert.doesNotMatch(html, /cheese/i);
});

test("completed counts can be resumed, while a locked week only opens the saved plan", () => {
  assert.ok(action(renderWeeklyOrderView({ completed: ["main"] }), "resume"));
  assert.ok(action(renderWeeklyOrderView({ progressAvailable: true }), "resume"));
  const html = renderWeeklyOrderView({ screen: "main", planLocked: true, completed });
  assert.ok(action(html, "plan"));
  assert.match(html, /Open weekly plan/);
  for (const name of ["start", "resume", "next", "save"]) assert.equal(action(html, name), undefined);
  assert.doesNotMatch(html, /data-weekly-order-count=/);
});

test("every count screen shows its place in the route, one area, and a clear Next action", () => {
  for (const [index, step] of WEEKLY_ORDER_STEPS.entries()) {
    const html = renderWeeklyOrderView({ screen: step.id, rows: [{ id: "one", name: "One item", unit: "bottles", value: 2 }] });
    assert.match(html, new RegExp(`Step ${index + 1} of 7`));
    assert.ok(html.includes(step.title));
    assert.match(html, /class="weekly-order-title"[^>]*tabindex="-1"/);
    assert.ok(action(html, "back"));
    assert.ok(action(html, "next"));
    assert.match(html, /data-weekly-order-action="next"[^>]*>Next<\/button>/);
    assert.equal((html.match(/data-weekly-order-count=/g) || []).length, 1);
  }
});

test("cooler counts keep clear backup units and an actual zero without long instructions", () => {
  const html = renderWeeklyOrderView({ screen: "main", rows: [{ id: "tap-1", name: "Main lager", detail: "Patio · Tap 1", unit: "full backup kegs", value: 0 }] });
  assert.doesNotMatch(html, /weekly-order-help|Next saves|Do not include/);
  assert.match(html, /Patio · Tap 1/);
  assert.match(html, /data-weekly-order-count="tap-1"[^>]*value="0"/);
  assert.match(html, /inputmode="numeric"/);
  assert.match(html, /full backup kegs/);
  assert.doesNotMatch(html, /placeholder="0"/);
  assert.doesNotMatch(html, /For rows labeled ounces/);
});

test("mixed cooler counts retain keg and ounce units beside their fields", () => {
  const html = renderWeeklyOrderView({ screen: "main", rows: [
    { id: "keg", name: "Lager", unit: "full backup kegs", value: 2 },
    { id: "on-deck", name: "Next cocktail", unit: "ounces", value: 48, allowsDecimal: true },
  ] });
  assert.match(html, /weekly-order-unit[^>]*>full backup kegs</);
  assert.match(html, /weekly-order-unit[^>]*>ounces</);
  assert.match(html, /inputmode="decimal"/);
});

test("Karaoke keeps Simple Syrup after keg counts in one list with clear units and unique fields", () => {
  const html = renderWeeklyOrderView({ screen: "karaoke", rows: [
    { id: "keg:one", kind: "keg", name: "Karaoke lager", unit: "full backup kegs", value: "2" },
    { id: "simple-syrup", kind: "inventory", name: "Simple Syrup", detail: "Karaoke cooler.", unit: "1-gallon containers", value: "3" },
  ] });
  assert.match(html, /weekly-order-unit[^>]*>full backup kegs</);
  assert.match(html, /weekly-order-unit[^>]*>1-gallon containers</);
  assert.match(html, /Karaoke cooler\./);
  assert.doesNotMatch(html, /Also check in this cooler|Count Simple Syrup/);
  assert.ok(html.indexOf('data-weekly-order-count="keg:one"') < html.indexOf('data-weekly-order-count="simple-syrup"'));
  assert.equal((html.match(/data-weekly-order-count="simple-syrup"/g) || []).length, 1);
  const inputIds = [...html.matchAll(/<input id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(inputIds.length, 2);
  assert.equal(new Set(inputIds).size, inputIds.length);
  for (const id of inputIds) assert.ok(html.includes(`label for="${id}"`));
});

test("a cooler containing only Simple Syrup does not describe its count as a keg", () => {
  const html = renderWeeklyOrderView({ screen: "karaoke", rows: [
    { id: "simple-syrup", kind: "inventory", name: "Simple Syrup", unit: "1-gallon containers", value: "0" },
  ] });
  assert.match(html, /weekly-order-unit[^>]*>1-gallon containers</);
  assert.doesNotMatch(html, /full backup kegs|No items here/i);
  assert.equal((html.match(/data-weekly-order-count=/g) || []).length, 1);
});

test("inventory counts keep per-item units, decimals, and missing counts distinct from zero", () => {
  const html = renderWeeklyOrderView({ screen: "other", rows: [
    { id: "beer", name: "NA lager", unit: "cans", value: 0 },
    { id: "partial", name: "Partial bottle", detail: "Include opened bottles", unit: "bottles", value: 1.5, allowsDecimal: true },
    { id: "unknown", name: "Not counted", unit: "bottles", value: null },
  ] });
  assert.match(html, /Verify non-alcoholic beer/);
  assert.match(html, /Check counts\. Enter 0 for none\./);
  assert.match(html, /data-weekly-order-count="partial"[^>]*value="1.5"/);
  assert.match(html, /inputmode="decimal"/);
  assert.match(html, /data-weekly-order-count="unknown"[^>]*value=""/);
  assert.match(html, />cans<|>\s*cans\s*</);
  assert.match(html, />bottles<|>\s*bottles\s*</);
});

test("review requires all six verified areas and explains that saving does not place orders", () => {
  const unfinished = renderWeeklyOrderView({ screen: "review", completed: ["main", "main", "karaoke", "liquor", "mixers", "unrelated"] });
  assert.match(action(unfinished, "save"), /disabled/);
  assert.match(unfinished, /Still needs checking/);
  const html = renderWeeklyOrderView({ screen: "review", completed });
  assert.doesNotMatch(action(html, "save"), /disabled/);
  assert.match(html, /Step 7 of 7/);
  for (const step of WEEKLY_ORDER_STEPS) assert.ok(html.includes(`data-weekly-order-step="${step.id}"`));
  assert.match(html, /Save weekly plan/);
  assert.match(html, /Saving does not place orders/);
});

test("Patio directs the person to Korbel bottles and remains required after the other locations are verified", () => {
  const html = renderWeeklyOrderView({ screen: "patio", rows: [
    { id: "korbel-brut", name: "Champagne (Korbel Brut)", unit: "bottles", value: "0" },
  ] });
  assert.match(html, /Verify patio cooler/);
  assert.match(html, /Go to the patio cooler\. Count the Korbel Brut bottles and enter 0 if none\./);
  assert.match(html, /Step 3 of 7/);
  assert.match(html, /aria-valuemax="7"/);
  assert.match(html, /data-weekly-order-count="korbel-brut"[^>]*value="0"/);
  assert.doesNotMatch(html, /full backup kegs|Verify non-alcoholic beer/);
  const review = renderWeeklyOrderView({ screen: "review", completed: completed.filter((id) => id !== "patio") });
  assert.match(action(review, "save"), /disabled/);
  assert.match(review, /data-weekly-order-step="patio"[^>]*>Check</);
});

test("busy prevents duplicate actions and changes while errors stay readable and retryable", () => {
  const model = { screen: "liquor", rows: [{ id: "gin", name: "Gin", unit: "bottles", value: 2 }], error: "Counts could not save. Check your connection." };
  const html = renderWeeklyOrderView(model);
  assert.match(html, /weekly-order-feedback[^>]*role="alert"/);
  assert.match(html, /Counts could not save/);
  assert.match(html, /data-weekly-order-action="next"[^>]*>Next<\/button>/);
  assert.doesNotMatch(action(html, "next"), /disabled/);
  const busy = renderWeeklyOrderView({ ...model, busy: true });
  for (const tag of busy.match(/<(?:input|button)\b[^>]*>/g)) assert.match(tag, /disabled/);
  assert.match(busy, /aria-busy="true"/);
  const waiting = renderWeeklyOrderView({ ...model, ready: false });
  assert.match(action(waiting, "next"), /disabled/);
  assert.doesNotMatch(action(waiting, "back"), /disabled/);
});

test("review correction reasons remain editable and become read-only during saving", () => {
  const html = renderWeeklyOrderView({ screen: "review", completed, needsReason: true, reason: "Counted unopened stock" });
  assert.match(html, /textarea[^>]*data-weekly-order-reason[^>]*required/);
  assert.match(html, /Counted unopened stock/);
  const busy = renderWeeklyOrderView({ screen: "review", completed, needsReason: true, busy: true });
  assert.match(busy, /textarea[^>]*disabled/);
  assert.match(action(busy, "save"), /disabled/);
});

test("live refresh can reveal a saved plan or late-count reason without replacing typed counts", () => {
  for (const screen of ["main", "review"]) {
    const html = renderWeeklyOrderView({ screen, completed });
    assert.match(action(html, "plan"), /hidden/);
    assert.match(html, /data-weekly-order-status/);
  }
  const review = renderWeeklyOrderView({ screen: "review", completed, needsReason: false });
  assert.match(review, /data-weekly-order-reason-field hidden/);
  assert.match(review, /data-weekly-order-reason rows=/);
  assert.doesNotMatch(review.match(/<textarea[^>]*>/)[0], /required/);
});

test("all supplied text and attributes are escaped, including row IDs and reasons", () => {
  const hostile = '\"><script>alert("x")</script>&';
  const count = renderWeeklyOrderView({ screen: "mixers", weekLabel: hostile, error: hostile, rows: [{ id: hostile, name: hostile, detail: hostile, unit: hostile, value: hostile }] });
  const empty = renderWeeklyOrderView({ screen: "main", emptyMessage: hostile });
  const review = renderWeeklyOrderView({ screen: "review", completed, needsReason: true, reason: '</textarea><script>alert("x")</script>' });
  for (const html of [count, empty, review]) {
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  }
  assert.match(count, /data-weekly-order-count="&quot;&gt;&lt;script&gt;/);
  assert.match(review, /&lt;\/textarea&gt;/);
});

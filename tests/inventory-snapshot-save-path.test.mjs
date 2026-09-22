import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return source.slice(start, end + 2);
}

test("snapshot save reuses one trusted inventory read through calculation and commit", () => {
  const coordinator = functionSource("saveInventorySnapshot");
  const attempt = functionSource("saveInventorySnapshotAttempt");

  assert.match(coordinator, /snapshotBaseState: latest/);
  assert.match(attempt, /calculationBaseState = snapshotBaseState \|\| await refreshInventoryRevisionForSnapshot\(\)/);
  assert.match(attempt, /snapshotBaseState: calculationBaseState/);
  assert.equal((attempt.match(/refreshInventoryRevisionForSnapshot\(\)/g) || []).length, 1);
});

test("snapshot actions receive a stable id before entering durable recovery", () => {
  const stage = functionSource("stageInventoryActionOutbox");
  assert.match(stage, /entry\.payload\.captureId = entry\.id/);
});

test("the snapshot commit deadline outlasts the shared store deadline", () => {
  const request = functionSource("requestSharedInventory");
  assert.match(source, /const INVENTORY_SNAPSHOT_REQUEST_TIMEOUT_MS = 20000/);
  assert.match(request, /body\?\.action === "save-snapshot"/);
  assert.match(request, /INVENTORY_SNAPSHOT_REQUEST_TIMEOUT_MS/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAssistedOrderView } from "../public/assisted-order-direct-ui.mjs";
import { buildOrderRehearsalModel } from "../public/order-rehearsal.mjs";

function sourceModel(blockers = []) {
  const vendors = ["Bonbright", "Heidelberg", "Proof", "OHLQ"];
  const drafts = vendors.map((vendor, index) => ({
    id: `locked-${vendor.toLowerCase()}`,
    generatedAt: "2026-08-24T12:00:00.000Z",
    sourceDate: "2026-08-24",
    vendor,
    confirmationRecipient: "samantha@onparbar.com",
    lines: [{
      id: `item-${index}`,
      internalId: `item-${index}`,
      productName: `${vendor} Product`,
      vendorSku: vendor === "Bonbright" ? "" : `SKU-${index}`,
      requestedUnits: index + 1,
      requestedCases: vendor === "Heidelberg" || vendor === "Proof" ? 1 : null,
      packSize: 1,
      unitCost: 10,
      extendedCost: 10 * (index + 1),
      reason: "Locked Weekly Plan need.",
      sourceDate: "2026-08-24",
      blockers: index === 1 ? blockers : [],
      warnings: [],
    }],
    lineCount: 1,
    estimatedTotal: 10 * (index + 1),
    substitutionsAllowed: false,
    blockers: index === 1 ? blockers : [],
    warnings: [],
    canApprove: blockers.length === 0,
    status: blockers.length && index === 1 ? "blocked" : "ready",
  }));
  return {
    generatedAt: "2026-08-24T12:00:00.000Z",
    sourceDate: "2026-08-24",
    schedule: { status: "open", label: "Ordering open", blockers: [], warnings: [] },
    weeklyTotal: 100,
    drafts,
  };
}

test("rehearsal mirrors the latest locked Weekly Plan across all vendor paths", () => {
  const source = sourceModel();
  const model = buildOrderRehearsalModel(source);
  assert.equal(model.generatedAt, source.generatedAt);
  assert.deepEqual(model.drafts.map((draft) => draft.vendor), ["Bonbright", "Heidelberg", "Proof", "OHLQ"]);
  assert.notEqual(model.drafts[0], source.drafts[0]);
  assert.deepEqual(model.drafts[0].lines, source.drafts[0].lines);
  model.drafts.forEach((draft) => {
    const saved = model.savedDrafts.find((entry) => entry.id === draft.id);
    const view = buildAssistedOrderView(draft, saved, { rehearsal: true });
    assert.equal(view.order.actionsEnabled, true);
    assert.equal(view.order.rehearsal, true);
    assert.equal(view.vendorPath, null);
  });
  assert.equal(
    buildAssistedOrderView(model.drafts[1], model.savedDrafts[1], { rehearsal: true }).vendorActionLabel,
    "Fill BEES rehearsal cart",
  );
});

test("rehearsal keeps locked-plan data blockers in force", () => {
  const blocker = { code: "MISSING_SKU", message: "Vendor SKU is required." };
  const model = buildOrderRehearsalModel(sourceModel([blocker]));
  const view = buildAssistedOrderView(model.drafts[1], model.savedDrafts[1], { rehearsal: true });
  assert.equal(view.order.actionsEnabled, false);
  assert.equal(model.canApproveAll, false);
});

test("rehearsal model has no network, storage, or vendor destination behavior", async () => {
  const source = await readFile(new URL("../public/order-rehearsal.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|https?:\/\//i);
});

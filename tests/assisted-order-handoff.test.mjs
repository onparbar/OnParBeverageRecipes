import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistedOrderActivity,
  createAssistedOrderHandoff,
  createAuthoritativeAssistedOrderHandoff,
  createAssistedOrderId,
  formatBonbrightMessage,
  getBonbrightTextWindowStatus,
  groupAssistedOrders,
  transitionAssistedOrder,
} from "../public/assisted-order-handoff.mjs";

function validLine(overrides = {}) {
  return {
    internalItemId: "item-1",
    name: "Modelo",
    vendorSku: "BB-101",
    requestedCases: 1,
    packSize: "1/2 bbl keg",
    unitCost: 143,
    reason: "Below locked par after Monday inventory",
    inventoryKnown: true,
    ...overrides,
  };
}

function validDraft(overrides = {}) {
  return {
    vendor: "Bonbright",
    planId: "week-2026-08-17",
    sourceDataDate: "2026-08-17",
    lines: [validLine()],
    ...overrides,
  };
}

const readyContext = { lockedPlan: true, approved: true };

test("formats the familiar Bonbright message without contact automation", () => {
  const order = createAssistedOrderHandoff(
    validDraft({
      lines: [
        validLine({ name: "Guinness 1", requestedCases: 1 }),
        validLine({
          internalItemId: "item-2",
          name: "Astra Red Cream Soda (Beer)",
          vendorSku: "BB-102",
          requestedCases: 3,
        }),
      ],
    }),
    readyContext,
  );
  assert.equal(
    formatBonbrightMessage(order),
    "Heyy TJ-\n\nThis week, we would like to order the following:\n\n1 Guinness\n3 Astra Red Cream Soda\n\nI appreciate you!",
  );
});

test("enforces the Bonbright 9:00 AM through 7:30 PM Eastern window", () => {
  assert.equal(
    getBonbrightTextWindowStatus(new Date("2026-08-17T13:00:00Z")).allowed,
    true,
  );
  assert.equal(
    getBonbrightTextWindowStatus(new Date("2026-08-17T23:30:00Z")).allowed,
    true,
  );
  assert.deepEqual(
    getBonbrightTextWindowStatus(new Date("2026-08-17T23:31:00Z")),
    {
      allowed: false,
      label: "Send after 9:00 AM",
      timeZone: "America/New_York",
    },
  );
});

test("creates stable idempotency IDs independent of line order", () => {
  const first = validLine();
  const second = validLine({ internalItemId: "item-2", vendorSku: "BB-102" });
  const base = { vendor: "Bonbright", planId: "week-1" };
  assert.equal(
    createAssistedOrderId({ ...base, lines: [first, second] }),
    createAssistedOrderId({ ...base, lines: [second, first] }),
  );
});

test("groups vendor orders and totals exact extended costs", () => {
  const result = groupAssistedOrders(
    [
      validDraft(),
      validDraft({
        vendor: "Heidelberg",
        lines: [validLine({ unitCost: 171, vendorSku: "HD-1" })],
      }),
    ],
    readyContext,
  );
  assert.equal(result.orders.length, 2);
  assert.equal(result.expectedTotal, 314);
  assert.equal(result.blockedCount, 0);
});

test("blocks stale plans and missing required line data without treating it as zero", () => {
  const order = createAssistedOrderHandoff(
    validDraft({
      sourceDataDate: "",
      lines: [{ name: "Unknown product", requestedCases: 1 }],
    }),
    { lockedPlan: true, stale: true },
  );
  assert.equal(order.status, "blocked");
  assert.equal(order.preview, true);
  assert.match(order.blockers.join(" "), /Source data date is missing/);
  assert.match(order.blockers.join(" "), /vendor SKU is missing/);
  assert.match(order.blockers.join(" "), /pricing is missing/);
  assert.match(order.blockers.join(" "), /source data is stale/);
});

test("Proof warns below $350 and blocks unjustified or non-shelf-stable top-ups", () => {
  const order = createAssistedOrderHandoff(
    validDraft({
      vendor: "Proof",
      lines: [
        validLine({
          name: "Shelf mixer",
          vendorSku: "PR-1",
          unitCost: 100,
          isTopUp: true,
          shelfStable: false,
          planJustified: false,
        }),
      ],
    }),
    readyContext,
  );
  assert.equal(order.status, "blocked");
  assert.match(order.blockers.join(" "), /must be shelf stable/);
  assert.match(order.blockers.join(" "), /locked prep plan/);
  assert.match(order.warnings.join(" "), /\$250\.00 below/);
});

test("applies OHLQ case, size, retirement, and no-substitution rules", () => {
  const order = createAssistedOrderHandoff(
    validDraft({
      vendor: "OHLQ",
      lines: [
        validLine({ name: "Buffalo Trace", vendorSku: "OH-1", requestedCases: null, requestedUnits: 6, packSize: "750 mL" }),
        validLine({ name: "Absolut Raspberri", vendorSku: "OH-2", packSize: "1 L" }),
        validLine({ name: "Don Julio", vendorSku: "OH-3", packSize: "750 mL" }),
        validLine({ name: "Apple Pucker", vendorSku: "OH-4" }),
        validLine({ name: "Replacement", vendorSku: "OH-5", isSubstitution: true }),
      ],
    }),
    readyContext,
  );
  const issues = order.blockers.join(" ");
  assert.match(issues, /units of 12/);
  assert.match(issues, /Raspberri 1L is unavailable/);
  assert.match(issues, /larger Don Julio size/);
  assert.match(issues, /retired products cannot be ordered/);
  assert.match(issues, /substitutions are not allowed/);
});

test("supports one reviewed-to-manually-completed handoff without duplicate completion", () => {
  const reviewed = createAssistedOrderHandoff(validDraft(), readyContext);
  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.actionsEnabled, true);
  const opened = transitionAssistedOrder(reviewed, "opened_vendor", {
    actor: "Samantha",
    timestamp: "2026-08-17T14:00:00.000Z",
  });
  const completed = transitionAssistedOrder(opened, "manually_completed", {
    actor: "Samantha",
    timestamp: "2026-08-17T14:05:00.000Z",
  });
  const duplicate = transitionAssistedOrder(completed, "manually_completed");
  assert.equal(completed.completionKey, `${reviewed.id}:manually_completed`);
  assert.equal(duplicate.duplicate, true);
});

test("activity records omit messages, phone numbers, credentials, and full responses", () => {
  const order = createAssistedOrderHandoff(validDraft(), readyContext);
  const activity = buildAssistedOrderActivity(order, "opened_vendor", {
    actor: "Samantha",
    vendorResponse: {
      status: "opened",
      code: "OK",
      requestId: "request-1",
      body: "secret response body",
      password: "secret",
    },
  });
  const serialized = JSON.stringify(activity);
  assert.doesNotMatch(serialized, /secret|password|phone|Heyy TJ/);
  assert.equal(activity.vendorResponse.requestId, "request-1");
});

test("preserves authoritative draft identity, quantities, packs, prices, and reasons", () => {
  const order = createAuthoritativeAssistedOrderHandoff({
    id: "draft-proof-1",
    generatedAt: "2026-08-17T14:00:00.000Z",
    sourceDate: "2026-08-17T13:30:00.000Z",
    vendor: "Proof",
    blockers: [],
    warnings: [],
    lines: [{
      internalId: "lime-juice",
      productName: "Finest Call Lime Juice 1L",
      lineType: "Mixer",
      vendorSku: "437071",
      requestedUnits: 24,
      requestedCases: 2,
      packSize: 12,
      unitCost: 5.19,
      extendedCost: 124.56,
      reason: "Locked prep replacement.",
      sourceDate: "2026-08-17T13:30:00.000Z",
    }],
  }, { approvedAt: "2026-08-17T15:00:00.000Z", status: "reviewed" });
  const line = order.lines[0];
  assert.equal(order.id, "draft-proof-1");
  assert.equal(order.status, "reviewed");
  assert.equal(line.internalItemId, "lime-juice");
  assert.equal(line.productName, "Finest Call Lime Juice 1L");
  assert.equal(line.vendorSku, "437071");
  assert.equal(line.requestedUnits, 24);
  assert.equal(line.requestedCases, 2);
  assert.equal(line.packSize, "12");
  assert.equal(line.unitCost, 5.19);
  assert.equal(line.extendedCost, 124.56);
  assert.equal(line.reason, "Locked prep replacement.");
});

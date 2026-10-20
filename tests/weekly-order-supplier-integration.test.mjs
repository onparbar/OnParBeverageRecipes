import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildAssistedOrderView } from "../public/assisted-order-direct-ui.mjs";
import { clean, escapeHtml, formatNumber, money, sum, toNumber } from "../public/dashboard-formatters.mjs";
import { renderFinishWeekDeliveries } from "../public/finish-week-view.mjs";
import { renderSupplierOrderFlow } from "../public/weekly-order-supplier-flow.mjs";

const dashboard = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const generatedAt = "2026-10-12T16:00:00.000Z";

function source(name) {
  const start = dashboard.search(new RegExp(`^function ${name}\\(`, "m"));
  assert.ok(start >= 0, `${name} exists in the dashboard`);
  return dashboard.slice(start, dashboard.indexOf("\n}\n", start) + 2);
}

function line(name, requestedUnits, overrides = {}) {
  return {
    internalId: name.toLowerCase().replaceAll(" ", "-"), productName: name,
    lineType: "Beer keg", requestedUnits, packSize: 1, unitCost: 100,
    extendedCost: requestedUnits * 100, vendorSku: "sku", ...overrides,
  };
}

function draft(vendor, lines, overrides = {}) {
  return {
    id: `draft-${vendor.toLowerCase()}-hash`, vendor, generatedAt,
    status: "ready", sourceDate: "2026-10-11", lines, lineCount: lines.length,
    estimatedTotal: lines.reduce((total, entry) => total + entry.extendedCost, 0),
    blockers: [], warnings: [], ...overrides,
  };
}

function fixture(drafts, { tracking = {}, rehearsal = false, savedDrafts = [], message = "" } = {}) {
  const model = { drafts, savedDrafts, weeklyTotal: drafts.reduce((total, entry) => total + entry.estimatedTotal, 0) };
  const context = {
    clean, escapeHtml, formatNumber, money, sum, toNumber, buildAssistedOrderView, renderFinishWeekDeliveries,
    orderRehearsalMode: rehearsal, weeklyOrderTrackingMessage: message,
    dashboardFinishWeekActor: "Fallback manager", dashboardFinishWeekSaving: false,
    onParDashboardIdentity: { name: "Sam" }, currentVendorOrderDraftViews: new Map(),
    weeklyOrderTracking: {
      vendors: drafts.map((entry) => ({ id: `tracking-${entry.vendor}`, vendor: entry.vendor, ordered: false, items: [] })),
      drafts: [], adjustmentCatalog: [], adjustments: [], ...tracking,
    },
    getVendorOrderDraftModel: () => model,
  };
  vm.runInContext([
    "renderVendorOrderAdjustments", "renderAssistedOrderPanel", "getVendorWorkflowState", "renderVendorOrderDraftWorkspace",
  ].map(source).join("\n"), vm.createContext(context));
  return { context, model, render: (guided = true) => context.renderVendorOrderDraftWorkspace({}, {}, model, { guided }) };
}

// Nested handoff sections make a closing-tag regex unsafe. Split at the actual
// supplier-card opening tag so every assertion stays within one supplier.
function cards(html) {
  return html.split(/(?=<section class="vendor-order-draft-card\s)/).slice(1);
}

function button(html, attribute) {
  return html.match(new RegExp(`<button[^>]*${attribute}[^>]*>`))?.[0] || "";
}

test("guided cards keep every supplier, original totals, keg quantities, and cooler destinations", () => {
  const drafts = [
    draft("Bonbright", [
      line("Lager", 2, { kegDestinations: ["Main", { cooler: "Main" }, { wall: "Karaoke" }] }),
      line("IPA", 3),
    ]),
    draft("Proof", [line("Lime Juice", 12, { lineType: "Mixer", requestedCases: 2, packSize: 6, extendedCost: 60 })]),
  ];
  const f = fixture(drafts);
  const before = structuredClone(f.model);
  const html = f.render();
  const [beer, proof] = cards(html);
  assert.equal(cards(html).length, 2);
  assert.match(beer, /data-supplier-order-card="Bonbright" data-supplier-order-placed="false" hidden/);
  assert.match(proof, /data-supplier-order-card="Proof" data-supplier-order-placed="false" hidden/);
  assert.match(beer, /5 kegs · \$500\.00/);
  assert.match(beer, /2 kegs · Main cooler · Karaoke cooler/);
  assert.doesNotMatch(beer, /Main cooler · Main cooler/);
  assert.match(proof, /1 item · \$60\.00/);
  assert.match(proof, /2 cases/);
  assert.match(html, /Weekly order total: \$560\.00/);
  assert.deepEqual(f.model, before);
  assert.deepEqual([...f.context.currentVendorOrderDraftViews.keys()], drafts.map((entry) => entry.id));

  const legacy = f.render(false);
  assert.doesNotMatch(legacy, /data-supplier-order-card/);
  assert.match(legacy, /<strong>3 items<\/strong><span>\$560\.00<\/span>/);
});

test("supplier screens retain the existing handoff, placement identity, and manager", () => {
  const drafts = ["Bonbright", "Heidelberg", "Proof", "OHLQ"].map((vendor) => draft(vendor, [line(`${vendor} product`, 4)]));
  const f = fixture(drafts, { tracking: { drafts: [{ id: drafts[2].id, approvedAt: generatedAt, openedAt: generatedAt }] } });
  const rendered = cards(f.render());
  for (let index = 0; index < drafts.length; index++) {
    const entry = drafts[index];
    const place = button(rendered[index], "data-weekly-order-place");
    assert.match(place, new RegExp(`data-weekly-order-vendor-id="tracking-${entry.vendor}"`));
    assert.match(place, new RegExp(`data-weekly-order-draft-id="${entry.id}"`));
    assert.match(place, /data-weekly-ordered-by="Sam"/);
    assert.doesNotMatch(place, / disabled/);
    assert.equal(f.context.currentVendorOrderDraftViews.get(entry.id).order.actionsEnabled, true);
  }
  assert.match(rendered[0], /data-assisted-order-copy="draft-bonbright-hash"/);
  assert.match(rendered[1], /data-assisted-order-open="draft-heidelberg-hash"[^>]*>Approve &amp; open BEES/);
  assert.match(rendered[2], /Reopen supplier or copy order again/);
  assert.match(rendered[2], /data-assisted-order-open="draft-proof-hash"[^>]*>Open Proof/);
  assert.match(rendered[3], /data-assisted-order-open="draft-ohlq-hash"[^>]*>Approve &amp; open OHLQ/);
});

test("blocked and untracked suppliers cannot be marked placed, and issues remain escaped", () => {
  const blocked = draft("Proof", [line("Blocked product", 1)], {
    blockers: [{ message: "Verify <price> & quantity" }], warnings: [{ message: "Check <deadline>" }],
  });
  const missing = draft("OHLQ", [line("Untracked product", 1)]);
  const f = fixture([blocked, missing], { tracking: { vendors: [{ id: "proof-id", vendor: "Proof", ordered: false }] } });
  const [proof, ohlq] = cards(f.render());
  assert.match(button(proof, "data-weekly-order-place"), / disabled/);
  assert.match(button(proof, "data-assisted-order-open"), / disabled/);
  assert.match(proof, /Verify &lt;price&gt; &amp; quantity/);
  assert.match(proof, /Check &lt;deadline&gt;/);
  assert.match(button(ohlq, "data-weekly-order-place"), /data-weekly-order-vendor-id=""/);
  assert.match(button(ohlq, "data-weekly-order-place"), / disabled/);
  assert.equal(f.context.currentVendorOrderDraftViews.get(blocked.id).order.actionsEnabled, false);
});

test("placed suppliers keep pending, partial, and received delivery behavior on their own screen", () => {
  const order = draft("Heidelberg", [line("Lager", 2), line("IPA", 3)]);
  const f = fixture([order], { tracking: {
    drafts: [{ id: order.id, approvedAt: generatedAt }],
    vendors: [{ id: "beer-receipt", vendor: "Heidelberg", ordered: true, items: [
      { id: "pending-lager", name: "Lager", quantity: 2, unit: "kegs", status: "pending" },
      { id: "partial-ipa", name: "IPA", quantity: 3, receivedQuantity: 1, unit: "kegs", status: "partial" },
      { id: "received-na", name: "Non-alcoholic beer", quantity: 1, receivedQuantity: 1, unit: "case", packSize: 24, status: "received" },
    ] }],
  } });
  const html = f.render();
  assert.match(html, /data-supplier-order-card="Heidelberg" data-supplier-order-placed="true" hidden/);
  assert.match(html, /View order and receive delivery/);
  assert.match(html, /data-finish-delivery-item="pending-lager" data-vendor-id="beer-receipt" data-quantity="2"/);
  assert.match(html, /2 kegs to receive/);
  assert.match(html, /1 of 3 received \(partial\)/);
  assert.match(html, /href="\/staff">Update delivery in Staff View/);
  assert.match(html, /2 cases of 12 received/);
  assert.doesNotMatch(html, /data-finish-delivery-item="(?:partial-ipa|received-na)"/);
  assert.doesNotMatch(html, /data-weekly-order-place|data-assisted-order-(?:copy|open)/);
  assert.equal(f.context.currentVendorOrderDraftViews.size, 0);
  f.context.dashboardFinishWeekSaving = true;
  assert.match(f.render(), /<input[^>]*data-finish-delivery-item="pending-lager"[^>]* disabled>/);

  f.context.weeklyOrderTracking.vendors[0].items.forEach((item) => { item.status = "received"; });
  const complete = f.render();
  assert.match(complete, /View received order/);
  assert.doesNotMatch(complete, /data-finish-delivery-item/);
});

test("rehearsal uses rehearsal history and retains practice handoffs without live placement or receiving", () => {
  const order = draft("Proof", [line("Juice", 4)]);
  const f = fixture([order], {
    rehearsal: true, savedDrafts: [{ id: order.id, approvedAt: generatedAt }],
    tracking: {
      drafts: [{ id: order.id, completedAt: generatedAt }],
      vendors: [{ id: "live-proof", vendor: "Proof", ordered: true, items: [{ id: "live-delivery", status: "pending" }] }],
    },
  });
  const html = f.render(false);
  assert.match(html, /Copy rehearsal list/);
  assert.match(html, /Fill Proof rehearsal cart/);
  assert.doesNotMatch(html, /data-weekly-order-place|data-finish-delivery-item|data-supplier-order-card/);
  const view = f.context.currentVendorOrderDraftViews.get(order.id);
  assert.equal(view.order.rehearsal, true);
  assert.equal(view.order.status, "reviewed");
  assert.equal(view.order.actionsEnabled, true);
});

test("global adjustments retain absent suppliers and exclude placed suppliers", () => {
  const f = fixture([draft("Bonbright", [line("Lager", 1)])], { tracking: {
    vendors: [{ id: "placed-proof", vendor: "Proof", ordered: true }],
    adjustmentCatalog: [
      { catalogId: "new-ohlq", vendor: "OHLQ", name: "Vodka", orderable: true, quantityUnit: "bottles", currentPlanQuantity: 0 },
      { catalogId: "placed-proof", vendor: "Proof", name: "Juice", orderable: true, quantityUnit: "cases" },
    ],
    adjustments: [{ catalogId: "new-ohlq", vendor: "OHLQ", name: "Vodka", quantity: 2, quantityUnit: "bottles", reason: "Event", adjustedBy: "Sam" }],
  } });
  const html = f.render(false);
  assert.ok(html.indexOf("data-order-adjustment-panel") < html.indexOf("vendor-order-drafts__grid"));
  assert.equal(html.split("data-order-adjustment-panel").length - 1, 1);
  assert.match(html, /<option value="OHLQ">OHLQ<\/option>/);
  assert.match(html, /value="new-ohlq"[^>]*data-order-adjustment-current-quantity="2"/);
  assert.match(html, /data-order-adjustment-remove="new-ohlq"/);
  assert.doesNotMatch(html, /value="placed-proof"|<option value="Proof">/);
});

test("zero drafts preserve adjustments and status inside the supplier flow before prep", () => {
  const f = fixture([], { message: "Order <updated>", tracking: {
    adjustmentCatalog: [{ catalogId: "vodka", vendor: "OHLQ", name: "Vodka", orderable: true, quantityUnit: "bottles" }],
  } });
  const workspace = f.render();
  const html = renderSupplierOrderFlow({ ordersHtml: workspace, prepHtml: '<input data-finish-prep-item="cocktail" type="checkbox">' });
  assert.match(html, /Order &lt;updated&gt;/);
  assert.match(html, /data-order-adjustment-panel/);
  assert.match(html, /data-order-adjustment-save/);
  assert.match(html, /data-supplier-order-empty hidden>No supplier orders to show/);
  assert.match(html, /data-finish-prep-item="cocktail"/);
  assert.doesNotMatch(html, /data-supplier-order-card|data-weekly-order-place/);
  assert.equal(f.context.currentVendorOrderDraftViews.size, 0);
});


test("guided supplier adjustments contain only that supplier's products and saved changes", () => {
  const vendors = ["Heidelberg", "Bonbright", "Proof"];
  const catalog = vendors.map((vendor) => ({ catalogId: `${vendor}-item`, vendor, name: `${vendor} product`, orderable: true, quantityUnit: "kegs", currentPlanQuantity: 1 }));
  catalog.push({ catalogId: "unavailable-heidelberg", vendor: "Heidelberg", name: "Missing price", orderable: false });
  const adjustments = vendors.map((vendor) => ({ catalogId: `${vendor}-item`, vendor, name: `${vendor} product`, quantity: 2, quantityUnit: "kegs", reason: "Extra backup", adjustedBy: "Sam" }));
  const f = fixture(vendors.map((vendor) => draft(vendor, [line(`${vendor} product`, 1)])), { tracking: { adjustmentCatalog: catalog, adjustments } });
  const html = f.render();
  assert.doesNotMatch(html.split(/(?=<section class="vendor-order-draft-card\s)/)[0], /data-order-adjustment-panel/);
  for (const [index, card] of cards(html).entries()) {
    const vendor = vendors[index];
    assert.match(card, new RegExp(`data-order-adjustment-panel data-order-adjustment-vendor="${vendor}"`));
    assert.match(card, new RegExp(`value="${vendor}-item"[^>]*data-order-adjustment-current-quantity="2"`));
    assert.match(card, new RegExp(`data-order-adjustment-remove="${vendor}-item"`));
    assert.doesNotMatch(card, /All vendors|data-order-adjustment-vendor-filter|unavailable-heidelberg/);
    for (const other of vendors.filter((name) => name !== vendor)) {
      assert.doesNotMatch(card, new RegExp(`(?:value|data-order-adjustment-remove)="${other}-item"`));
    }
  }
  f.context.weeklyOrderTracking.vendors[0].ordered = true;
  assert.doesNotMatch(cards(f.render())[0], /data-order-adjustment-panel/);
});

test("adjustment editor uses total quantities with zero defaults and no action or reason fields", () => {
  const f = fixture([draft("OHLQ", [line("Current product", 21)])], { tracking: {
    adjustmentCatalog: [
      {catalogId:"current",vendor:"OHLQ",name:"Current product",orderable:true,quantityUnit:"units",currentPlanQuantity:21},
      {catalogId:"extra",vendor:"OHLQ",name:"Extra product",orderable:true,quantityUnit:"units",currentPlanQuantity:0},
    ], adjustments:[{catalogId:"current",vendor:"OHLQ",name:"Current product",quantity:23,quantityUnit:"units",reason:"Previously saved",adjustedBy:"Sam"}],
  } });
  const html=f.render();
  assert.match(html,/value="current"[^>]*data-order-adjustment-default-quantity="23"/);
  assert.match(html,/value="extra"[^>]*data-order-adjustment-default-quantity="0"/);
  assert.match(html,/data-order-adjustment-direction="remove"/);
  assert.match(html,/data-order-adjustment-direction="add"/);
  assert.match(html,/min="0" max="999"/);
  assert.doesNotMatch(html,/data-order-adjustment-action|data-order-adjustment-reason-input|St\. Patrick/);
});

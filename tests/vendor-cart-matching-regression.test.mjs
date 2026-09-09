import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const vendor = readFileSync(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");
const bees = readFileSync(new URL("../chrome-extension/bees-cart-builder/bees-cart.js", import.meta.url), "utf8");
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

test("product matching reaches the SKU beyond the local quantity wrapper", () => {
  for (const [vendorName, sku, description] of [["ohlq", "3024D", "Fireball 1.75 L"], ["ohlq", "0069L", "Absolut Vanilia 1 L"], ["proof", "49357", "DeKuyper Watermelon 1 L"]]) {
    const root = { innerText: `${description} Product # ${sku} Quantity Cases Units`, parentElement: null };
    const wrapper = { innerText: "Quantity Cases Units Add to Cart", parentElement: root };
    const context = { clean, canonical: clean, currentVendor: () => vendorName, quantityControl: () => ({}), PROOF_PRODUCT_IDENTITIES: {} };
    runInNewContext(vendor.slice(vendor.indexOf("function candidateForButton("), vendor.indexOf("function exactMatches(")), context);
    assert.equal(context.candidateForButton({ parentElement: wrapper }, { vendorSku: sku }).root, root);
    assert.equal(context.candidateForButton({ parentElement: wrapper }, { vendorSku: "9999D" }), null);
  }
});

test("disabled Add buttons remain discoverable before quantity entry", () => {
  const button = { disabled: true, textContent: "Add to Cart", getClientRects: () => [{}] };
  const context = { clean, document: { querySelectorAll: () => [button] } };
  runInNewContext(vendor.slice(vendor.indexOf("function addButtons("), vendor.indexOf("function quantityControls(")), context);
  assert.equal(context.addButtons()[0], button);
  assert.ok(vendor.indexOf("if (match.button.disabled)", vendor.indexOf("async function addExactMatch(")) > vendor.indexOf("setQuantity(requestedQuantityControl"));
});

test("BEES matches the approved Upside Dawn case but rejects other packages", () => {
  const context = {};
  runInNewContext(bees.slice(0, bees.indexOf("function productLinks(")), context);
  const line = { name: "Athletic Brewing Upside Dawn Golden Ale Non-Alcoholic Beer 12oz 24pk", vendorSku: "013452-C", packSize: "24" };
  const link = (name) => ({ textContent: name, querySelectorAll: () => [] });
  assert.equal(context.matchesLine(link("Athletic Upside Dawn Non-Alcoholic Golden 2x 12 Pack (12 oz Cans)"), line), true);
  for (const name of ["Athletic Upside Dawn Golden 12 Pack (12 oz Cans)", "Athletic Upside Dawn Golden 24 Pack (16 oz Cans)", "Athletic Upside Dawn Golden Keg", "Athletic Run Wild IPA 24 Pack (12 oz Cans)"]) {
    assert.equal(context.matchesLine(link(name), line), false, name);
  }
});

test("BEES reports an incomplete cart as needing review", async () => {
  let result;
  const context = { Set, Date, renderOverlay: () => {}, chrome: { runtime: { sendMessage: async (message) => { result = message.result; return { ok: true }; } } } };
  runInNewContext(bees.slice(bees.indexOf("async function finish("), bees.indexOf("async function runQuickOrder(")), context);
  await context.finish({ lines: [{}, {}, {}], results: [{ lineIndex: 0, status: "added" }, { lineIndex: 1, status: "added" }, { lineIndex: 2, status: "unmatched" }] });
  assert.equal(result.status, "needs_review");
  assert.match(result.message, /Cart incomplete: 2 of 3 added/);
});

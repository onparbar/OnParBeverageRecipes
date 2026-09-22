import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const dashboard = await readFile("public/dashboard.js", "utf8");
const renderer = dashboard.slice(dashboard.indexOf("function renderShotPricing("), dashboard.indexOf("function bindShotPricingControls("));

for (const tapNumber of [1, 84]) {
  test(`Hennessy suggestion opens and focuses the editor for tap ${tapNumber}`, () => {
    const editors = [];
    const directory = { open: false };
    let focused = "";
    let scrolled = "";
    let click;
    const rows = [1, 84].map((tap) => ({
      key: `hennessy:${tap}`, tapNumber: tap, name: `Hennessy ${tap}`,
      livePrice: {}, portions: [{ name: "Single", price: 11 }, { name: "Double", price: 15 }],
      canEdit: true,
    }));
    const shotPricingTable = {
      children: rows.map(() => ({ children: [{}, { append(editor) { editors.push(editor); } }, {}, {}] })),
      querySelectorAll() { return editors; },
    };
    const context = vm.createContext({
      shotPricingTable,
      pricingAdvisorTable: { querySelectorAll() { return [{
        dataset: { pricingPortionTap: String(tapNumber) },
        addEventListener(event, handler) { if (event === "click") click = handler; },
      }]; } },
      buildShotPricingRows: () => rows,
      shotPricingCapability: {},
      buildPricingAdvisor: () => ({ rows: [] }),
      buildPricingAdvisorInput: (value) => value,
      shotPricingRowsByKey: new Map(),
      activePmbPortionPriceUpdateKey: "",
      pmbPortionPriceUpdateMessages: new Map(),
      shotPricingDrafts: new Map(),
      clean: String, escapeHtml: String, formatPriceInput: String,
      renderPortionList: () => "", bindShotPricingControls() {},
      document: { createElement() { return {
        dataset: {}, addEventListener() {},
        closest: () => directory,
        scrollIntoView() { scrolled = this.dataset.shotPricingKey; },
        querySelector() { return { focus: () => { focused = this.dataset.shotPricingKey; } }; },
      }; } },
    });
    vm.runInContext(`${renderer}\nrenderShotPricing(visibleRows);`, Object.assign(context, {
      visibleRows: rows.map((row) => ({ livePrice: row.livePrice })),
    }));
    assert.equal(typeof click, "function", "suggestion must have a click handler");
    click();
    assert.equal(directory.open, true);
    assert.equal(editors.find((editor) => editor.dataset.shotPricingKey === `hennessy:${tapNumber}`).open, true);
    assert.equal(focused, `hennessy:${tapNumber}`);
    assert.equal(scrolled, `hennessy:${tapNumber}`);
    assert.equal(editors.find((editor) => editor.dataset.shotPricingKey !== `hennessy:${tapNumber}`).open, false);
  });
}

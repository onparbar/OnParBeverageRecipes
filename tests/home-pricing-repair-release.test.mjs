import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const alertFunction = source.match(/function getMissingPriceAlerts\(\) \{[\s\S]*?\n\}/)?.[0];

test("Home omits the nonalcoholic beer cost warning without hiding other missing costs", () => {
  assert.ok(alertFunction);
  const inventory = [
    { id: "non-alcoholic-beer", name: "Athletic Upside Dawn", par: 1, unitCost: 0 },
    { name: "Non Alcoholic Beer", par: 1, unitCost: 0 },
    { id: "lime", name: "Lime Juice", par: 12, unitCost: 0 },
    { id: "titos", name: "Tito's", par: 12, unitCost: 20 },
  ];
  const getAlerts = new Function("kegWallItems", "getWeeklyPlanInventoryItems", "clean", "normalizeProductPriceKey", "isPricingPlaceholder", "toNumber", "formatMissingCostMessage", `${alertFunction}; return getMissingPriceAlerts;`)(
    [], () => inventory, value => String(value || "").trim(), value => value.toLowerCase(), () => false, Number, items => items.join(", "),
  );
  const alerts = getAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "missing-product-costs");
  assert.deepEqual(alerts[0].details, ["Lime Juice · Inventory"]);
});

test("a successful repair starts the full PMB refresh without a one-minute timer", () => {
  const repair = source.match(/async function runKegConfigUpdate\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(repair);
  assert.match(repair, /This temporarily disables the tap walls for several minutes\./);
  assert.match(repair, /await runUnifiedPmbRefresh\(\)/);
  assert.doesNotMatch(repair, /window\.setTimeout/);
  assert.match(repair, /acknowledgeTapInterruption: true/);
});

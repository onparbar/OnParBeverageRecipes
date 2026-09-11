import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationalRecommendation } from "../public/operations-truth-model.mjs";
import { getRollingCocktailReserves } from "../public/rolling-cocktail-ingredients.mjs";
import { renderWeeklyPlanInventoryRows } from "../public/weekly-plan-view.mjs";
import { getDashboardIdentityById } from "../lib/dashboard-identities.mjs";

for (const wall of ["Main", "Karaoke", "Patio"]) {
  test(`${wall} beer rounds the entire shortage plus cushion to full kegs`, () => {
    const result = buildOperationalRecommendation({
      kind: "beer", wall, averageUsage: 2, reserve: 0.2,
      position: { available: 0.9 }, maxOrder: 1,
    });
    assert.equal(result.targetStock, 2.2);
    assert.equal(result.orderQuantity, 2);
    assert.equal(result.orderCapApplied, false);
  });
}

test("beer orders nothing when stock covers demand and cushion", () => {
  const result = buildOperationalRecommendation({
    kind: "beer", averageUsage: 2, position: { available: 2.2 },
  });
  assert.equal(result.reserve, 0.2);
  assert.equal(result.orderQuantity, 0);
});

test("the beer rule does not remove cocktail order limits", () => {
  const result = buildOperationalRecommendation({
    kind: "cocktail", averageUsage: 4, reserve: 0.25, maxOrder: 2,
  });
  assert.equal(result.orderQuantity, 2);
  assert.equal(result.orderCapApplied, true);
});

test("rolling ingredient display explains two-week need without the old par", () => {
  const html = renderWeeklyPlanInventoryRows([{
    name: "Lime juice", vendor: "Proof", onHand: 4, par: 99,
    quantity: 12, caseCount: 1, casePackaged: true, estimatedCost: 30,
    rollingIngredientVersion: 1, cocktailPrepRequiredBottles: 8,
    reasons: ["Two-week prep plus reserve minus counted stock.", "<review>"],
  }]);
  assert.match(html, /8 units for two weeks of prep/);
  assert.match(html, /Why this quantity\?/);
  assert.match(html, /&lt;review&gt;/);
  assert.doesNotMatch(html, /99 par/);
});

test("reserve display returns a copy without changing the standing reserves", () => {
  const reserves = getRollingCocktailReserves();
  assert.equal(reserves["tito-s"], 12);
  assert.equal(reserves["jose-cuervo-silver"], 16);
  reserves["tito-s"] = 999;
  assert.equal(getRollingCocktailReserves()["tito-s"], 12);
});

test("Brooke and Alexis have administrator access while other staff remain staff", () => {
  assert.equal(getDashboardIdentityById("brooke-swallows").role, "owner");
  assert.equal(getDashboardIdentityById("alexis-younker").role, "owner");
  assert.equal(getDashboardIdentityById("adrian-reed").role, "employee");
});

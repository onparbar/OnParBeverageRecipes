import assert from "node:assert/strict";
import test from "node:test";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildRecipeInventoryContributions } from "../lib/inventory-contributions.mjs";

const citron = { id: "absolut-citron", name: "Absolut Citron", group: "Liquor Cabinet", bottleOz: 59.17, onHand: 0, hasCurrentCount: true, packSize: 1, unitCost: 32.9 };
const lemon = { id: "lemon-drop", title: "Lemon Drop Martini(Vodka)", ingredients: [{ name: "Absolut Citron", raw: "Absolut Citron=14 bottles (1.75L)", oz: 828 }] };
const main = { key: "main-lemon", name: "Lemon Drop Martini (Absolut Citron) 1", tapNumber: 60, wall: "Main", currentStockKegs: 0.433, avgWeeklyKegs: 0.128, preThursdayUsageSharePct: 0 };
const karaoke = { ...main, key: "karaoke-lemon", name: "Lemon Drop Martini (Absolut Citron) 2", tapNumber: 98, wall: "Karaoke", currentStockKegs: 0.411, avgWeeklyKegs: 0.043 };
const calculate = (options = {}) => buildRollingCocktailIngredientOrders({ inventoryItems: [citron], recipes: [lemon], tapInputs: [main, karaoke], cocktails: [], ...options })[0];

test("November 2 saved counts buy Citron for next Thursday before any manual addition", () => {
  const result = calculate();
  assert.deepEqual(result.rollingPrepWeeks, [0, 14]);
  assert.equal(result.cocktailPrepThisWeekBottles, 0);
  assert.equal(result.cocktailPrepNextWeekBottles, 14);
  assert.equal(result.orderUnits, 14);
  assert.deepEqual(result.rollingPrepTapNumbers, [60]);
  assert.equal(result.orderHoldReason, "");
});

test("an early added Lemon Drop replaces next week's batch instead of buying twice", () => {
  const result = calculate({ cocktails: [{ ...main, key: "prep-addition:1", inventoryKey: main.key, prepAdditionId: "1", recipeId: lemon.id, orderQty: 1 }] });
  assert.deepEqual(result.rollingPrepWeeks, [14, 0]);
  assert.equal(result.orderUnits, 14);
});

test("the saved single-tap prep display also credits the correct tap", () => {
  const result = calculate({ cocktails: [{ name: "Lemon Drop Martini 1", quantity: 1, tapNumbers: [60], walls: ["Main"], prepAdditionId: "1" }] });
  assert.deepEqual(result.rollingPrepWeeks, [14, 0]);
  assert.equal(result.orderHoldReason, "");
});

test("a Karaoke batch cannot cover next Thursday's Main demand", () => {
  const result = calculate({ cocktails: [{ ...karaoke, prepAdditionId: "karaoke-added", orderQty: 1 }] });
  assert.deepEqual(result.rollingPrepWeeks, [14, 14]);
  assert.equal(result.orderUnits, 28);
});

test("manual additions on the same tap each count once and credit its future stock", () => {
  const addition = { ...main, prepAdditionId: "first", orderQty: 1 };
  const result = calculate({ cocktails: [addition, addition, { ...addition, prepAdditionId: "second" }] });
  assert.deepEqual(result.rollingPrepWeeks, [28, 0]);
  assert.equal(result.orderUnits, 28);
});

test("an explicit empty current prep plan is not replaced by an automatic current batch", () => {
  const result = calculate({ tapInputs: [{ ...main, currentStockKegs: 0 }], cocktails: [] });
  assert.deepEqual(result.rollingPrepWeeks, [0, 14]);
});

test("unplanned mode forecasts both Thursdays without mutating its inputs", () => {
  const input = { inventoryItems: [citron], recipes: [lemon], tapInputs: [main, karaoke] };
  const before = structuredClone(input);
  const [result] = buildRollingCocktailIngredientOrders(input);
  assert.deepEqual(result.rollingPrepWeeks, [0, 14]);
  assert.deepEqual(input, before);
});

test("missing future stock holds purchases even when current prep is explicitly known", () => {
  const result = calculate({ tapInputs: [{ ...main, currentStockKegs: null }], cocktails: [{ ...main, orderQty: 1 }] });
  assert.equal(result.cocktailPrepThisWeekBottles, 14);
  assert.equal(result.orderUnits, 0);
  assert.match(result.orderHoldReason, /saved stock or weekly usage is missing/);
});

test("missing and ambiguous planned tap assignments require review", () => {
  for (const cocktail of [
    { name: main.name, tapNumbers: [60, 98], quantity: 1 },
    { name: main.name, tapNumber: 61, wall: "Main", orderQty: 1 },
  ]) {
    const result = calculate({ cocktails: [cocktail] });
    assert.equal(result.orderUnits, 0);
    assert.match(result.orderHoldReason, /tap assignment.*missing or ambiguous/);
  }
});

test("a standalone cocktail still orders its ingredients without covering a different recipe", () => {
  const other = { id: "other", title: "Different Citron Cocktail", ingredients: [{ name: "Absolut Citron", raw: "Absolut Citron=2 bottles (1.75L)", oz: 118.34 }] };
  const result = calculate({ recipes: [lemon, other], cocktails: [{ name: other.title, recipeId: other.id, quantity: 1, wall: "Main", tapNumber: 0 }] });
  assert.deepEqual(result.rollingPrepWeeks, [2, 14]);
  assert.equal(result.orderHoldReason, "");
});

test("explicit-only recipe calculations keep their existing current-prep behavior", () => {
  const result = calculate({ tapInputs: [], cocktails: [{ name: lemon.title, quantity: 1 }] });
  assert.deepEqual(result.rollingPrepWeeks, [14, 0]);
  assert.equal(result.orderUnits, 14);
  assert.equal(result.orderHoldReason, "");
});

test("Simple Syrup is prepared only for this Thursday while Citron is bought ahead", () => {
  const syrup = { id: "simple-syrup", name: "Simple Syrup", group: "Mixer Cabinet", bottleOz: 128, onHand: 0, hasCurrentCount: true };
  const recipe = { ...lemon, ingredients: [...lemon.ingredients, { name: "Simple Syrup", oz: 320 }] };
  const result = buildRollingCocktailIngredientOrders({ inventoryItems: [citron, syrup], recipes: [recipe], tapInputs: [main], cocktails: [] });
  assert.deepEqual(result[0].rollingPrepWeeks, [0, 14]);
  assert.deepEqual(result[1].rollingPrepWeeks, [0, 0]);
  assert.equal(result[1].cocktailPrepRequiredBottles, 0);
});

test("family recipe flavors stay separate when an added batch is credited", () => {
  const family = { id: "family", title: "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)", ingredients: [{ name: "Strawberry Schnapps", raw: "Flavored Schnapps", oz: 25 }] };
  const strawberry = { id: "strawberry-schnapps", name: "Strawberry Schnapps", group: "Mixer Cabinet", bottleOz: 25, onHand: 0, hasCurrentCount: true };
  const peach = { ...strawberry, id: "peach-schnapps", name: "Peach Schnapps" };
  const tap = { ...main, name: "Peach Margarita 1" };
  const result = buildRollingCocktailIngredientOrders({
    inventoryItems: [strawberry, peach], recipes: [family], tapInputs: [tap],
    cocktails: [{ name: "Strawberry Margarita 1", quantity: 1, recipeId: family.id, wall: "Main" }],
  });
  assert.deepEqual(result[0].rollingPrepWeeks, [1, 0]);
  assert.deepEqual(result[1].rollingPrepWeeks, [0, 1]);
  assert.equal(result[0].orderHoldReason, "");
});

test("saved batch size scales purchases exactly like prep consumption and credits its actual volume", () => {
  const spirit = { id: "spirit", name: "Spirit", group: "Liquor Cabinet", bottleOz: 10, onHand: 0, hasCurrentCount: true };
  const recipe = { title: "Custom", ingredients: [{ name: "Spirit", raw: "Spirit=6 bottles (10oz)", oz: 60 }, { name: "Water", oz: 40 }] };
  const tap = { ...main, name: "Custom", currentStockKegs: 0, avgWeeklyKegs: 0.7 };
  const cocktail = { ...tap, quantity: 1, batchSizeOz: 200 };
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [spirit], recipes: [recipe], tapInputs: [tap], cocktails: [cocktail] });
  const consumed = -buildRecipeInventoryContributions(recipe, [spirit], cocktail)[0].quantity;
  assert.equal(consumed, 12);
  assert.deepEqual(result.rollingPrepWeeks, [consumed, 0]);
  assert.equal(result.orderUnits, consumed);
});

test("separate partial prep batches each retain whole-bottle consumption rounding", () => {
  const spirit = { id: "spirit", name: "Spirit", group: "Liquor Cabinet", bottleOz: 10, onHand: 0, hasCurrentCount: true };
  const recipe = { title: "Custom", ingredients: [{ name: "Spirit", raw: "Spirit=6 bottles (10oz)", oz: 60 }, { name: "Water", oz: 40 }] };
  const cocktails = ["one", "two"].map(prepAdditionId => ({ name: "Custom", quantity: 1, batchSizeOz: 25, prepAdditionId }));
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [spirit], recipes: [recipe], cocktails });
  const consumed = cocktails.reduce((total, cocktail) => total - buildRecipeInventoryContributions(recipe, [spirit], cocktail)[0].quantity, 0);
  assert.equal(consumed, 4);
  assert.equal(result.orderUnits, consumed);
});

test("display-rounded recipe yields do not purchase an extra bottle", () => {
  const spirit = { id: "spirit", name: "Spirit", group: "Liquor Cabinet", bottleOz: 10, onHand: 0, hasCurrentCount: true };
  const recipe = { title: "Custom", ingredients: [{ name: "Spirit", raw: "Spirit=6 bottles (10oz)", oz: 60 }, { name: "Water", oz: 939.5 }] };
  const cocktail = { name: "Custom", quantity: 1, batchSizeOz: 1000 };
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [spirit], recipes: [recipe], cocktails: [cocktail] });
  assert.equal(result.orderUnits, -buildRecipeInventoryContributions(recipe, [spirit], cocktail)[0].quantity);
  assert.equal(result.orderUnits, 6);
});

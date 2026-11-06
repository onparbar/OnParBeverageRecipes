import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/staff-dashboard.js", import.meta.url), "utf8");

function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}

function element(tagName) {
  return {
    tagName,
    children: [],
    classList: { add() {} },
    append(...children) { this.children.push(...children); },
  };
}

function renderRecipe(name, recipe) {
  const guide = element("section");
  const scope = {
    document: { createElement: element },
    formatNumber: String,
    getTotalOunces: (value) => value.ingredients.reduce((total, ingredient) => total + ingredient.oz, 0),
    getIngredientAddAmount: (value) => value,
    getOptionalIngredientProgress: () => null,
    getStaffRecipeDisplayTitle: () => "Display title differs from canonical recipe",
    createRecipeGuide(value) {
      assert.equal(value, recipe, "the player must receive the canonical recipe and current ingredients");
      return guide;
    },
  };
  const render = runInNewContext(`(${declaration(name)})`, scope);
  return { card: render(recipe, "weekly-prep-recipe"), guide };
}

const recipe = {
  title: "Crown Apple 'rita(Whiskey)",
  ingredients: [
    { name: "Crown Apple", raw: "4 bottles (1.75L)", oz: 236.6 },
    { name: "Lemonade", raw: "3 gallons", oz: 384 },
  ],
};

test("staff weekly prep recipes retain ingredient quantities and place the guide below the ingredient table", () => {
  const { card, guide } = renderRecipe("createInlineStaffPrepRecipe", recipe);
  assert.equal(card.hidden, true, "the existing recipe disclosure remains collapsed initially");
  assert.equal(card.id, "weekly-prep-recipe");
  assert.equal(card.children.at(-1), guide);
  assert.equal(card.children.length, 3);
  const rows = card.children[1].children[0].children;
  assert.deepEqual(rows.map((row) => row.children.map((cell) => cell.textContent)), [
    ["Crown Apple", "4 bottles (1.75L)"],
    ["Lemonade", "3 gallons"],
  ]);
});

test("staff recipe cards keep their disclosure and show the matching guide below the full recipe", () => {
  const { card, guide } = renderRecipe("createRecipeCard", recipe);
  assert.equal(card.tagName, "details");
  assert.equal(card.children[0].tagName, "summary");
  assert.equal(card.children.at(-1), guide);
  assert.equal(card.children.length, 3);
  const rows = card.children[1].children[0].children[1].children;
  assert.deepEqual(rows.map((row) => [row.children[0].children[0].textContent, row.children[1].textContent]), [
    ["Crown Apple", "4 bottles (1.75L)"],
    ["Lemonade", "3 gallons"],
  ]);
});

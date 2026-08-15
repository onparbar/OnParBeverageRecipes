import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sanitizeEmployeeRecipeCsv } from "../lib/employee-recipe-data.mjs";

test("employee recipe data preserves recipe structure while removing every cost value", () => {
  const source = [
    "Recipe,$,Oz,Second,$,Oz",
    "12 gallons,,,12 gallons,,",
    'Spirit,"$230",414,Juice,7.23,320',
    'Total price,"$237.23",,Total price,$10,',
  ].join("\n");
  const result = sanitizeEmployeeRecipeCsv(source);

  assert.match(result, /^Recipe,\$,Oz,Second,\$,Oz/m);
  assert.match(result, /Spirit,,414,Juice,,320/);
  assert.equal(result.includes("230"), false);
  assert.equal(result.includes("7.23"), false);
  assert.equal(result.includes("237.23"), false);
});

test("employee recipe sanitizing follows price headers across separator columns", () => {
  const source = [
    "First,$,Oz,,Washington Apple,$,Oz",
    "12 gallons,,,,12 gallons,,",
    'Vodka,"$230",414,,Crown Apple,"$318",355',
    'Juice,"$7.23",320,,Cranberry Juice,"$28",768',
  ].join("\n");
  const result = sanitizeEmployeeRecipeCsv(source);

  assert.match(result, /^First,\$,Oz,,Washington Apple,\$,Oz/m);
  assert.match(result, /Vodka,,414,,Crown Apple,,355/);
  assert.match(result, /Juice,,320,,Cranberry Juice,,768/);
  assert.equal(result.includes("230"), false);
  assert.equal(result.includes("318"), false);
  assert.equal(result.includes("7.23"), false);
});

test("the real employee CSV retains Washington Apple ingredients and ounces", async () => {
  const source = await readFile(new URL("../public/data/cocktail-recipes.csv", import.meta.url), "utf8");
  const result = sanitizeEmployeeRecipeCsv(source);

  assert.match(result, /Washington Apple \(Whiskey\),\$,Oz/);
  assert.match(result, /Crown Apple 6-1\.75l,,355/);
  assert.match(result, /768oz  Cranberry juice,,768/);
});

import assert from "node:assert/strict";
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

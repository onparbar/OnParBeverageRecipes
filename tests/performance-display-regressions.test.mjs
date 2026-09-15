import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
test("performance hides the timezone caption without changing Eastern reporting dates", () => {
  const view = readFileSync(new URL("../public/tap-performance.mjs", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/pmb-daily-usage/route.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /<span class="table-note">Eastern time<\/span>/);
  assert.match(api, /timeZone: 'America\/New_York'/);
});

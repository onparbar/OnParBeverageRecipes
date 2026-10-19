import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, css, pageSource] = await Promise.all([
  readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/page.jsx", import.meta.url), "utf8"),
]);

test("keg levels shows backup stock without a separate weekly counting workflow", () => {
  assert.doesNotMatch(dashboardSource, /Verify the saved counts\.|change only what is different/i);
  assert.doesNotMatch(pageSource, /id="cooler-count-continue"|id="cooler-count-feedback"/);
  assert.doesNotMatch(dashboardSource, /id="keg-speech-assistant"/);
  assert.match(dashboardSource, /<th>Full back up kegs<\/th>/);
  assert.match(dashboardSource, /aria-label="Full back up kegs for/);
});

test("keg table headings remain visible while the cooler list scrolls", () => {
  assert.match(css, /#keg-levels-panel \.inventory-table-wrap\s*\{[^}]*max-height:/s);
  assert.match(css, /#keg-levels-panel \.keg-table thead th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
});

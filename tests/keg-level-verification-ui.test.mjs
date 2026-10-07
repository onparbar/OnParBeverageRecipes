import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, css] = await Promise.all([
  readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("keg levels asks staff to verify saved backup counts", () => {
  assert.match(dashboardSource, /Verify the saved counts\./);
  assert.match(dashboardSource, /change only what is different/i);
  assert.match(dashboardSource, /<th>Full back up kegs<\/th>/);
  assert.match(dashboardSource, /aria-label="Full back up kegs for/);
});

test("keg table headings remain visible while the cooler list scrolls", () => {
  assert.match(css, /#keg-levels-panel \.inventory-table-wrap\s*\{[^}]*max-height:/s);
  assert.match(css, /#keg-levels-panel \.keg-table thead th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
});

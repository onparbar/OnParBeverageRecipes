import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("mobile dashboard actions wrap into separate clickable rows", () => {
  const mobileBlock = css.slice(css.indexOf("@media (max-width: 720px)"));
  const actionsRule = mobileBlock.match(/\n  \.topbar-actions\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(actionsRule, /flex-wrap:\s*wrap;/);
  assert.match(actionsRule, /overflow-x:\s*visible;/);
});

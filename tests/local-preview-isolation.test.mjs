import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [packageSource, nextConfig, gitignore] = await Promise.all([
  readFile("package.json", "utf8"),
  readFile("next.config.mjs", "utf8"),
  readFile(".gitignore", "utf8"),
]);

test("verification builds cannot overwrite a running local preview cache", () => {
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["build:check"], /ONPAR_NEXT_DIST_DIR=\.next-check next build/);
  assert.match(scripts.check, /npm run build:check/);
  assert.doesNotMatch(scripts.check, /npm run build(?:\s|$)/);
  assert.match(nextConfig, /distDir: process\.env\.ONPAR_NEXT_DIST_DIR \|\| "\.next"/);
  assert.match(gitignore, /^\.next-check\/$/m);
});

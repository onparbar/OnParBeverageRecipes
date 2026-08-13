import assert from "node:assert/strict";
import test from "node:test";
import { parsePmbJson } from "../lib/pmb-json.mjs";

test("parses valid PMB JSON without modification", () => {
  assert.deepEqual(parsePmbJson('{"productlist":[{"plu":4101,"name":"Test IPA"}]}'), {
    productlist: [{ plu: 4101, name: "Test IPA" }],
  });
});

test("repairs literal line breaks and trailing commas in PMB product data", () => {
  const response = `{
    "productlist": [
      {"plu": 4101, "name": "Test IPA", "description": "Hoppy
and bright",},
    ],
  }`;

  assert.deepEqual(parsePmbJson(response), {
    productlist: [{ plu: 4101, name: "Test IPA", description: "Hoppy\nand bright" }],
  });
});

test("still rejects an unreadable PMB response", () => {
  assert.equal(parsePmbJson("<html>not json</html>"), null);
});

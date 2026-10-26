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

test("preserves a literal customer-name backslash without changing transaction evidence", () => {
  const response = String.raw`{"taptransactions":[{"name_customer":"Guest\2","volume_amount":"12.50","tst_start":"1792436400","device_id":9001,"line_num":2,"plu":4101}]}`;
  assert.throws(() => JSON.parse(response));
  assert.deepEqual(parsePmbJson(response), {
    taptransactions: [{ name_customer: "Guest\\2", volume_amount: "12.50", tst_start: "1792436400",
      device_id: 9001, line_num: 2, plu: 4101 }],
  });
});

test("valid escapes keep their exact meaning while another string requires repair", () => {
  const validEscapes = String.raw`{"quote":"\"","slash":"\/","backslash":"\\","backslashThenQuote":"\\\"","controls":"\b\f\n\r\t","unicode":"\u00e9\ud83c\udf7a"}`;
  const expected = JSON.parse(validEscapes);
  const response = `${validEscapes.slice(0, -1)},"customer":"Guest\\2"}`;
  assert.deepEqual(parsePmbJson(response), { ...expected, customer: "Guest\\2" });
});

test("escapes raw string control characters without dropping them", () => {
  const controls = Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join("");
  assert.deepEqual(parsePmbJson(`{"description":"${controls}"}`), { description: controls });
  assert.equal(parsePmbJson('{"description":\u0000"outside string"}'), null);
});

test("trailing-comma repair preserves comma-and-bracket text inside strings", () => {
  const response = String.raw`{"description":"keep ,} and ,] and , } and , ] and escaped \"quotes\"","items":[1,2,],}`;
  assert.deepEqual(parsePmbJson(response), {
    description: 'keep ,} and ,] and , } and , ] and escaped "quotes"', items: [1, 2],
  });
});

test("malformed Unicode, truncation, and invalid structure remain rejected", () => {
  for (const response of [
    String.raw`{"name":"Guest\u12x4"}`,
    String.raw`{"name":"Guest\u123"}`,
    String.raw`{"name":"Guest\u"}`,
    String.raw`{"name":"Guest\2"`,
    '{"name":"Guest\\',
    '{"taptransactions":[{"volume_amount":12.5}',
    '{"volume_amount":12.5.0}',
    '{"volume_amount":NaN}',
    '{"volume_amount":}',
    '{"volume_amount":,}',
    '[,]', '{,}', '[1,,]',
  ]) assert.equal(parsePmbJson(response), null, response);
});

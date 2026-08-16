import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicUrl } from "../lib/public-request-url.mjs";

test("public URL preserves the forwarded origin", () => {
  const headers = new Headers({
    host: "localhost:3000",
    "x-forwarded-host": "onparbev.com",
    "x-forwarded-proto": "https",
  });

  const url = buildPublicUrl({
    headers,
    fallbackUrl: new URL("http://localhost:3000/"),
    pathname: "/login",
  });

  url.searchParams.set("next", "/");
  assert.equal(url.toString(), "https://onparbev.com/login?next=%2F");
});

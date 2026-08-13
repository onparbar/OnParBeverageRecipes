import assert from "node:assert/strict";
import test from "node:test";

import {
  SafeRemoteFetchError,
  fetchRemoteBuffer,
  isPublicIpAddress,
  requirePublicRemoteUrl,
} from "../lib/safe-remote-fetch.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("blocks local, private, link-local, and metadata IP addresses", () => {
  [
    "127.0.0.1",
    "10.0.0.5",
    "169.254.169.254",
    "172.20.1.1",
    "192.168.1.10",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
    "64:ff9b::127.0.0.1",
    "2002:7f00:1::",
    "2001::1",
  ].forEach((address) => assert.equal(isPublicIpAddress(address), false, address));
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("rejects private DNS answers, credentials, and nonstandard ports", async () => {
  await assert.rejects(
    requirePublicRemoteUrl("https://example.test/image.jpg", {
      lookupImpl: async () => [{ address: "10.1.2.3", family: 4 }],
    }),
    SafeRemoteFetchError,
  );
  await assert.rejects(
    requirePublicRemoteUrl("https://user:pass@example.test/image.jpg", { lookupImpl: publicLookup }),
    /credentials/,
  );
  await assert.rejects(
    requirePublicRemoteUrl("https://example.test:8443/image.jpg", { lookupImpl: publicLookup }),
    /standard web port/,
  );
});

test("validates every redirect destination", async () => {
  const fetchImpl = async () => new Response(null, {
    status: 302,
    headers: { Location: "http://127.0.0.1/admin" },
  });
  await assert.rejects(
    fetchRemoteBuffer("https://example.test/image.jpg", { fetchImpl, lookupImpl: publicLookup }),
    /private or local/,
  );
});

test("rejects DNS rebinding before the outbound fetch can connect", async () => {
  let lookupCount = 0;
  let fetchCalled = false;
  await assert.rejects(
    fetchRemoteBuffer("https://rebind.example.test/image.jpg", {
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("unexpected", { status: 200 });
      },
      lookupImpl: async () => {
        lookupCount += 1;
        return [{ address: lookupCount === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
      },
    }),
    /private or local/,
  );
  assert.equal(fetchCalled, false);
});

test("enforces content type and streaming response size limits", async () => {
  await assert.rejects(
    fetchRemoteBuffer("https://example.test/image.jpg", {
      acceptedContentTypes: ["image/*"],
      fetchImpl: async () => new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
      lookupImpl: publicLookup,
    }),
    (error) => error?.code === "REMOTE_CONTENT_TYPE_INVALID",
  );

  await assert.rejects(
    fetchRemoteBuffer("https://example.test/large.jpg", {
      acceptedContentTypes: ["image/*"],
      fetchImpl: async () => new Response(Buffer.alloc(11), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
      lookupImpl: publicLookup,
      maxBytes: 10,
    }),
    (error) => error?.code === "REMOTE_RESPONSE_TOO_LARGE",
  );
});

test("returns a bounded public response", async () => {
  const result = await fetchRemoteBuffer("https://example.test/page", {
    acceptedContentTypes: ["text/html"],
    fetchImpl: async () => new Response("<h1>Okay</h1>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
    lookupImpl: publicLookup,
    maxBytes: 100,
  });
  assert.equal(result.status, 200);
  assert.equal(result.text(), "<h1>Okay</h1>");
});

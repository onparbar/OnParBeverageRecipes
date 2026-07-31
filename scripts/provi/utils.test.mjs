import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupCaptureFiles,
  ensureDir,
  hardenPrivateRoot,
  hardenPrivateTree,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  REDACTED_VALUE,
  redactSensitiveHeaders,
  sanitizeCapturedData,
  sanitizeCaptureEvent,
  sanitizeWebStorage,
  writeJson,
} from "./utils.mjs";

function permissionBits(stat) {
  return stat.mode & 0o777;
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "provi-security-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("redacts standard and token-like sensitive headers", () => {
  const safe = redactSensitiveHeaders({
    Cookie: "session=secret",
    Authorization: "Bearer secret",
    "Proxy-Authorization": "Basic secret",
    "Set-Cookie": "session=secret",
    "X-CSRF-Token": "csrf-secret",
    "X-Api-Key": "api-secret",
    "X-Auth-Session": "auth-secret",
    Authentication: "auth-secret",
    "X-Custom": "Bearer custom-secret",
    "Content-Type": "application/json",
  });

  assert.equal(safe.Cookie, REDACTED_VALUE);
  assert.equal(safe.Authorization, REDACTED_VALUE);
  assert.equal(safe["Proxy-Authorization"], REDACTED_VALUE);
  assert.equal(safe["Set-Cookie"], REDACTED_VALUE);
  assert.equal(safe["X-CSRF-Token"], REDACTED_VALUE);
  assert.equal(safe["X-Api-Key"], REDACTED_VALUE);
  assert.equal(safe["X-Auth-Session"], REDACTED_VALUE);
  assert.equal(safe.Authentication, REDACTED_VALUE);
  assert.equal(safe["X-Custom"], REDACTED_VALUE);
  assert.equal(safe["Content-Type"], "application/json");
});

test("keeps business identifiers while redacting credentials and payment fields", () => {
  const safe = sanitizeCapturedData({
    retailerAccount: {
      accountId: "account-123",
      locationId: "location-456",
      locationName: "On Par Entertainment",
      password: "password-secret",
      access_token: "access-secret",
      customer: {
        customerId: "customer-789",
        email: "owner@example.com",
      },
    },
    checkout: {
      cartId: "cart-123",
      cardNumber: "4111111111111111",
      cvv: "123",
    },
  });

  assert.equal(safe.retailerAccount.accountId, "account-123");
  assert.equal(safe.retailerAccount.locationId, "location-456");
  assert.equal(safe.retailerAccount.locationName, "On Par Entertainment");
  assert.equal(safe.retailerAccount.customer.customerId, "customer-789");
  assert.equal(safe.retailerAccount.password, REDACTED_VALUE);
  assert.equal(safe.retailerAccount.access_token, REDACTED_VALUE);
  assert.equal(safe.retailerAccount.customer.email, REDACTED_VALUE);
  assert.equal(safe.checkout.cartId, "cart-123");
  assert.equal(safe.checkout.cardNumber, REDACTED_VALUE);
  assert.equal(safe.checkout.cvv, REDACTED_VALUE);
  assert.doesNotMatch(JSON.stringify(safe), /password-secret|access-secret|owner@example|4111111111111111/);
});

test("sanitizes web storage and complete legacy capture events", () => {
  const storage = sanitizeWebStorage({
    authToken: "token-secret",
    locationContext: JSON.stringify({
      locationId: "location-456",
      refreshToken: "refresh-secret",
    }),
  });
  const locationContext = JSON.parse(storage.locationContext);
  assert.equal(storage.authToken, REDACTED_VALUE);
  assert.equal(locationContext.locationId, "location-456");
  assert.equal(locationContext.refreshToken, REDACTED_VALUE);

  const event = sanitizeCaptureEvent({
    url: "https://app.provi.com/checkout?locationId=location-456&access_token=url-secret",
    headers: {
      cookie: "session=secret",
      "content-type": "application/json",
    },
    postData: "password=secret",
    body: {
      retailerId: "retailer-123",
      sessionToken: "body-secret",
    },
  });

  assert.match(event.url, /locationId=location-456/);
  assert.doesNotMatch(event.url, /url-secret/);
  assert.equal(event.headers.cookie, REDACTED_VALUE);
  assert.equal(event.headers["content-type"], "application/json");
  assert.equal(event.postData, null);
  assert.equal(event.postDataOmitted, true);
  assert.equal(event.body.retailerId, "retailer-123");
  assert.equal(event.body.sessionToken, REDACTED_VALUE);
});

test("creates private directories and JSON files and repairs existing tree modes", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX permission bits are not available on Windows.");
    return;
  }
  const root = await temporaryDirectory(t);
  const privateDirectory = path.join(root, "nested", "captures");
  const jsonPath = path.join(privateDirectory, "capture.json");

  await ensureDir(privateDirectory);
  await writeJson(jsonPath, { ok: true });
  assert.equal(permissionBits(await fs.stat(privateDirectory)), PRIVATE_DIRECTORY_MODE);
  assert.equal(permissionBits(await fs.stat(jsonPath)), PRIVATE_FILE_MODE);

  await fs.chmod(privateDirectory, 0o755);
  await fs.chmod(jsonPath, 0o644);
  await hardenPrivateRoot(path.join(root, "nested"));
  assert.equal(permissionBits(await fs.stat(path.join(root, "nested"))), PRIVATE_DIRECTORY_MODE);
  assert.equal(permissionBits(await fs.stat(privateDirectory)), PRIVATE_DIRECTORY_MODE);
  assert.equal(permissionBits(await fs.stat(jsonPath)), PRIVATE_FILE_MODE);

  await hardenPrivateTree(path.join(root, "nested"));
});

test("capture cleanup enforces both age and count retention while preserving active files", async (t) => {
  const root = await temporaryDirectory(t);
  const captureDirectory = path.join(root, "captures");
  const active = path.join(captureDirectory, "latest-provi-capture.json");
  const newest = path.join(captureDirectory, "newest.json");
  const overflow = path.join(captureDirectory, "overflow.json");
  const expired = path.join(captureDirectory, "expired.json");
  const now = Date.parse("2026-07-30T12:00:00.000Z");

  await writeJson(active, { active: true });
  await writeJson(newest, { newest: true });
  await writeJson(overflow, { overflow: true });
  await writeJson(expired, { expired: true });
  await fs.utimes(active, new Date(now - 40 * 86_400_000), new Date(now - 40 * 86_400_000));
  await fs.utimes(newest, new Date(now - 1_000), new Date(now - 1_000));
  await fs.utimes(overflow, new Date(now - 2_000), new Date(now - 2_000));
  await fs.utimes(expired, new Date(now - 10 * 86_400_000), new Date(now - 10 * 86_400_000));

  const removed = await cleanupCaptureFiles(captureDirectory, {
    maxAgeDays: 7,
    maxFiles: 2,
    now,
    preservePaths: [active],
  });

  assert.deepEqual(
    removed.map((filePath) => path.basename(filePath)).sort(),
    ["expired.json", "overflow.json"],
  );
  assert.equal(JSON.parse(await fs.readFile(active, "utf8")).active, true);
  assert.equal(JSON.parse(await fs.readFile(newest, "utf8")).newest, true);
  await assert.rejects(fs.stat(overflow), { code: "ENOENT" });
  await assert.rejects(fs.stat(expired), { code: "ENOENT" });
});

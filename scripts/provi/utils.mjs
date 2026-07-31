import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
]);
const execFileAsync = promisify(execFile);
const windowsAclScriptPath = fileURLToPath(new URL("./secure_provi_windows.ps1", import.meta.url));

const SENSITIVE_BODY_NAMES = new Set([
  "accesstoken",
  "authorization",
  "auth",
  "authtoken",
  "bearertoken",
  "billingaddress",
  "cardholder",
  "cardholdername",
  "cardnumber",
  "clientsecret",
  "cookie",
  "credentials",
  "creditcard",
  "creditcardnumber",
  "cvc",
  "cvv",
  "dateofbirth",
  "dob",
  "email",
  "emailaddress",
  "expiration",
  "expirationdate",
  "expiry",
  "expirydate",
  "firstname",
  "fullname",
  "idtoken",
  "jwt",
  "lastname",
  "mobile",
  "onetimecode",
  "onetimepassword",
  "otp",
  "passcode",
  "passwd",
  "password",
  "paymentmethod",
  "phonenumber",
  "pin",
  "proxyauthorization",
  "refreshtoken",
  "securitycode",
  "sessionid",
  "sessiontoken",
  "setcookie",
  "shippingaddress",
  "ssn",
  "taxid",
  "token",
]);

function normalizedKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLikelySecretValue(value) {
  const text = String(value || "").trim();
  return /^bearer\s+\S+/i.test(text)
    || /^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}$/.test(text);
}

export function isSensitiveHeaderName(name) {
  const value = String(name || "").trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(value)) return true;
  return /(^|[-_])(api[-_]?key|credential|csrf|jwt|secret|session|token|xsrf)([-_]|$)/i.test(value)
    || /(^|[-_])auth(?:entication)?([-_]|$)/i.test(value);
}

export function isSensitiveBodyField(name) {
  const value = normalizedKey(name);
  return SENSITIVE_BODY_NAMES.has(value)
    || /(?:access|auth|bearer|id|refresh|session)?token$/.test(value)
    || /(?:api|client)secret$/.test(value)
    || /apikey$/.test(value);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (process.platform !== "win32") {
    await fs.chmod(dirPath, PRIVATE_DIRECTORY_MODE);
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  // writeFile keeps an existing file's mode, so tighten it explicitly too.
  if (process.platform !== "win32") {
    await fs.chmod(filePath, PRIVATE_FILE_MODE);
  }
}

export async function hardenPrivateFile(filePath) {
  if (process.platform !== "win32") {
    await fs.chmod(filePath, PRIVATE_FILE_MODE);
  }
}

export async function hardenPrivateTree(rootPath) {
  if (process.platform === "win32") return;

  let root;
  try {
    root = await fs.lstat(rootPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (root.isSymbolicLink()) return;
  if (!root.isDirectory()) {
    if (root.isFile()) await hardenPrivateFile(rootPath);
    return;
  }

  await fs.chmod(rootPath, PRIVATE_DIRECTORY_MODE);
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await hardenPrivateTree(entryPath);
    } else if (entry.isFile()) {
      await hardenPrivateFile(entryPath);
    }
  }
}

export async function hardenPrivateRoot(rootPath) {
  await ensureDir(rootPath);
  if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        windowsAclScriptPath,
        "-RootPath",
        rootPath,
      ],
      {
        windowsHide: true,
        timeout: 120_000,
      },
    );
    return;
  }

  await hardenPrivateTree(rootPath);
}

export function redactSensitiveHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") return {};

  if (Array.isArray(headers)) {
    return headers.map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return entry;
      return [
        entry[0],
        isSensitiveHeaderName(entry[0]) || isLikelySecretValue(entry[1]) ? REDACTED_VALUE : entry[1],
      ];
    });
  }

  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveHeaderName(name) || isLikelySecretValue(value) ? REDACTED_VALUE : value,
    ]),
  );
}

export function redactSensitiveUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = REDACTED_VALUE;
    if (url.password) url.password = REDACTED_VALUE;
    for (const [name, value] of url.searchParams.entries()) {
      if (isSensitiveBodyField(name) || isSensitiveHeaderName(name) || isLikelySecretValue(value)) {
        url.searchParams.set(name, REDACTED_VALUE);
      }
    }
    return url.toString();
  } catch {
    return String(rawUrl || "");
  }
}

export function sanitizeCapturedData(input) {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    return isLikelySecretValue(input) ? REDACTED_VALUE : input;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((value) => sanitizeCapturedData(value));

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      isSensitiveBodyField(key) ? REDACTED_VALUE : sanitizeCapturedData(value),
    ]),
  );
}

export function sanitizeCaptureEvent(event = {}) {
  const sanitized = sanitizeCapturedData(event);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {};

  const postDataIsStructured = sanitized.postData
    && typeof sanitized.postData === "object";
  const bodyIsStructured = sanitized.body
    && typeof sanitized.body === "object";

  return {
    ...sanitized,
    ...(Object.hasOwn(sanitized, "url") ? { url: redactSensitiveUrl(sanitized.url) } : {}),
    ...(Object.hasOwn(sanitized, "headers") ? { headers: redactSensitiveHeaders(sanitized.headers) } : {}),
    ...(Object.hasOwn(sanitized, "postData") ? {
      postData: postDataIsStructured ? sanitized.postData : null,
      postDataOmitted: Boolean(sanitized.postData) || Boolean(sanitized.postDataOmitted),
    } : {}),
    ...(Object.hasOwn(sanitized, "body") ? {
      body: bodyIsStructured ? sanitized.body : null,
      bodyOmitted: Boolean(sanitized.body) || Boolean(sanitized.bodyOmitted),
    } : {}),
  };
}

export function sanitizeWebStorage(storage = {}) {
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) return {};

  return Object.fromEntries(Object.entries(storage).map(([key, value]) => {
    if (isSensitiveBodyField(key) || isSensitiveHeaderName(key) || isLikelySecretValue(value)) {
      return [key, REDACTED_VALUE];
    }

    const parsed = safeJsonParse(value);
    if (parsed && typeof parsed === "object") {
      return [key, JSON.stringify(sanitizeCapturedData(parsed))];
    }
    return [key, value];
  }));
}

export async function cleanupCaptureFiles(dirPath, {
  maxAgeDays = 30,
  maxFiles = 20,
  now = Date.now(),
  preservePaths = [],
} = {}) {
  await ensureDir(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const preserve = new Set(preservePaths.map((filePath) => path.resolve(filePath)));
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    const filePath = path.join(dirPath, entry.name);
    const stat = await fs.stat(filePath);
    candidates.push({ filePath, mtimeMs: stat.mtimeMs });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const protectedCount = candidates.filter(({ filePath }) => preserve.has(path.resolve(filePath))).length;
  let regularKeepBudget = Math.max(0, Math.floor(Number(maxFiles) || 0) - protectedCount);
  const maxAgeMs = Math.max(0, Number(maxAgeDays) || 0) * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const candidate of candidates) {
    const isProtected = preserve.has(path.resolve(candidate.filePath));
    const isExpired = maxAgeMs === 0 || now - candidate.mtimeMs > maxAgeMs;
    const keep = isProtected || (!isExpired && regularKeepBudget > 0);
    if (keep) {
      if (!isProtected) regularKeepBudget -= 1;
      await hardenPrivateFile(candidate.filePath);
      continue;
    }

    await fs.rm(candidate.filePath, { force: true });
    removed.push(candidate.filePath);
  }

  return removed;
}

export function nowStamp() {
  return new Date().toISOString();
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function looksLikeJson(contentType = "") {
  return /json|graphql/i.test(contentType);
}

export function extractInterestingValues(input, matches = [], trail = []) {
  if (input === null || input === undefined) return matches;

  if (Array.isArray(input)) {
    input.forEach((value, index) => extractInterestingValues(value, matches, [...trail, `[${index}]`]));
    return matches;
  }

  if (typeof input === "object") {
    Object.entries(input).forEach(([key, value]) => {
      const nextTrail = [...trail, key];
      if (/(retailer|account|ohlq|customer|location|license|cart|checkout)/i.test(key)) {
        matches.push({
          path: nextTrail.join("."),
          value,
        });
      }
      extractInterestingValues(value, matches, nextTrail);
    });
    return matches;
  }

  if (typeof input === "string" && /(retailer|account|ohlq|customer|location|license)/i.test(input)) {
    matches.push({
      path: trail.join("."),
      value: input,
    });
  }

  return matches;
}

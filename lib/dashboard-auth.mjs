export const DASHBOARD_SESSION_COOKIE = "onpar_dashboard_session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const DASHBOARD_SESSION_SECRET_MIN_LENGTH = 32;

const SESSION_VERSION = 1;
const SESSION_PREFIX = `v${SESSION_VERSION}`;
const CLOCK_SKEW_SECONDS = 60;

export class DashboardAuthConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DashboardAuthConfigurationError";
    this.code = code;
    this.status = 500;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left ?? ""));
  const rightBytes = new TextEncoder().encode(String(right ?? ""));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

async function signValue(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

function getSessionSecret(env = process.env) {
  return clean(env.DASHBOARD_SESSION_SECRET);
}

export function getDashboardRoles(env = process.env) {
  return [
    { role: "owner", password: clean(env.DASHBOARD_PASSWORD) },
    { role: "employee", password: clean(env.EMPLOYEE_DASHBOARD_PASSWORD) },
  ].filter((entry) => entry.password);
}

export function getDashboardAuthStatus(env = process.env) {
  const roles = getDashboardRoles(env);
  const sessionSecret = getSessionSecret(env);
  const hasOwnerPassword = roles.some((entry) => entry.role === "owner");
  const hasSessionSecret = Boolean(sessionSecret);
  const sessionSecretStrong = sessionSecret.length >= DASHBOARD_SESSION_SECRET_MIN_LENGTH;
  const issues = [];

  if (!hasOwnerPassword) issues.push("missing-owner-password");
  if (!hasSessionSecret) issues.push("missing-session-secret");
  else if (!sessionSecretStrong) issues.push("weak-session-secret");

  return {
    ready: issues.length === 0,
    hasOwnerPassword,
    employeeEnabled: roles.some((entry) => entry.role === "employee"),
    hasSessionSecret,
    sessionSecretStrong,
    issues,
  };
}

export function requireDashboardAuthConfiguration(env = process.env) {
  const status = getDashboardAuthStatus(env);
  if (!status.hasOwnerPassword) {
    throw new DashboardAuthConfigurationError(
      "DASHBOARD_PASSWORD_MISSING",
      "DASHBOARD_PASSWORD is not configured.",
    );
  }
  if (!status.hasSessionSecret) {
    throw new DashboardAuthConfigurationError(
      "DASHBOARD_SESSION_SECRET_MISSING",
      "DASHBOARD_SESSION_SECRET is not configured.",
    );
  }
  if (!status.sessionSecretStrong) {
    throw new DashboardAuthConfigurationError(
      "DASHBOARD_SESSION_SECRET_WEAK",
      `DASHBOARD_SESSION_SECRET must be at least ${DASHBOARD_SESSION_SECRET_MIN_LENGTH} characters.`,
    );
  }
  return status;
}

export function matchDashboardRole(submittedPassword, env = process.env) {
  const password = String(submittedPassword ?? "");
  const roles = getDashboardRoles(env);
  return roles.find((entry) => constantTimeEqual(password, entry.password)) || null;
}

function createSessionId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function getNowSeconds(now) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  const resolved = Number.isFinite(timestamp) ? timestamp : Date.now();
  return Math.floor(resolved / 1000);
}

export async function signDashboardSession(
  role,
  {
    env = process.env,
    now = Date.now(),
    maxAgeSeconds = DASHBOARD_SESSION_MAX_AGE_SECONDS,
  } = {},
) {
  requireDashboardAuthConfiguration(env);
  const roleEntry = getDashboardRoles(env).find((entry) => entry.role === role);
  if (!roleEntry) throw new Error("Cannot create a session for an unavailable dashboard role.");

  const lifetime = Math.max(60, Math.min(
    DASHBOARD_SESSION_MAX_AGE_SECONDS,
    Math.floor(Number(maxAgeSeconds) || DASHBOARD_SESSION_MAX_AGE_SECONDS),
  ));
  const issuedAt = getNowSeconds(now);
  const payload = stringToBase64Url(JSON.stringify({
    v: SESSION_VERSION,
    role: roleEntry.role,
    iat: issuedAt,
    exp: issuedAt + lifetime,
    sid: createSessionId(),
  }));
  const signature = await signValue(
    getSessionSecret(env),
    `${SESSION_PREFIX}.${payload}.${roleEntry.password}`,
  );
  return `${SESSION_PREFIX}.${payload}.${signature}`;
}

function parseSessionPayload(payload) {
  try {
    const parsed = JSON.parse(base64UrlToString(payload));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getDashboardSessionRole(
  sessionValue,
  { env = process.env, now = Date.now() } = {},
) {
  if (!sessionValue || !getDashboardAuthStatus(env).ready) return "";

  const parts = String(sessionValue).split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) return "";
  const [, encodedPayload, suppliedSignature] = parts;
  const payload = parseSessionPayload(encodedPayload);
  const roleEntry = getDashboardRoles(env).find((entry) => entry.role === payload?.role);
  if (!payload || payload.v !== SESSION_VERSION || !roleEntry) return "";

  const issuedAt = Number(payload.iat);
  const expiresAt = Number(payload.exp);
  const currentTime = getNowSeconds(now);
  if (
    !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(expiresAt)
    || !clean(payload.sid)
    || issuedAt > currentTime + CLOCK_SKEW_SECONDS
    || expiresAt <= currentTime
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > DASHBOARD_SESSION_MAX_AGE_SECONDS
  ) {
    return "";
  }

  const expectedSignature = await signValue(
    getSessionSecret(env),
    `${SESSION_PREFIX}.${encodedPayload}.${roleEntry.password}`,
  );
  return constantTimeEqual(suppliedSignature, expectedSignature) ? roleEntry.role : "";
}

export async function getDashboardRequestRole(request, options = {}) {
  const session = request?.cookies?.get(DASHBOARD_SESSION_COOKIE)?.value || "";
  return getDashboardSessionRole(session, options);
}

export async function requireDashboardRequestRole(
  request,
  { owner = false, ...options } = {},
) {
  const role = await getDashboardRequestRole(request, options);
  if (!role || (owner && role !== "owner")) {
    const error = new Error(role ? "Owner login required." : "Login required.");
    error.code = role ? "OWNER_REQUIRED" : "LOGIN_REQUIRED";
    error.status = role ? 403 : 401;
    throw error;
  }
  return role;
}

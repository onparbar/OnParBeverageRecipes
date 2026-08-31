import {
  DASHBOARD_IDENTITY_AUTH_VERSION,
  getDashboardIdentityById,
  getDashboardIdentityCoverage,
  matchDashboardIdentityPin,
} from "./dashboard-identities.mjs";

export const DASHBOARD_SESSION_COOKIE = "onpar_dashboard_session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const DASHBOARD_SESSION_SECRET_MIN_LENGTH = 32;

const SESSION_VERSION = 2;
const SESSION_PREFIX = "v" + SESSION_VERSION;
const CLOCK_SKEW_SECONDS = 60;
const VALID_ROLES = new Set(["owner", "employee"]);

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
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function getRecoveryIdentity(role) {
  return {
    id: "recovery-" + role,
    name: role === "owner" ? "Administrator" : "Staff",
    role,
    recovery: true,
  };
}

export function getDashboardAuthStatus(env = process.env) {
  const roles = getDashboardRoles(env);
  const coverage = getDashboardIdentityCoverage();
  const sessionSecret = getSessionSecret(env);
  const hasOwnerPassword = roles.some((entry) => entry.role === "owner");
  const ownerEnabled = coverage.admins > 0 || hasOwnerPassword;
  const hasSessionSecret = Boolean(sessionSecret);
  const sessionSecretStrong = sessionSecret.length >= DASHBOARD_SESSION_SECRET_MIN_LENGTH;
  const issues = [];

  if (!ownerEnabled) issues.push("missing-owner-password");
  if (!hasSessionSecret) issues.push("missing-session-secret");
  else if (!sessionSecretStrong) issues.push("weak-session-secret");

  return {
    ready: issues.length === 0,
    hasOwnerPassword,
    ownerEnabled,
    employeeEnabled: coverage.staff > 0 || roles.some((entry) => entry.role === "employee"),
    hasSessionSecret,
    sessionSecretStrong,
    identityCount: coverage.total,
    issues,
  };
}

export function requireDashboardAuthConfiguration(env = process.env) {
  const status = getDashboardAuthStatus(env);
  if (!status.ownerEnabled) {
    throw new DashboardAuthConfigurationError(
      "DASHBOARD_PASSWORD_MISSING",
      "No dashboard administrator credential is configured.",
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
      "DASHBOARD_SESSION_SECRET must be at least "
        + DASHBOARD_SESSION_SECRET_MIN_LENGTH
        + " characters.",
    );
  }
  return status;
}

export function matchDashboardRole(submittedPassword, env = process.env) {
  const password = String(submittedPassword ?? "");
  const roles = getDashboardRoles(env);
  return roles.find((entry) => constantTimeEqual(password, entry.password)) || null;
}

export async function matchDashboardIdentity(submittedPassword, env = process.env) {
  const identity = await matchDashboardIdentityPin(submittedPassword);
  if (identity) return identity;
  const recoveryRole = matchDashboardRole(submittedPassword, env);
  return recoveryRole ? getRecoveryIdentity(recoveryRole.role) : null;
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

function resolveSessionIdentity(identityOrRole, env) {
  if (typeof identityOrRole === "string") {
    const role = clean(identityOrRole);
    if (!getDashboardRoles(env).some((entry) => entry.role === role)) return null;
    return getRecoveryIdentity(role);
  }

  const id = clean(identityOrRole?.id);
  const name = clean(identityOrRole?.name);
  const role = clean(identityOrRole?.role);
  if (!id || !name || !VALID_ROLES.has(role)) return null;

  const rosterIdentity = getDashboardIdentityById(id);
  if (rosterIdentity) {
    return rosterIdentity.name === name && rosterIdentity.role === role
      ? { id, name, role }
      : null;
  }

  if (
    id === "recovery-" + role
    && getDashboardRoles(env).some((entry) => entry.role === role)
  ) {
    return getRecoveryIdentity(role);
  }
  return null;
}

function getSessionSigningMessage(encodedPayload, identity, env) {
  const baseMessage = SESSION_PREFIX + "." + encodedPayload;
  if (!identity?.recovery) return baseMessage;
  const recoveryRole = getDashboardRoles(env)
    .find((entry) => entry.role === identity.role);
  return recoveryRole?.password
    ? baseMessage + "." + recoveryRole.password
    : "";
}

export async function signDashboardSession(
  identityOrRole,
  {
    env = process.env,
    now = Date.now(),
    maxAgeSeconds = DASHBOARD_SESSION_MAX_AGE_SECONDS,
  } = {},
) {
  requireDashboardAuthConfiguration(env);
  const identity = resolveSessionIdentity(identityOrRole, env);
  if (!identity) throw new Error("Cannot create a session for an unavailable dashboard identity.");

  const lifetime = Math.max(60, Math.min(
    DASHBOARD_SESSION_MAX_AGE_SECONDS,
    Math.floor(Number(maxAgeSeconds) || DASHBOARD_SESSION_MAX_AGE_SECONDS),
  ));
  const issuedAt = getNowSeconds(now);
  const payload = stringToBase64Url(JSON.stringify({
    v: SESSION_VERSION,
    av: DASHBOARD_IDENTITY_AUTH_VERSION,
    sub: identity.id,
    name: identity.name,
    role: identity.role,
    iat: issuedAt,
    exp: issuedAt + lifetime,
    sid: createSessionId(),
  }));
  const signingMessage = getSessionSigningMessage(payload, identity, env);
  if (!signingMessage) throw new Error("Cannot sign an unavailable recovery identity.");
  const signature = await signValue(getSessionSecret(env), signingMessage);
  return SESSION_PREFIX + "." + payload + "." + signature;
}

function parseSessionPayload(payload) {
  try {
    const parsed = JSON.parse(base64UrlToString(payload));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getDashboardSessionIdentity(
  sessionValue,
  { env = process.env, now = Date.now() } = {},
) {
  if (!sessionValue || !getDashboardAuthStatus(env).ready) return null;

  const parts = String(sessionValue).split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_PREFIX) return null;
  const [, encodedPayload, suppliedSignature] = parts;
  const payload = parseSessionPayload(encodedPayload);
  if (
    !payload
    || payload.v !== SESSION_VERSION
    || payload.av !== DASHBOARD_IDENTITY_AUTH_VERSION
  ) {
    return null;
  }

  const identity = resolveSessionIdentity({
    id: payload.sub,
    name: payload.name,
    role: payload.role,
  }, env);
  if (!identity) return null;

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
    return null;
  }

  const signingMessage = getSessionSigningMessage(encodedPayload, identity, env);
  if (!signingMessage) return null;
  const expectedSignature = await signValue(getSessionSecret(env), signingMessage);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  return { id: identity.id, name: identity.name, role: identity.role };
}

export async function getDashboardSessionRole(sessionValue, options = {}) {
  const identity = await getDashboardSessionIdentity(sessionValue, options);
  return identity?.role || "";
}

export async function getDashboardRequestIdentity(request, options = {}) {
  const session = request?.cookies?.get(DASHBOARD_SESSION_COOKIE)?.value || "";
  return getDashboardSessionIdentity(session, options);
}

export async function getDashboardRequestRole(request, options = {}) {
  const identity = await getDashboardRequestIdentity(request, options);
  return identity?.role || "";
}

export async function requireDashboardRequestIdentity(
  request,
  { owner = false, ...options } = {},
) {
  const identity = await getDashboardRequestIdentity(request, options);
  if (!identity || (owner && identity.role !== "owner")) {
    const error = new Error(identity ? "Owner login required." : "Login required.");
    error.code = identity ? "OWNER_REQUIRED" : "LOGIN_REQUIRED";
    error.status = identity ? 403 : 401;
    throw error;
  }
  return identity;
}

export async function requireDashboardRequestRole(request, options = {}) {
  const identity = await requireDashboardRequestIdentity(request, options);
  return identity.role;
}

export const DASHBOARD_SESSION_COOKIE = "onpar_dashboard_session";

const SESSION_MESSAGE = "onpar-dashboard-login";

async function signValue(password, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getDashboardRoles() {
  return [
    { role: "owner", password: process.env.DASHBOARD_PASSWORD || "" },
    { role: "employee", password: process.env.EMPLOYEE_DASHBOARD_PASSWORD || "" },
  ].filter((entry) => entry.password);
}

export async function signDashboardSession(role, password) {
  const signature = await signValue(password, `${SESSION_MESSAGE}:${role}`);
  return `${role}.${signature}`;
}

export async function getDashboardSessionRole(sessionValue) {
  if (!sessionValue) return "";

  const roles = getDashboardRoles();
  for (const entry of roles) {
    if (sessionValue === await signDashboardSession(entry.role, entry.password)) {
      return entry.role;
    }
  }

  const owner = roles.find((entry) => entry.role === "owner");
  if (owner && sessionValue === await signValue(owner.password, SESSION_MESSAGE)) {
    return "owner";
  }

  return "";
}

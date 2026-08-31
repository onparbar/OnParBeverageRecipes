const SAME_ORIGIN_BASE = "https://onpar-dashboard.invalid";

function parseSameOriginPath(value) {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return "";
  }

  try {
    const base = new URL(SAME_ORIGIN_BASE);
    const target = new URL(candidate, base);
    if (target.origin !== base.origin) return "";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "";
  }
}

export function getSafeDashboardNextPath(value, fallback = "/") {
  const safeFallback = parseSameOriginPath(fallback) || "/";
  return parseSameOriginPath(value) || safeFallback;
}

export function getDashboardPostLoginPath(role, requestedPath) {
  if (role === "employee") return "/staff";

  const safeNextPath = getSafeDashboardNextPath(requestedPath);
  return /^\/staff(?:[/?#]|$)/.test(safeNextPath) ? "/" : safeNextPath;
}

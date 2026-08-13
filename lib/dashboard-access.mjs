export function isEmployeeAllowedDashboardRequest({ pathname = "", method = "GET" } = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (pathname === "/staff") return normalizedMethod === "GET";
  if (pathname === "/staff-dashboard.js") return normalizedMethod === "GET";
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/session") return normalizedMethod === "GET";
    if (pathname === "/api/recipe-data") return normalizedMethod === "GET";
    if (pathname === "/api/staff-prep-plan") return ["GET", "POST"].includes(normalizedMethod);
    return pathname === "/api/logout" && ["GET", "POST"].includes(normalizedMethod);
  }
  return false;
}

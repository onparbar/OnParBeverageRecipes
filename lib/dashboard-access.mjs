export function isEmployeeAllowedDashboardRequest({ pathname = "", method = "GET" } = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (pathname === "/staff") return normalizedMethod === "GET";
  if ([
    "/staff-dashboard.js",
    "/smart-receiving.mjs",
    "/smart-receiving.css",
  ].includes(pathname)) {
    return normalizedMethod === "GET";
  }
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/session") return normalizedMethod === "GET";
    if (pathname === "/api/recipe-data") return normalizedMethod === "GET";
    if (pathname === "/api/staff-prep-plan") return ["GET", "POST"].includes(normalizedMethod);
    if (pathname === "/api/staff-tap-sheets") return normalizedMethod === "GET";
    if (pathname === "/api/weekly-order-tracking") return ["GET", "POST"].includes(normalizedMethod);
    return pathname === "/api/logout" && ["GET", "POST"].includes(normalizedMethod);
  }
  return false;
}

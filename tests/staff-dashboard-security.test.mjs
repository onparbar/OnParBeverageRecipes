import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function readProjectFile(relativePath) {
  return readFile(new URL(relativePath, projectRoot), "utf8");
}

test("staff bundle does not contain owner pricing, ordering, or browser-storage data", async () => {
  const [staffBundle, ownerBundle] = await Promise.all([
    readProjectFile("public/staff-dashboard.js"),
    readProjectFile("public/dashboard.js"),
  ]);

  assert.match(ownerBundle, /DEFAULT_PRICE_OVERRIDES/);
  assert.match(ownerBundle, /bottlePrice:\s*"44\.18"/);

  const forbiddenMarkers = [
    "DEFAULT_PRICE_OVERRIDES",
    "DEFAULT_KEG_PRICE_OVERRIDES",
    "bottlePrice",
    "kegPrice",
    "44.18",
    "sessionStorage",
    "/api/dashboard-state",
    "/api/inventory-state",
    "/api/keg-par-agent",
    "/api/vendor-sync",
    "/data/",
  ];
  forbiddenMarkers.forEach((marker) => {
    assert.equal(staffBundle.includes(marker), false, `staff bundle must not contain ${marker}`);
  });
});

test("authenticated staff and owners can load staff checklists regardless of browser history", async () => {
  const staffBundle = await readProjectFile("public/staff-dashboard.js");
  assert.match(staffBundle, /!\["employee", "owner"\]\.includes\(session\.role\)/);
  assert.match(staffBundle, /if \(!sessionResponse\.ok\)\s*\{\s*window\.location\.replace\("\/login\?next=\/staff"\);\s*return;/);
  assert.doesNotMatch(staffBundle, /inspectStaffBrowserProfile|lockStaffRecipesForBrowserProfile|locked in this browser profile/);
  const roleGate = staffBundle.indexOf('if (!["employee", "owner"].includes(session.role))');
  const loadChecklists = staffBundle.indexOf("await refreshStaffSections()", roleGate);
  assert.ok(roleGate >= 0 && loadChecklists > roleGate);
});

test("staff access neither reads nor clears owner browser data and has no preview bypass", async () => {
  const staffBundle = await readProjectFile("public/staff-dashboard.js");
  assert.doesNotMatch(staffBundle, /localStorage|cocktail-dashboard-|isLocalStaffPreview/);
});

test("staff bundle communicates only with session, sanitized recipes, prep, and receipt endpoints", async () => {
  const staffBundle = await readProjectFile("public/staff-dashboard.js");
  const literalApiPaths = [...staffBundle.matchAll(/["'`](\/api\/[a-z0-9?=${}.\-_/]+)["'`]/gi)]
    .map((match) => match[1]);

  assert.ok(literalApiPaths.includes("/api/session"));
  assert.ok(literalApiPaths.some((path) => path.startsWith("/api/recipe-data")));
  assert.deepEqual(
    [...new Set(literalApiPaths.map((path) => path.split("?")[0]))].sort(),
    ["/api/recipe-data", "/api/session", "/api/staff-prep-plan", "/api/staff-tap-sheets", "/api/weekly-order-tracking"],
  );
});

test("staff page loads only its dedicated bundle", async () => {
  const page = await readProjectFile("app/staff/page.jsx");
  assert.match(page, /import Script from "next\/script"/);
  assert.match(page, /src="\/staff-dashboard\.js\?v=[^"]+"/);
  assert.match(page, /strategy="afterInteractive"/);
  assert.equal(page.includes("/dashboard.js"), false);
  assert.equal(page.includes("Beverage Ops"), false);
  assert.equal(page.includes("Inventory"), false);
  assert.equal(page.includes("Pricing"), false);
  assert.match(page, /Cocktails to make/);
  assert.match(page, /Orders to receive/);
  assert.match(await readProjectFile("public/staff-dashboard.js"), /Completed by/);
  assert.match(await readProjectFile("public/staff-receiving-view.mjs"), /Total accepted so far/);
});

test("middleware redirects employee root access, allows owner staff previews, and blocks non-staff assets", async () => {
  const middlewareSource = await readProjectFile("middleware.js");
  assert.match(middlewareSource, /sessionRole === "employee"/);
  assert.match(middlewareSource, /pathname === "\/"[\s\S]*redirectToPublicPath\(request, "\/staff"\)/);
  assert.match(middlewareSource, /!isEmployeeAllowedDashboardRequest/);
  assert.doesNotMatch(middlewareSource, /if \(pathname === "\/staff"\)/);
});

test("middleware keeps authentication redirects on the browser's public origin", async () => {
  const middlewareSource = await readProjectFile("middleware.js");
  assert.match(middlewareSource, /PUBLIC_HOSTS = new Set\(\["onparbev\.com", "www\.onparbev\.com"\]\)/);
  assert.match(middlewareSource, /function redirectToPublicPath\(request, pathname, searchParams/);
  assert.match(middlewareSource, /request\.headers\.get\("cf-ray"\)/);
  assert.match(middlewareSource, /return request\.nextUrl\.origin/);
  assert.match(middlewareSource, /redirectToPublicPath\(request, "\/login", loginParams\)/);
  assert.doesNotMatch(middlewareSource, /request\.nextUrl\.clone\(\)/);
  assert.doesNotMatch(middlewareSource, /Location: location/);
});

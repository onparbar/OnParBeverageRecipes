import assert from "node:assert/strict";
import test from "node:test";

import { isEmployeeAllowedDashboardRequest } from "../lib/dashboard-access.mjs";

test("employee access denies every direct operational data file", () => {
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/data/cocktail-recipes.csv" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/data/new-cocktails.csv" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/data/inventory-2026-06-01.csv" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/data/weekly-usage-history.csv" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/data/keg-levels-template.csv" }), false);
});

test("employee access is restricted to the dedicated staff page and bundle", () => {
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/staff", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/staff", method: "POST" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/staff-dashboard.js", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/smart-receiving.mjs", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/smart-receiving.css", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/smart-receiving.mjs", method: "POST" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/dashboard.js", method: "GET" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/ingredient-price-defaults.mjs", method: "GET" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/beer-keg-pricing.mjs", method: "GET" }), false);
});

test("employee API access is limited to recipes, prep, and delivery receipt tracking", () => {
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/session", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/recipe-data", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/recipe-data", method: "POST" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/staff-prep-plan", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/staff-prep-plan", method: "POST" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/staff-prep-plan", method: "DELETE" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/weekly-order-tracking", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/weekly-order-tracking", method: "POST" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/weekly-order-tracking", method: "DELETE" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/logout", method: "GET" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/logout", method: "POST" }), true);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/dashboard-state", method: "GET" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/dashboard-state", method: "POST" }), false);
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/api/pmb-weekly-usage", method: "GET" }), false);
});

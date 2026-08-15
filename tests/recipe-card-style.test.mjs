import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [stylesheet, dashboardSource, staffDashboardSource, staffPageSource] = await Promise.all([
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/staff-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../app/staff/page.jsx", import.meta.url), "utf8"),
]);

test("cocktail recipe card headers use one clean uppercase sans-serif style", () => {
  const recipeTitleRule = stylesheet.match(/\.recipe-card h2 \{(?<body>[^}]+)\}/)?.groups?.body || "";

  assert.match(recipeTitleRule, /font-family: "IBM Plex Sans", sans-serif/);
  assert.match(recipeTitleRule, /font-weight: 800/);
  assert.match(recipeTitleRule, /text-decoration: none/);
  assert.match(recipeTitleRule, /text-transform: uppercase/);
  assert.doesNotMatch(recipeTitleRule, /Fraunces/);
});

test("staff cocktail names share one normalized title-case font treatment", () => {
  assert.match(staffDashboardSource, /function formatStaffCocktailName\(value\)/);
  assert.match(staffDashboardSource, /\.toLocaleLowerCase\("en-US"\)/);
  assert.match(staffDashboardSource, /heading\.className = "staff-cocktail-name"/);
  assert.match(staffDashboardSource, /recipeName\.className = "staff-cocktail-name"/);
  assert.match(stylesheet, /\.staff-recipe-shell \{\s*--staff-cocktail-font: "IBM Plex Sans", Arial, sans-serif/s);
  assert.match(stylesheet, /\.staff-cocktail-name \{[^}]*font-family: var\(--staff-cocktail-font\) !important[^}]*text-transform: none/s);
});

test("staff header presents Weekly Plan with a decorative Staff View accent", () => {
  assert.match(staffPageSource, /<p className="staff-view-mark">Staff View<\/p>/);
  assert.match(staffPageSource, /<h1>Weekly Plan<\/h1>/);
  const staffViewMarkRule = stylesheet.match(/\.staff-view-mark \{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(staffViewMarkRule, /font-family: "Caveat", "Comic Sans MS", cursive/);
  assert.match(staffViewMarkRule, /color: var\(--tomato\)/);
});

test("staff overview makes the active plan date range prominent", () => {
  assert.match(staffPageSource, /id="staff-overview-week" className="staff-overview-week"/);
  const weekRule = stylesheet.match(/\.staff-recipe-intro > \.staff-overview-week \{(?<body>[^}]+)\}/)?.groups?.body || "";
  assert.match(weekRule, /font-size: clamp\(1\.35rem, 2\.6vw, 2rem\)/);
  assert.match(weekRule, /font-family: "Fraunces", serif/);
  assert.match(weekRule, /border-left: 5px solid var\(--gold\)/);
});

test("recipe cards place a prominent total ounce value immediately before Edit", () => {
  const cardRendererStart = dashboardSource.indexOf("function createRecipeCard(");
  const cardRendererEnd = dashboardSource.indexOf("function getRecipeCardAddAmount", cardRendererStart);
  const cardRenderer = dashboardSource.slice(cardRendererStart, cardRendererEnd);
  const totalPosition = cardRenderer.indexOf('class="recipe-card__total-oz"');
  const editPosition = cardRenderer.indexOf('data-action="edit"');
  const ownerSummaryStart = cardRenderer.indexOf(': [');

  assert.ok(totalPosition >= 0);
  assert.ok(totalPosition < editPosition);
  assert.match(cardRenderer, /<strong>\$\{formatNumber\(totals\.oz\)\}<\/strong>\s*<span>oz<\/span>/);
  assert.doesNotMatch(cardRenderer.slice(ownerSummaryStart), /\["Total oz", formatNumber\(totals\.oz\)\]/);
  assert.match(stylesheet, /\.recipe-card__total-oz strong \{[^}]*font-size: 1\.65rem/s);
});

test("recipe card ounce totals and Show more controls are centered", () => {
  const totalRule = stylesheet.match(/\.recipe-card__total-oz \{(?<body>[^}]+)\}/)?.groups?.body || "";
  const detailsRule = stylesheet.match(/\.recipe-card__details-summary \{(?<body>[^}]+)\}/)?.groups?.body || "";

  assert.match(totalRule, /flex: 1 1 auto/);
  assert.match(totalRule, /justify-content: center/);
  assert.match(detailsRule, /text-align: center/);
});

test("employee recipe cards contain no money or profit information", () => {
  const staffCardStart = staffDashboardSource.indexOf("function createRecipeCard(");
  const staffCardEnd = staffDashboardSource.indexOf("function createEmptyState", staffCardStart);
  const staffCardRenderer = staffDashboardSource.slice(staffCardStart, staffCardEnd);
  const employeeBranchStart = dashboardSource.indexOf("const summaryNumbers = isEmployeeDashboard");
  const employeeBranchEnd = dashboardSource.indexOf(": [", employeeBranchStart);
  const employeeSummary = dashboardSource.slice(employeeBranchStart, employeeBranchEnd);

  assert.doesNotMatch(staffCardRenderer, /money\(|Total cost|Profit margin|costPerOz|pricing\.margin/);
  assert.doesNotMatch(employeeSummary, /Total cost|Profit margin|money\(/);
  assert.match(staffCardRenderer, /\["Ingredient", "Add"\]/);
});

test("employee recipe summaries keep only recipe count and total ounces", () => {
  const staffStatsStart = staffDashboardSource.indexOf("function renderStats(");
  const staffStatsEnd = staffDashboardSource.indexOf("function createRecipeCard(", staffStatsStart);
  const staffStatsRenderer = staffDashboardSource.slice(staffStatsStart, staffStatsEnd);
  const staffCardStart = staffDashboardSource.indexOf("function createRecipeCard(");
  const staffCardEnd = staffDashboardSource.indexOf("function createEmptyState", staffCardStart);
  const staffCardRenderer = staffDashboardSource.slice(staffCardStart, staffCardEnd);

  assert.doesNotMatch(staffStatsRenderer, /Spirit groups|Avg batch oz|ingredientNames/);
  assert.match(staffStatsRenderer, /visibleCount === recipes\.length \? "Recipes" : "Recipes shown"/);
  assert.match(staffCardRenderer, /totalValue\.textContent = formatNumber\(getTotalOunces\(recipe\)\)/);
  assert.match(staffCardRenderer, /totalLabel\.textContent = "Total oz"/);
  assert.doesNotMatch(staffCardRenderer, /String\(recipe\.ingredients\.length\)|\[formatBatchLabel\(recipe\.batch\), "Batch"\]/);
  assert.doesNotMatch(staffCardRenderer, /spirit-pill|recipe-card__batch|recipe-card__numbers/);
  assert.match(staffCardRenderer, /getStaffRecipeDisplayTitle\(recipe\.title\)/);
  assert.match(stylesheet, /\.staff-recipe-card \.staff-recipe-card__header h2 \{[^}]*text-transform: none/s);
});

test("employee recipes match the 30 current menu cards and separate deactivated recipes", async () => {
  const staffPageSource = await readFile(new URL("../app/staff/page.jsx", import.meta.url), "utf8");
  const menuStart = staffDashboardSource.indexOf("const STAFF_MENU_ORDER = [");
  const menuEnd = staffDashboardSource.indexOf("const STAFF_NEW_RECIPE_ORDER", menuStart);
  const newStart = menuEnd;
  const newEnd = staffDashboardSource.indexOf("const searchInput", newStart);
  const menuEntries = [...staffDashboardSource.slice(menuStart, menuEnd).matchAll(/^\s+\["/gm)];
  const newEntries = [...staffDashboardSource.slice(newStart, newEnd).matchAll(/^\s+\["/gm)];

  assert.equal(menuEntries.length, 26);
  assert.equal(newEntries.length, 4);
  assert.match(staffDashboardSource, /applyStaffRecipeOrder\(parseRecipes\(parseCsv\(activeCsv\)\), STAFF_MENU_ORDER\)/);
  assert.match(staffDashboardSource, /activeRecipeView === "inactive" \? inactiveRecipes : currentRecipes/);
  assert.match(staffPageSource, /data-staff-recipe-view="current"/);
  assert.match(staffPageSource, /data-staff-recipe-view="inactive"/);
  assert.match(staffPageSource, /Deactivated <span id="staff-inactive-recipe-count"/);
});

test("the employee view opens on a weekly overview with separate work tabs", async () => {
  const staffPageSource = await readFile(new URL("../app/staff/page.jsx", import.meta.url), "utf8");

  assert.match(staffPageSource, /data-staff-section-tab="overview"/);
  assert.match(staffPageSource, /data-staff-section-tab="prep"/);
  assert.match(staffPageSource, /data-staff-section-tab="recipes"/);
  assert.match(staffPageSource, /data-staff-section-tab="orders"/);
  assert.match(staffPageSource, /className="panel is-active staff-overview-panel"/);
  assert.match(staffPageSource, /data-staff-section-target="prep"/);
  assert.match(staffPageSource, /data-staff-section-target="orders"/);
  assert.match(staffPageSource, /data-staff-section-target="recipes"/);
  assert.match(staffDashboardSource, /function switchStaffSection\(section\)/);
  assert.match(staffDashboardSource, /function renderStaffOverview\(\)/);
  assert.match(stylesheet, /\.staff-section-tabs \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/s);
});

test("cocktails in the employee prep list expand their matching recipe inline", () => {
  assert.match(staffDashboardSource, /findStaffRecipeForPrepItem\(item\)/);
  assert.match(staffDashboardSource, /recipeToggle\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(staffDashboardSource, /recipeHint\.textContent = "View recipe \+"/);
  assert.match(staffDashboardSource, /createInlineStaffPrepRecipe\(recipe, recipePanelId\)/);
  assert.match(staffDashboardSource, /getIngredientAddAmount\(ingredient\.raw\)/);
  assert.match(staffDashboardSource, /getTotalOunces\(recipe\)/);
  assert.match(stylesheet, /\.staff-prep-recipe-panel \{[^}]*grid-column: 1 \/ -1/s);
  assert.match(stylesheet, /\.staff-prep-recipe-panel\[hidden\] \{\s*display: none/s);
});

test("expanded prep recipes offer optional per-container progress checks", () => {
  assert.match(staffDashboardSource, /getOptionalIngredientProgress\(ingredient\.raw\)/);
  assert.match(staffDashboardSource, /for \(let index = 1; index <= progress\.count; index \+= 1\)/);
  assert.match(staffDashboardSource, /label\.textContent = "Optional progress"/);
  assert.match(staffDashboardSource, /checkbox\.setAttribute\("aria-label", `\$\{ingredientName\}: \$\{progress\.unit\} \$\{index\} added`\)/);
  assert.match(staffDashboardSource, /count\.textContent = `\$\{completed\} of \$\{progress\.count\} \$\{progress\.unit\}`/);
  assert.match(stylesheet, /\.staff-ingredient-progress__checks \{[^}]*flex-wrap: wrap/s);
  assert.match(stylesheet, /\.staff-ingredient-progress__checks input:checked \+ span \{/);
});

test("employee prep and recipe cards have a phone-specific layout", () => {
  const mobileStart = stylesheet.indexOf("@media (max-width: 720px)");
  const mobileStyles = stylesheet.slice(mobileStart);

  assert.match(mobileStyles, /\.staff-prep-item,\s*\.staff-order-item \{\s*grid-template-columns: 1fr/s);
  assert.match(mobileStyles, /\.staff-prep-save \{[^}]*width: 100%[^}]*min-height: 48px/s);
  assert.match(mobileStyles, /\.staff-recipe-shell input,\s*\.staff-recipe-shell select \{[^}]*font-size: 16px/s);
  assert.match(mobileStyles, /\.staff-order-full-receipt \{[^}]*min-height: 48px/s);
  assert.match(mobileStyles, /\.staff-order-quantity-field input \{[^}]*width: 92px/s);
  assert.match(mobileStyles, /\.staff-section-tabs \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(staffDashboardSource, /fullReceipt\.checked = item\.status === "pending" \|\| item\.status === "received"/);
  assert.match(mobileStyles, /\.staff-recipe-card \.recipe-table-wrap \{[^}]*overflow-x: visible/s);
  assert.match(mobileStyles, /\.staff-recipe-table th:nth-child\(2\),\s*\.staff-recipe-table td:nth-child\(2\) \{\s*width: 56%/s);
  assert.match(stylesheet, /\.staff-recipe-add--bottle-size \{\s*white-space: nowrap/s);
  assert.match(staffDashboardSource, /prep\.classList\.add\("staff-recipe-add--bottle-size"\)/);
});

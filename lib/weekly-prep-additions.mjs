import { randomUUID } from "node:crypto";
import { buildStaffPrepPlan } from "./staff-prep-plan.mjs";
import { readParAgentState, writeParAgentState } from "./par-agent.mjs";
import { readSharedInventoryState } from "./inventory-shared-store.mjs";
import { readPrepRecipes, findPrepRecipe } from "./inventory-contributions.mjs";
import { recordDashboardActivity } from "./dashboard-activity-log.mjs";
import { buildWeeklyActionPlan, getCurrentWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import {
  COCKTAIL_RECIPE_YIELDS,
  getCocktailRecipeYieldOz,
  normalizeCocktailRecipeName,
} from "../public/cocktail-recipe-yields.mjs";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const COOLERS = Object.freeze({ Main: "Main cooler", Karaoke: "Karaoke cooler" });

function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = "WEEKLY_PREP_ADDITION_ERROR";
  throw error;
}

async function readContext() {
  const state = await readParAgentState();
  const snapshot = getCurrentWeeklyPlanSnapshot(state.recommendations, new Date());
  if (!state.initialized || !snapshot) fail("Save this week's Weekly Plan before adding a cocktail.");
  const recipes = (await readPrepRecipes()).filter(recipe => !recipe.inactive);
  const titles = new Set(recipes.map(recipe => recipe.title));
  for (const definition of COCKTAIL_RECIPE_YIELDS) {
    if (definition.aliases.length) {
      titles.delete(definition.sourceTitle);
      definition.aliases.forEach(title => titles.add(title));
    }
  }
  const choices = [];
  const seen = new Set();
  for (const title of titles) {
    const recipe = findPrepRecipe(recipes, { name: title });
    if (!recipe || !recipe.ingredients?.length) continue;
    const normalized = normalizeCocktailRecipeName(title);
    if (!normalized || seen.has(normalized)) continue;
    const batchSizeOz = getCocktailRecipeYieldOz(title)
      || recipe.ingredients.reduce((total, item) => total + Math.max(0, Number(item.oz) || 0), 0);
    if (!(batchSizeOz > 0)) continue;
    seen.add(normalized);
    const name = clean(title.replace(/\([^)]*\)/g, " "));
    choices.push({
      id: encodeURIComponent(normalized),
      name: name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase()) : name,
      title: clean(title), recipeId: recipe.id, batchSizeOz,
    });
  }
  const inventory = await readSharedInventoryState();
  const savedCounts = [...(inventory.snapshots || [])]
    .filter(entry => entry.kegPlanSnapshot?.generatedAt === snapshot.generatedAt)
    .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0))[0];
  const savedTaps = savedCounts?.kegPlanSnapshot?.tapInputs || [];
  // Count snapshots include taps with no current prep recommendation.
  // Never replace a saved assignment with a different product on the same tap.
  const tapSources = savedTaps.length ? savedTaps : (state.recommendations.items || []);
  for (const tap of tapSources) {
    const n = Number(tap.tapNumber);
    if (tap.prepAdditionId || !((n >= 47 && n <= 72) || (n >= 93 && n <= 102)) || /coming\s*soon/i.test(tap.name || "") || !Object.hasOwn(COOLERS, tap.wall)) continue;
    const recipe = findPrepRecipe(recipes, { name: tap.name });
    if (!recipe?.ingredients?.length) continue;
    const id = `tap:${tap.tapNumber}`;
    if (choices.some(choice => choice.id === id)) continue;
    const batchSizeOz = getCocktailRecipeYieldOz(tap.name)
      || recipe.ingredients.reduce((total, item) => total + Math.max(0, Number(item.oz) || 0), 0);
    if (!(batchSizeOz > 0)) continue;
    choices.push({ id, name: clean(tap.name), title: clean(tap.name), wall: tap.wall, tap, recipeId: recipe.id, batchSizeOz });
  }
  choices.sort((left, right) => left.name.localeCompare(right.name));
  return { state, snapshot, choices, savedCounts };
}

export async function readWeeklyPrepChoices() {
  const { state, snapshot, choices, savedCounts } = await readContext();
  return {
    revision: state.revision,
    generatedAt: snapshot.generatedAt,
    cocktails: choices.filter(choice => !choice.tap).map(({ id, name }) => ({ id, name })),
    tapCocktails: choices.filter(choice => choice.tap).map(({ id, name, wall }) => ({ id, name, wall })),
    coolers: Object.entries(COOLERS).map(([id, name]) => ({ id, name })),
    forecast: buildPrepLookahead(choices, state.recommendations.items || [], savedCounts?.savedAt),
  };
}

function buildPrepLookahead(choices, recommendations, savedAt) {
  const weeks = [{ label: "Next week", items: [] }, { label: "The week after", items: [] }];
  const unavailable = [];
  const number = value => value == null || String(value).trim() === "" ? NaN : Number(value);
  for (const choice of choices.filter(item => item.tap)) {
    const tap = choice.tap;
    const stock = number(tap.currentStockKegs);
    const usage = number(tap.avgWeeklyKegs);
    if (![stock, usage].every(value => Number.isFinite(value) && value >= 0) || tap.inventoryStateMissing) {
      unavailable.push(choice.name);
      continue;
    }
    const planned = recommendations.filter(item => item.actionType === "make"
      && Number(item.tapNumber) === Number(tap.tapNumber) && item.wall === tap.wall
      && normalizeCocktailRecipeName(item.name) === normalizeCocktailRecipeName(tap.name))
      .reduce((total, item) => total + Math.max(0, Number(item.orderQty) || 0), 0);
    const cushionValue = number(tap.variabilityCushionPct);
    const cushion = Math.min(50, Math.max(0, Number.isFinite(cushionValue) ? cushionValue : 10)) / 100;
    const shareValue = number(tap.preThursdayUsageSharePct);
    const share = Math.min(100, Math.max(0, Number.isFinite(shareValue) ? shareValue : 300 / 7)) / 100;
    let remaining = Math.max(0, stock - usage * share + planned - usage);
    for (const week of weeks) {
      const quantity = Math.max(0, Math.ceil(usage * (1 + cushion) - remaining - 1e-9));
      const suffix = tap.wall === "Karaoke" ? "2" : "1";
      const name = `${clean(choice.name).replace(/\s+[12]$/, "")} ${suffix}`;
      if (quantity) week.items.push({ id: choice.id, name, quantity });
      remaining = Math.max(0, remaining + quantity - usage);
    }
  }
  return { weeks, unavailable, savedAt: savedAt || "", hasTapData: choices.some(choice => choice.tap),
    note: "Estimates relative to the saved plan week, using saved stock and average usage. Assumes this week's planned prep is completed; not added to the plan or orders." };
}

export async function addWeeklyPrepCocktail(body, identity) {
  const quantity = Number(body.quantity);
  const wall = clean(body.cooler);
  const requestId = clean(body.requestId);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) fail("Choose between 1 and 20 kegs.", 400);
  if (!Object.hasOwn(COOLERS, wall)) fail("Choose Main cooler or Karaoke cooler.", 400);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) fail("Reload the form and try again.", 400);
  const { state, snapshot, choices } = await readContext();
  if (clean(body.generatedAt) !== snapshot.generatedAt) fail("The weekly plan changed. Reload it before adding a cocktail.");
  const additions = (state.recommendations.prepAdditions || []).filter(entry => entry.generatedAt === snapshot.generatedAt);
  const prior = additions.find(entry => entry.requestId === requestId);
  if (prior) {
    if (prior.choiceId !== body.cocktailId || prior.wall !== wall || prior.quantity !== quantity) fail("This addition has already been saved with different details.");
    return { added: true, message: prior.message, revision: state.revision };
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== state.revision) fail("The plan changed in another session. Close and reopen Add cocktail, then try again.");
  if (additions.length >= 100) fail("This plan already has 100 added prep lines.");
  const choice = choices.find(item => item.id === body.cocktailId);
  if (!choice) fail("That recipe is no longer available. Reopen Add cocktail to refresh the list.");
  if (choice.wall && choice.wall !== wall) fail("The selected tap belongs to a different cooler.", 400);

  const inventory = await readSharedInventoryState();
  const savedInputs = inventory.snapshots.find(entry => entry.kegPlanSnapshot?.generatedAt === snapshot.generatedAt)?.kegPlanSnapshot?.tapInputs || [];
  const matches = savedInputs.filter(tap => (
    clean(tap.wall) === wall
    && normalizeCocktailRecipeName(tap.name) === normalizeCocktailRecipeName(choice.title)
  ));
  const tap = choice.tap || (matches.length === 1 ? matches[0] : null);
  const name = choice.tap ? choice.title : `${choice.title.replace(/\s+[123]\s*$/, "")} ${wall === "Main" ? 1 : 2}`;
  const item = {
    ...(tap || {}),
    key: `prep-addition:${requestId}`,
    prepAdditionId: requestId,
    recipeId: choice.recipeId,
    name, orderProductName: name, wall,
    tapNumber: tap?.tapNumber || 0,
    type: "Cocktail", isKegTap: true, isLiquorTap: false,
    actionType: "make", orderQty: quantity, rawOrderQty: quantity,
    batchSizeOz: choice.batchSizeOz,
    reason: "Additional cocktail prep requested by the manager.",
  };
  const items = [...(state.recommendations.items || []), item];
  const prepPlan = buildWeeklyActionPlan({ recommendations: items });
  const message = `Added ${quantity} keg${quantity === 1 ? "" : "s"} of ${choice.name} to ${COOLERS[wall]}.`;
  const nextRevision = state.revision + 1;
  const saved = await writeParAgentState({
    ...state,
    recommendations: {
      ...state.recommendations,
      items,
      prepAdditions: [...additions, { requestId, choiceId: choice.id, recipeId: choice.recipeId, wall, quantity, message, generatedAt: snapshot.generatedAt, addedAt: new Date().toISOString(), addedBy: clean(identity.name || identity.role) }],
      summary: {
        ...state.recommendations.summary,
        cocktailMakeCount: prepPlan.summary.cocktailLineCount,
        cocktailMakeTotal: prepPlan.summary.cocktailBatchTotal,
      },
      weeklyPlanSnapshot: {
        ...snapshot,
        plan: {
          ...snapshot.plan,
          prep: prepPlan.prep,
          summary: {
            ...snapshot.plan.summary,
            cocktailLineCount: prepPlan.summary.cocktailLineCount,
            cocktailBatchTotal: prepPlan.summary.cocktailBatchTotal,
          },
        },
      },
      publishedStateRevision: nextRevision,
    },
  }, { expectedRevision: state.revision, role: identity.role });
  // Only prep changed. Existing inventory counts, vendor policies, carts,
  // placed orders, and completed prep records remain intact.
  recordDashboardActivity({ area: "Weekly Plan", action: "added cocktail prep", role: identity.role, revision: saved.revision, summary: message, dedupe: true }).catch(() => {});
  return { added: true, message, revision: saved.revision };
}

export const createPrepAdditionRequestId = () => randomUUID();

export async function subtractWeeklyPrepCocktail(body, identity) {
  const { state, snapshot } = await readContext();
  const requestId = clean(body.requestId);
  const itemId = clean(body.itemId);
  if (!/^[a-f0-9-]{36}$/i.test(requestId) || !itemId) fail("Reload prep and try again.", 400);
  if (body.generatedAt !== snapshot.generatedAt) fail("The weekly plan changed. Reload prep.");
  const removals = state.recommendations.prepRemovals || [];
  const prior = removals.find(entry => entry.requestId === requestId);
  if (prior) {
    if (prior.itemId !== itemId) fail("This request was already used for a different cocktail.");
    return { removed: true, revision: state.revision, message: prior.message };
  }
  if (body.expectedRevision !== state.revision) fail("The plan changed. Reload prep before subtracting a keg.");
  const target = buildStaffPrepPlan(state.recommendations).items.find(item => item.id === itemId);
  if (!target || target.quantity < 1) fail("That cocktail has no remaining planned kegs.");
  if (target.completed) fail("This batch is already prepared. Reopen its completion before changing the planned quantity.");
  const items = structuredClone(state.recommendations.items || []);
  const candidates = items.filter(item => item.actionType === "make" && Number(item.orderQty) > 0
    && buildStaffPrepPlan({ items: [item] }).items.some(entry => entry.id === itemId));
  const item = candidates.at(-1);
  if (!item) fail("The prep line could not be matched safely.");
  item.orderQty = Math.max(0, Number(item.orderQty) - 1);
  item.rawOrderQty = item.orderQty;
  const prep = buildWeeklyActionPlan({ recommendations: items });
  const message = `Subtracted one planned keg of ${target.displayName || target.name}.`;
  const saved = await writeParAgentState({ ...state, recommendations: {
    ...state.recommendations, items,
    prepRemovals: [...removals, { requestId, itemId, message, generatedAt: snapshot.generatedAt, removedAt: new Date().toISOString(), removedBy: clean(identity.name || identity.role) }],
    summary: { ...state.recommendations.summary, cocktailMakeCount: prep.summary.cocktailLineCount, cocktailMakeTotal: prep.summary.cocktailBatchTotal },
    weeklyPlanSnapshot: { ...snapshot, plan: { ...snapshot.plan, prep: prep.prep,
      summary: { ...snapshot.plan.summary, cocktailLineCount: prep.summary.cocktailLineCount, cocktailBatchTotal: prep.summary.cocktailBatchTotal } } },
    publishedStateRevision: state.revision + 1,
  } }, { expectedRevision: state.revision, role: identity.role });
  recordDashboardActivity({ area: "Weekly Plan", action: "subtracted cocktail prep", role: identity.role, revision: saved.revision, summary: message, dedupe: true }).catch(() => {});
  return { removed: true, revision: saved.revision, message };
}

import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";

const numeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value) => numeric(value) !== null && Number(value) > 0;

export function captureLocalAiSnapshot(context) {
  const data = context.usage();
  const usage = new Map();
  const conflicts = new Set();
  for (const item of data.items) {
    const history = new Map(item.history.map((entry) => [entry.label, entry]));
    data.labels.forEach((label, weekIndex) => {
      const ounces = numeric(history.get(label)?.ounces);
      const key = `${item.tapNumber || item.id}|${item.name.toLowerCase()}|${label}`;
      const row = {
        name: item.name, tapNumber: numeric(item.tapNumber), wall: item.wall, category: item.category,
        weekIndex, weekLabel: label, ounces,
        estimatedSales: ounces !== null && positive(item.sellingPricePerOz) ? ounces * item.sellingPricePerOz : null,
        estimatedProfit: ounces !== null && numeric(item.profitPerOz) !== null ? ounces * item.profitPerOz : null,
        kegEquivalents: ounces !== null && positive(item.kegOz) ? ounces / item.kegOz : null,
      };
      const prior = usage.get(key);
      if (prior && prior.ounces !== null && ounces !== null && Math.abs(prior.ounces - ounces) > 0.001) {
        conflicts.add(key);
        usage.set(key, { ...row, ounces: null, estimatedSales: null, estimatedProfit: null, kegEquivalents: null });
      } else if (!conflicts.has(key) && (!prior || prior.ounces === null)) usage.set(key, row);
    });
  }
  const inventory = context.inventory();
  const saveReady = inventory.state.initialized && !inventory.state.saveError && !inventory.state.savePending && !inventory.state.unsavedCount;
  const recipes = context.recipes();
  return {
    capturedAt: new Date().toISOString(),
    tables: {
      usage: [...usage.values()],
      inventory: inventory.items.map((item) => {
        const countCurrent = item.physicalCountRequired && isRecommendationForOperatingWeek(inventory.countedAt[item.id]);
        const usable = saveReady && (countCurrent || !item.physicalCountRequired);
        return {
          name: item.name, group: item.group,
          onHand: usable ? numeric(item.onHandDisplay) : null,
          countCurrent: Boolean(countCurrent), countedAt: inventory.countedAt[item.id] || null,
          orderUnits: usable && !item.orderHoldReason ? numeric(item.orderUnits) : null,
          orderHoldReason: !saveReady ? "Inventory save is pending, failed, or unavailable." : !usable ? "Current count missing." : item.orderHoldReason || "",
          orderReason: `${!item.physicalCountRequired ? "On-hand quantity is a policy assumption, not a physical count. " : ""}${item.orderReason || ""}`,
          unitCost: positive(item.unitCost) ? Number(item.unitCost) : null,
        };
      }),
      prices: context.prices().map((item) => ({ ...item, price: positive(item.price) ? Number(item.price) : null, oz: numeric(item.oz) })),
      recipes: recipes.map((item) => ({ name: item.name, oz: numeric(item.oz), cost: item.costComplete ? numeric(item.cost) : null, costComplete: item.costComplete, abv: numeric(item.abv) })),
      recipe_ingredients: recipes.flatMap((recipe) => recipe.ingredients.map((item) => ({ recipe: recipe.name, ingredient: item.name, oz: numeric(item.oz) }))),
      levels: context.levels(),
      health: context.health().map(({ name, state }) => ({ name, initialized: Boolean(state.initialized),
        savePending: Boolean(state.savePending || state.hasOutbox), saveError: state.saveError || "", unsavedCount: Number(state.unsavedCount || 0) })),
    },
  };
}

export async function requestLocalAiAnswer({ question, history, getContext, signal }) {
  const statusResponse = await fetch("/api/local-ai", { credentials: "same-origin", cache: "no-store", signal });
  if (!statusResponse.ok) throw new Error("Local AI is unavailable for this session.");
  const status = await statusResponse.json();
  if (!status.enabled) return null;
  const response = await fetch("/api/local-ai", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, snapshot: captureLocalAiSnapshot(getContext()) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The local AI could not answer this question.");
  if (typeof result.answer !== "string" || !result.answer.trim()) throw new Error("The local AI returned no answer.");
  return result;
}

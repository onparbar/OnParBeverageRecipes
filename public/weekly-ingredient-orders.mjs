import { buildRollingCocktailIngredientOrders } from "./rolling-cocktail-ingredients.mjs";
import { buildWeeklyActionPlan, createWeeklyPlanSnapshot, groupWeeklyPlanOrdersByVendor, refreshWeeklyPlanMetadata } from "./weekly-action-plan.mjs";
import { buildProofPrepOrderContext } from "./proof-prep-replacements.mjs";
import { buildUnifiedVendorOrderModel, normalizeVendorOrderPolicy } from "./vendor-order-drafts.mjs";
import { weeklyOrderItemId, legacyWeeklyOrderItemId } from "./weekly-order-item-identity.mjs";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const number = value => Math.max(0, Number(value) || 0);
const vendorKey = value => clean(value).toLowerCase();
const productKey = (vendor, item) => `${vendorKey(vendor)}|${clean(item.vendorSku || item.preferredSku || item.internalId || item.id || item.name).toLowerCase()}`;

function adjustmentContext(recommendations, snapshot, inventoryItems) {
  const adjustments = Object.values(recommendations.weeklyOrderTracking?.orderAdjustments || {})
    .filter(item => clean(item.generatedAt) === clean(recommendations.generatedAt));
  const sources = [
    ...groupWeeklyPlanOrdersByVendor(snapshot.plan).flatMap(group => group.items),
    ...(snapshot.orderCatalog || []),
    ...inventoryItems,
    ...(recommendations.items || []),
  ];
  const manualCatalog = adjustments.flatMap(adjustment => {
    const source = sources.find(item => vendorKey(item.vendor) === vendorKey(adjustment.vendor)
      && clean(item.internalId || item.id) === clean(adjustment.internalId));
    if (!source) return [];
    const orderCategory = source.orderCategory || source.category
      || (source.group === "Liquor Cabinet" ? "liquor" : source.group === "Mixer Cabinet" ? "mixers" : "supplies");
    return [{ ...source, catalogId: adjustment.catalogId, internalId: adjustment.internalId,
      orderCategory, lineType: source.lineType || (orderCategory === "liquor" ? "Liquor bottle" : orderCategory === "mixers" ? "Mixer" : "Supply") }];
  });
  return { manualAdjustments: adjustments, manualCatalog };
}

function modelUnits(model) {
  const units = new Map();
  for (const draft of model.drafts) for (const item of draft.lines) {
    const key = productKey(draft.vendor, item);
    units.set(key, (units.get(key) || 0) + number(item.requestedUnits));
  }
  return units;
}

function cabinetRefillReservations(recommendations, plan) {
  const reserved = new Map();
  for (const item of recommendations.items || []) {
    const id = clean(item.cabinetInventoryId);
    if (!item.isLiquorTap || !id) continue;
    reserved.set(id, (reserved.get(id) || 0) + number(item.cabinetUsedQty));
  }
  // Newer saved prep lines retain an exact inventory identity. This also
  // supports snapshots that no longer retain their raw recommendation rows.
  const refillsByInventory = new Map();
  for (const refill of plan.prep?.liquorRefills || []) {
    const id = clean(refill.inventoryItemId);
    if (id) refillsByInventory.set(id, [...(refillsByInventory.get(id) || []), refill]);
  }
  for (const [id, refills] of refillsByInventory) {
    const needed = refills.reduce((total, item) => total + number(item.quantity), 0);
    const purchased = (plan.orders?.liquorTapBottles || []).filter(line => refills.some(refill => {
      const identities = new Set([refill.id, ...(refill.internalIds || [])].map(clean).filter(Boolean));
      return [line.id, ...(line.internalIds || [])].some(identity => identities.has(clean(identity)))
        || (clean(refill.vendorSku) && vendorKey(line.vendor) === vendorKey(refill.vendor)
          && clean(line.vendorSku) === clean(refill.vendorSku));
    })).reduce((total, item) => total + number(item.quantity), 0);
    reserved.set(id, Math.max(reserved.get(id) || 0, needed - purchased));
  }
  return reserved;
}

/** Refresh ingredient purchasing without rewriting any placed supplier order. */
export function refreshWeeklyIngredientOrders({
  recommendations = {}, inventoryItems = [], tapInputs = [], recipes = [], recipeAliases = {},
} = {}) {
  const snapshot = recommendations.weeklyPlanSnapshot;
  if (!snapshot?.plan || !inventoryItems.length || !recipes.length) return recommendations;
  const tracking = recommendations.weeklyOrderTracking || {};
  const oldPolicy = normalizeVendorOrderPolicy(snapshot.orderPolicy || tracking.orderPolicy);
  const context = adjustmentContext(recommendations, snapshot, inventoryItems);
  const placed = new Set(Object.values(tracking.vendors || {})
    .filter(item => clean(item.orderedBy) || clean(item.orderedAt))
    .map(item => vendorKey(item.vendor)));
  const recordedDeliveries = new Set();
  if (Object.values(tracking.receipts || {}).some(receipt => clean(receipt.handledBy))) {
    const baseline = buildUnifiedVendorOrderModel(snapshot.plan, { snapshot, orderPolicy: oldPolicy, ...context });
    for (const draft of baseline.drafts) {
      if (draft.lines.some(item => [weeklyOrderItemId(draft.vendor, item), legacyWeeklyOrderItemId(draft.vendor, item)]
        .some(id => clean(tracking.receipts?.[id]?.handledBy)))) {
        recordedDeliveries.add(vendorKey(draft.vendor));
        placed.add(vendorKey(draft.vendor));
      }
    }
  }
  const cocktails = Array.isArray(recommendations.items)
    ? recommendations.items.filter(item => item.actionType === "make" && number(item.orderQty) > 0)
    : snapshot.plan.prep?.cocktails || [];
  const refillReservations = cabinetRefillReservations(recommendations, snapshot.plan);
  const purchasingInventory = inventoryItems.map(item => {
    const reserved = refillReservations.get(clean(item.id)) || 0;
    if (!reserved || item.onHand == null || !Number.isFinite(Number(item.onHand))) return item;
    const onHand = Math.max(0, number(item.onHand) - reserved);
    return { ...item, onHand, onHandDisplay: String(onHand) };
  });
  const rolling = buildRollingCocktailIngredientOrders({ inventoryItems: purchasingInventory, tapInputs, recipes, recipeAliases, cocktails })
    .map(item => {
      const reserved = refillReservations.get(clean(item.id)) || 0;
      const counted = inventoryItems.find(source => source.id === item.id);
      if (!reserved || counted?.onHand == null || !Number.isFinite(Number(counted.onHand))) return item;
      return { ...item, onHand: counted.onHand, onHandDisplay: counted.onHandDisplay,
        par: number(item.par) + reserved, rollingRefillReservedUnits: reserved,
        rollingPlanReason: clean(item.rollingPlanReason).replace(" on hand.",
          ` available after reserving ${reserved} bottles for scheduled tap refills (${number(counted.onHand)} counted).`) };
    });
  const managed = rolling.filter(item => item.rollingIngredientVersion === 1
    && /^(Liquor|Mixer) Cabinet$/i.test(item.group || ""));
  const managedIds = new Set(managed.map(item => clean(item.id)));
  const rebuilt = buildWeeklyActionPlan({ inventoryItems: managed });
  const desiredOrders = { ...snapshot.plan.orders };
  for (const collection of ["liquor", "mixers"]) {
    desiredOrders[collection] = [
      ...(snapshot.plan.orders[collection] || []).filter(item => !managedIds.has(clean(item.id || item.internalId))),
      ...rebuilt.orders[collection],
    ];
  }
  const proof = buildProofPrepOrderContext({ cocktails: snapshot.plan.prep?.cocktails || [], recipes,
    inventoryItems: purchasingInventory, savedInventoryItems: purchasingInventory, recipeAliases, tapInputs });
  const desiredPolicy = normalizeVendorOrderPolicy({
    ...oldPolicy,
    proofMinimumCandidates: proof.candidates,
    proofPrepRequirement: managed.some(item => vendorKey(item.vendor) === "proof" && number(item.orderUnits) > 0 && !item.orderHoldReason)
      ? "required" : proof.requirement,
    cocktailIngredientMinimumOrders: [
      ...oldPolicy.cocktailIngredientMinimumOrders.filter(item => !managedIds.has(clean(item.id))),
      ...rebuilt.orders.liquor.map(item => ({ ...item, reason: item.reasons?.join(" ") })),
    ],
  });
  const orders = { ...desiredOrders };
  for (const collection of ["liquor", "mixers"]) {
    orders[collection] = [
      ...(snapshot.plan.orders[collection] || []).filter(item => placed.has(vendorKey(item.vendor))),
      ...(desiredOrders[collection] || []).filter(item => !placed.has(vendorKey(item.vendor))),
    ];
  }
  const policy = normalizeVendorOrderPolicy({
    ...desiredPolicy,
    ...(placed.has("proof") ? { proofMinimumCandidates: oldPolicy.proofMinimumCandidates,
      proofPrepRequirement: oldPolicy.proofPrepRequirement } : {}),
    cocktailIngredientMinimumOrders: [
      ...oldPolicy.cocktailIngredientMinimumOrders.filter(item => placed.has(vendorKey(item.vendor))),
      ...desiredPolicy.cocktailIngredientMinimumOrders.filter(item => !placed.has(vendorKey(item.vendor))),
    ],
  });
  const plan = refreshWeeklyPlanMetadata({ ...snapshot.plan, orders,
    review: { ...snapshot.plan.review, excludedInventory: [
      ...(snapshot.plan.review?.excludedInventory || []).filter(item => !managedIds.has(clean(item.id))),
      ...rebuilt.review.excludedInventory,
    ] },
  });
  plan.prep = snapshot.plan.prep;
  const actual = modelUnits(buildUnifiedVendorOrderModel(plan, { snapshot, orderPolicy: policy, ...context }));
  // Include unchanged tap/refill purchases when netting a shared supplier SKU:
  // those bottles already have a purpose and cannot cover new prep twice.
  const desired = new Map();
  for (const group of groupWeeklyPlanOrdersByVendor({ ...snapshot.plan, orders: desiredOrders })) {
    for (const item of group.items) {
      const key = productKey(group.vendor, item);
      desired.set(key, (desired.get(key) || 0) + number(item.quantity));
    }
  }
  const ingredientOrderReview = [];
  const reviewed = new Set();
  for (const item of [...rebuilt.orders.liquor, ...rebuilt.orders.mixers]) {
    const key = productKey(item.vendor, item);
    const shortage = Math.max(0, (desired.get(key) || 0) - (actual.get(key) || 0));
    if (!shortage || reviewed.has(key)) continue;
    reviewed.add(key);
    const isPlaced = placed.has(vendorKey(item.vendor));
    const packSize = Math.max(1, number(item.packSize));
    const quantity = item.casePackaged ? Math.ceil(shortage / packSize) : shortage;
    ingredientOrderReview.push({ id: clean(item.id), name: item.name, vendor: item.vendor,
      quantity, unit: item.casePackaged ? "cases" : item.category === "liquor" ? "bottles" : "units", requestedUnits: item.casePackaged ? quantity * packSize : quantity,
      kind: isPlaced ? "additional-order" : "adjustment-shortage",
      reason: isPlaced
        ? recordedDeliveries.has(vendorKey(item.vendor))
          ? "Additional ingredients are needed for this Thursday and next Thursday. The previously recorded supplier delivery does not include this quantity."
          : "Additional ingredients are needed for this Thursday and next Thursday. The supplier order already placed does not include this quantity."
        : "The saved manager adjustment leaves this Thursday and next Thursday's ingredients short. Review the adjustment before ordering.",
    });
  }
  const seenHolds = new Set();
  for (const item of managed) {
    const reason = clean(item.orderHoldReason);
    if (!reason || seenHolds.has(reason)) continue;
    seenHolds.add(reason);
    ingredientOrderReview.push({ id: clean(item.id), name: "Ingredient ordering needs review", vendor: "",
      quantity: 0, unit: "", requestedUnits: 0, kind: "ingredient-data", reason });
  }
  const refreshedCatalog = createWeeklyPlanSnapshot({ generatedAt: snapshot.generatedAt, inventoryItems: rolling })?.orderCatalog || [];
  const orderCatalog = [
    ...(snapshot.orderCatalog || []).filter(item => !managedIds.has(clean(item.id)) || placed.has(vendorKey(item.vendor))),
    ...refreshedCatalog.filter(item => managedIds.has(clean(item.id)) && !placed.has(vendorKey(item.vendor))),
  ];
  return { ...recommendations, weeklyPlanSnapshot: { ...snapshot, plan, orderPolicy: policy, orderCatalog,
    ingredientPlanningVersion: 2, ingredientOrderReview,
  } };
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeWeeklyPlanProductName(value) {
  return clean(value).replace(/\s+[123]\s*$/, "").trim();
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(number).filter((value) => value > 0))].sort((a, b) => a - b);
}

function uniqueStrings(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function aggregateTapActions(items, category, quantityField = "orderQty") {
  const grouped = new Map();

  items.forEach((item) => {
    const name = normalizeWeeklyPlanProductName(item.orderProductName || item.name);
    const quantity = number(item[quantityField]);
    if (!name || quantity <= 0) return;
    const key = name.toLowerCase();
    const existing = grouped.get(key) || {
      category,
      name,
      quantity: 0,
      tapNumbers: [],
      walls: [],
      currentStockKegs: 0,
      avgWeeklyKegs: 0,
      currentStockOunces: 0,
      avgWeeklyOunces: 0,
      priority: 0,
      vendors: [],
      estimatedCost: 0,
      hasKnownPrice: true,
      reasons: [],
    };
    existing.quantity += quantity;
    existing.tapNumbers.push(item.tapNumber);
    existing.walls.push(item.wall);
    existing.currentStockKegs += number(item.currentStockKegs);
    existing.avgWeeklyKegs += number(item.avgWeeklyKegs);
    existing.currentStockOunces += number(item.currentStockOunces);
    existing.avgWeeklyOunces += number(item.avgWeeklyOunces);
    existing.priority = Math.max(existing.priority, number(item.priority));
    existing.vendors.push(item.vendor);
    existing.estimatedCost += quantity * number(item.unitCost);
    if (item.isKegTap && item.actionType === "order" && number(item.unitCost) <= 0) {
      existing.hasKnownPrice = false;
    }
    existing.reasons.push(item.reason);
    grouped.set(key, existing);
  });

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      tapNumbers: uniqueSortedNumbers(item.tapNumbers),
      walls: uniqueStrings(item.walls),
      vendors: uniqueStrings(item.vendors),
      vendor: uniqueStrings(item.vendors).join(", "),
      reasons: uniqueStrings(item.reasons),
    }))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function normalizeInventoryOrders(items) {
  return items
    .filter((item) => number(item.orderUnits) > 0)
    .map((item) => ({
      category: item.group === "Liquor Cabinet"
        ? "liquor"
        : item.group === "Mixer Cabinet"
          ? "mixers"
          : "supplies",
      id: clean(item.id),
      name: clean(item.name),
      quantity: number(item.orderUnits),
      casePackaged: Boolean(item.casePackaged),
      packSize: Math.max(1, number(item.packSize) || 1),
      caseCount: item.casePackaged
        ? Math.ceil(number(item.orderUnits) / Math.max(1, number(item.packSize) || 1))
        : 0,
      vendor: clean(item.vendor),
      estimatedCost: number(item.estimatedCost),
      hasKnownPrice: item.hasKnownPrice === undefined
        ? number(item.unitCost) > 0 || number(item.estimatedCost) > 0
        : Boolean(item.hasKnownPrice),
      onHand: number(item.onHand),
      par: number(item.par),
      hasCurrentCount: item.hasCurrentCount !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeExcludedInventory(items) {
  return items
    .filter((item) => clean(item.orderHoldReason || item.exclusionReason))
    .map((item) => ({
      category: "inventory-hold",
      id: clean(item.id),
      name: clean(item.name),
      group: clean(item.group),
      vendor: clean(item.vendor),
      quantity: number(item.orderUnits),
      onHand: number(item.onHand),
      par: number(item.par),
      hasCurrentCount: item.hasCurrentCount !== false,
      reason: clean(item.orderHoldReason || item.exclusionReason),
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

function normalizeHeldRecommendations(recommendations) {
  const held = recommendations.map((item) => {
    const wanted = Math.max(
      number(item.calculatedOrderQty),
      number(item.rawOrderQty),
      number(item.orderQty),
    );
    const approved = Math.max(0, number(item.orderQty));
    return {
      ...item,
      heldQty: Math.max(0, wanted - approved),
    };
  }).filter((item) => item.heldQty > 0 && (
    item.capacityLimited
    || item.inventoryStateMissing
    || item.orderCapApplied
  ));

  return [
    ...aggregateTapActions(
      held.filter((item) => item.actionType === "order" && item.isKegTap),
      "held-beer-kegs",
      "heldQty",
    ),
    ...aggregateTapActions(
      held.filter((item) => item.actionType === "order" && item.isLiquorTap),
      "held-liquor-refills",
      "heldQty",
    ),
    ...aggregateTapActions(
      held.filter((item) => item.actionType === "make"),
      "held-cocktails",
      "heldQty",
    ),
  ].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function parseTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

export function findWeeklyUsageIdentityMatch(item, reportItems = [], isCandidate = () => true) {
  const eligible = reportItems.filter((reportItem) => isCandidate(reportItem));
  const tapNumber = number(item?.tapNumber);
  const plu = number(item?.plu);
  if (tapNumber) {
    const tapMatch = eligible.find((reportItem) => (
      number(reportItem?.tapNumber) === tapNumber
      && (!number(item?.plu) || !number(reportItem?.plu) || number(reportItem?.plu) === number(item?.plu))
    ));
    if (tapMatch) return tapMatch;
    if (eligible.some((reportItem) => (
      number(reportItem?.tapNumber) > 0
      && (!plu || number(reportItem?.plu) === plu)
    ))) return null;
  }

  if (!plu) return null;
  const pluMatches = eligible.filter((reportItem) => number(reportItem?.plu) === plu);
  return pluMatches.length === 1 ? pluMatches[0] : null;
}

export function hasWeeklyUsagePhysicalIdentityConflict(item, reportItems = [], isCandidate = () => true) {
  const tapNumber = number(item?.tapNumber);
  const plu = number(item?.plu);
  if (!tapNumber) return false;
  return reportItems.some((reportItem) => (
    isCandidate(reportItem)
    && number(reportItem?.tapNumber) > 0
    && number(reportItem?.tapNumber) !== tapNumber
    && (!plu || number(reportItem?.plu) === plu)
  ));
}

export function isWeeklyUsageNameFallbackEligible(reportItem) {
  return number(reportItem?.tapNumber) <= 0;
}

export function canReuseWeeklyUsageHistory(sourceItem, targetItem, matchingPluSourceCount = 0) {
  const sourceTapNumber = number(sourceItem?.tapNumber);
  const targetTapNumber = number(targetItem?.tapNumber);
  if (sourceTapNumber || targetTapNumber) {
    if (sourceTapNumber && targetTapNumber) return sourceTapNumber === targetTapNumber;
    const sourcePlu = number(sourceItem?.plu);
    const targetPlu = number(targetItem?.plu);
    return Boolean(sourcePlu && sourcePlu === targetPlu && number(matchingPluSourceCount) === 1);
  }

  const sourcePlu = number(sourceItem?.plu);
  const targetPlu = number(targetItem?.plu);
  return Boolean(sourcePlu && sourcePlu === targetPlu && number(matchingPluSourceCount) === 1);
}

export function hasCompleteWeeklyUsageRows(items = [], hasSavedRow = () => false) {
  return items.length > 0 && items.every((item) => hasSavedRow(item));
}

export function isRecommendationSourceRevisionCurrent(stateRevision, sourceStateRevision) {
  if (stateRevision === null || stateRevision === undefined || stateRevision === "") return false;
  if (sourceStateRevision === null || sourceStateRevision === undefined || sourceStateRevision === "") return false;
  const currentRevision = Number(stateRevision);
  const sourceRevision = Number(sourceStateRevision);
  return Number.isInteger(currentRevision)
    && Number.isInteger(sourceRevision)
    && currentRevision > 0
    && sourceRevision >= 0
    && currentRevision === sourceRevision + 1;
}

export function isWeeklyPlanHandoffAllowed(readinessStatus) {
  return readinessStatus === "ready" || readinessStatus === "review";
}

export function evaluateWeeklyPlanReadiness({
  parInitialized = false,
  recommendationGeneratedAt = "",
  recommendationError = "",
  recommendationInventoryMissing = false,
  recommendationSourceCurrent = true,
  parInputsChangedAt = "",
  weeklyUsageInitialized = false,
  weeklyUsageSavePending = false,
  weeklyUsageSaveError = "",
  latestCompletedUsageSaved = false,
  weeklyUsageLastSyncAt = "",
  inventoryInitialized = false,
  inventorySavePending = false,
  inventorySaveError = "",
  missingInventoryCount = 0,
  heldLineCount = 0,
  excludedLineCount = 0,
  missingPriceCount = 0,
  coolerCapacitySet = false,
  now = new Date(),
  staleAfterDays = 8,
} = {}) {
  const blockers = [];
  const staleReasons = [];
  const reviewReasons = [];
  const generatedTime = parseTime(recommendationGeneratedAt);
  const currentTime = parseTime(now) || Date.now();

  if (!parInitialized) blockers.push("Shared Keg Levels setup is incomplete.");
  if (!inventoryInitialized) blockers.push("Shared inventory setup is incomplete.");
  if (inventorySavePending) blockers.push("Inventory changes are still saving.");
  if (inventorySaveError) blockers.push(`The latest inventory save failed: ${clean(inventorySaveError)}`);
  if (!weeklyUsageInitialized) blockers.push("Shared Weekly Usage setup is incomplete.");
  if (weeklyUsageSavePending) blockers.push("Weekly Usage changes are still saving.");
  if (weeklyUsageSaveError) blockers.push(`The latest Weekly Usage save failed: ${clean(weeklyUsageSaveError)}`);
  if (!generatedTime) blockers.push("Keg and prep recommendations have not been generated.");
  if (recommendationInventoryMissing) blockers.push("Keg backup/on-hand counts are incomplete, so ordering is held.");
  if (missingInventoryCount > 0) {
    blockers.push(`${missingInventoryCount} inventory item${missingInventoryCount === 1 ? " is" : "s are"} using an old baseline instead of a current saved count.`);
  }
  if (recommendationError) blockers.push(`The latest update failed: ${clean(recommendationError)}`);

  if (weeklyUsageInitialized && !latestCompletedUsageSaved) {
    staleReasons.push("The latest completed Monday-Sunday usage report is not saved.");
  }
  if (generatedTime && !recommendationSourceCurrent) {
    staleReasons.push("Keg Levels inputs changed after these recommendations; the old order and prep quantities are hidden until refreshed.");
  }
  if (generatedTime && parseTime(weeklyUsageLastSyncAt) > generatedTime) {
    staleReasons.push("Weekly Usage changed after these keg and prep recommendations were generated.");
  }
  if (generatedTime && parseTime(parInputsChangedAt) > generatedTime) {
    staleReasons.push("Keg counts, pars, capacity, or On Deck choices changed after this run.");
  }
  if (generatedTime && currentTime - generatedTime > staleAfterDays * 24 * 60 * 60 * 1000) {
    staleReasons.push(`Recommendations are more than ${staleAfterDays} days old.`);
  }

  if (heldLineCount > 0) reviewReasons.push(`${heldLineCount} recommendation line${heldLineCount === 1 ? " is" : "s are"} held for review.`);
  if (excludedLineCount > 0) reviewReasons.push(`${excludedLineCount} inventory ordering rule${excludedLineCount === 1 ? " is" : "s are"} shown for review.`);
  if (missingPriceCount > 0) reviewReasons.push(`${missingPriceCount} active purchase line${missingPriceCount === 1 ? " is" : "s are"} missing a price.`);
  if (!coolerCapacitySet) reviewReasons.push("Beer cooler capacity is not set.");

  if (blockers.length) {
    return { status: "blocked", label: "Not ready to order", blockers, staleReasons, reviewReasons };
  }
  if (staleReasons.length) {
    return { status: "stale", label: "Refresh required", blockers, staleReasons, reviewReasons };
  }
  if (reviewReasons.length) {
    return { status: "review", label: "Ready with review", blockers, staleReasons, reviewReasons };
  }
  return { status: "ready", label: "Ready to order", blockers, staleReasons, reviewReasons };
}

export function buildWeeklyActionPlan({ inventoryItems = [], recommendations = [] } = {}) {
  const inventoryOrders = normalizeInventoryOrders(
    inventoryItems.filter((item) => !clean(item.orderHoldReason || item.exclusionReason)),
  );
  const excludedInventory = normalizeExcludedInventory(inventoryItems);
  const activeRecommendations = recommendations.filter((item) => number(item.orderQty) > 0);
  const beerKegs = aggregateTapActions(
    activeRecommendations.filter((item) => item.actionType === "order" && item.isKegTap),
    "beer-kegs",
  );
  const deferredLiquorRecommendations = recommendations
    .filter((item) => item.isLiquorTap)
    .map((item) => ({
      ...item,
      deferredQty: Math.max(
        number(item.deferredQty),
        number(item.suggestedRefillQty),
        item.actionType === "order" ? number(item.orderQty) : 0,
      ),
    }))
    .filter((item) => number(item.deferredQty) > 0);
  const deferredLiquorRefills = aggregateTapActions(
    deferredLiquorRecommendations,
    "deferred-liquor-refills",
    "deferredQty",
  );
  const cocktails = aggregateTapActions(
    activeRecommendations.filter((item) => item.actionType === "make"),
    "cocktails",
  );
  const liquor = inventoryOrders.filter((item) => item.category === "liquor");
  const mixers = inventoryOrders.filter((item) => item.category === "mixers");
  const supplies = inventoryOrders.filter((item) => item.category === "supplies");
  const heldRecommendations = normalizeHeldRecommendations(recommendations);
  const missingPriceCount = [
    ...beerKegs.filter((item) => !item.hasKnownPrice),
    ...inventoryOrders.filter((item) => !item.hasKnownPrice),
  ].length;
  const estimatedBeerCost = beerKegs.reduce((total, item) => total + item.estimatedCost, 0);
  const estimatedInventoryCost = inventoryOrders.reduce((total, item) => total + item.estimatedCost, 0);

  return {
    orders: {
      beerKegs,
      liquor,
      mixers,
      supplies,
    },
    prep: { cocktails },
    review: {
      heldRecommendations,
      deferredLiquorRefills,
      excludedInventory,
    },
    summary: {
      orderLineCount: beerKegs.length + inventoryOrders.length,
      inventoryLineCount: inventoryOrders.length,
      inventoryUnitTotal: inventoryOrders.reduce((total, item) => total + item.quantity, 0),
      estimatedInventoryCost,
      estimatedBeerCost,
      estimatedKnownPurchaseCost: estimatedInventoryCost + estimatedBeerCost,
      missingPriceCount,
      estimatedPurchaseCostComplete: missingPriceCount === 0,
      beerKegTotal: beerKegs.reduce((total, item) => total + item.quantity, 0),
      liquorRefillTotal: deferredLiquorRefills.reduce((total, item) => total + item.quantity, 0),
      deferredLiquorRefillLineCount: deferredLiquorRefills.length,
      cocktailBatchTotal: cocktails.reduce((total, item) => total + item.quantity, 0),
      cocktailLineCount: cocktails.length,
      heldLineCount: heldRecommendations.length + deferredLiquorRefills.length,
      heldUnitTotal: [...heldRecommendations, ...deferredLiquorRefills]
        .reduce((total, item) => total + item.quantity, 0),
      excludedLineCount: excludedInventory.length,
    },
  };
}

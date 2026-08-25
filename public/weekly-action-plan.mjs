import {
  getCocktailRecipeYieldOz,
  normalizeCocktailRecipeName,
} from "./cocktail-recipe-yields.mjs";

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

export function getCocktailPrepLabelName(value, wall = "") {
  const original = clean(value);
  const trailingNumberMatch = original.match(/([123])\s*$/);
  const numberPrefix = trailingNumberMatch ? original[trailingNumberMatch.index - 1] : "";
  const explicitNumber = trailingNumberMatch && /[\s)]/.test(numberPrefix)
    ? trailingNumberMatch[1]
    : "";
  const baseName = explicitNumber ? original.slice(0, trailingNumberMatch.index).trim() : original;
  const displayBase = normalizeCocktailRecipeName(baseName) === "blue dot"
    ? "Blue Dot"
    : baseName;
  const normalizedWall = clean(wall).toLowerCase();
  const wallNumber = normalizedWall === "main"
    ? "1"
    : normalizedWall === "karaoke"
      ? "2"
      : "";
  const labelNumber = explicitNumber || wallNumber;
  return [displayBase, labelNumber].filter(Boolean).join(" ");
}

export function getCocktailPrepDisplayName(value, wall = "") {
  return getCocktailPrepLabelName(value, wall)
    .replace(/\s*\([^)]*\)(?=\s*[123]\s*$|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLiquorTapProductName(value) {
  const normalized = normalizeWeeklyPlanProductName(value)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim();
  if (/^patron(?: silver)?$/i.test(normalized)) return "Patron Silver";
  if (/^hennessy(?: cognac)?$/i.test(normalized)) return "Hennessy";
  if (/^jameson(?: irish)?(?: whiskey)?$/i.test(normalized)) return "Jameson";
  if (/^grey goose(?: vodka)?$/i.test(normalized)) return "Grey Goose";
  if (/^pink whitney(?: vodka)?$/i.test(normalized)) return "Pink Whitney";
  if (/^skr?ewball(?: peanut butter)?(?: whiskey)?$/i.test(normalized)) return "Screwball";
  return normalized;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(number).filter((value) => value > 0))].sort((a, b) => a - b);
}

function uniqueStrings(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function aggregateTapActions(
  items,
  category,
  quantityField = "orderQty",
  normalizeName = normalizeWeeklyPlanProductName,
) {
  const grouped = new Map();

  items.forEach((item) => {
    const name = normalizeName(item.orderProductName || item.name, item);
    const quantity = number(item[quantityField]);
    if (!name || quantity <= 0) return;
    const key = name.toLowerCase();
    const existing = grouped.get(key) || {
      category,
      name,
      internalIds: [],
      vendorSkus: [],
      vendorProductNames: [],
      unitCosts: [],
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
    existing.internalIds.push(item.internalId || item.id || item.key);
    existing.vendorSkus.push(item.vendorSku || item.preferredSku);
    existing.vendorProductNames.push(item.vendorProductName || item.productName);
    existing.unitCosts.push(number(item.unitCost));
    existing.tapNumbers.push(item.tapNumber);
    existing.walls.push(item.wall);
    existing.currentStockKegs += number(item.currentStockKegs);
    existing.avgWeeklyKegs += number(item.avgWeeklyKegs);
    existing.currentStockOunces += number(item.currentStockOunces);
    existing.avgWeeklyOunces += number(item.avgWeeklyOunces);
    existing.priority = Math.max(existing.priority, number(item.priority));
    existing.vendors.push(item.vendor);
    existing.estimatedCost += quantity * number(item.unitCost);
    if ((item.isKegTap || item.isLiquorTap) && item.actionType === "order" && number(item.unitCost) <= 0) {
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
      id: uniqueStrings(item.internalIds).join(","),
      vendorSku: uniqueStrings(item.vendorSkus).length === 1 ? uniqueStrings(item.vendorSkus)[0] : "",
      vendorProductName: uniqueStrings(item.vendorProductNames).length === 1 ? uniqueStrings(item.vendorProductNames)[0] : item.name,
      unitCost: uniqueSortedNumbers(item.unitCosts).length === 1 ? uniqueSortedNumbers(item.unitCosts)[0] : 0,
      reasons: uniqueStrings(item.reasons),
    }))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

function normalizeInventoryOrders(items) {
  return items
    .filter((item) => number(item.orderUnits) > 0)
    .map((item) => {
      const cocktailPrepRequiredBottles = number(item.cocktailPrepRequiredBottles);
      const cocktailPrepShortageUnits = number(item.cocktailPrepShortageUnits);
      return {
        category: item.group === "Liquor Cabinet"
        ? "liquor"
        : item.group === "Mixer Cabinet"
          ? "mixers"
          : "supplies",
        id: clean(item.id),
        name: clean(item.name),
        vendorSku: clean(item.vendorSku || item.preferredSku),
        vendorProductName: clean(item.vendorProductName || item.productName || item.name),
        quantity: number(item.orderUnits),
        casePackaged: Boolean(item.casePackaged),
        packSize: Math.max(1, number(item.packSize) || 1),
        caseCount: item.casePackaged
          ? Math.ceil(number(item.orderUnits) / Math.max(1, number(item.packSize) || 1))
          : 0,
        vendor: clean(item.vendor),
        estimatedCost: number(item.estimatedCost),
        unitCost: number(item.unitCost),
        hasKnownPrice: item.hasKnownPrice === undefined
          ? number(item.unitCost) > 0 || number(item.estimatedCost) > 0
          : Boolean(item.hasKnownPrice),
        onHand: number(item.onHand),
        par: number(item.par),
        hasCurrentCount: item.hasCurrentCount !== false,
        cocktailPrepRequiredBottles,
        cocktailPrepShortageUnits,
        reasons: cocktailPrepShortageUnits > 0
          ? [`Cocktail prep needs ${cocktailPrepRequiredBottles} bottle${cocktailPrepRequiredBottles === 1 ? "" : "s"}; ${number(item.onHand)} counted on hand.`]
          : [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeInventoryOrderCatalog(items) {
  return items
    .map((item) => {
      const group = clean(item.group);
      const orderCategory = group === "Liquor Cabinet"
        ? "liquor"
        : group === "Mixer Cabinet"
          ? "mixers"
          : "supplies";
      return {
        id: clean(item.id),
        name: clean(item.name),
        vendor: clean(item.vendor),
        vendorSku: clean(item.vendorSku || item.preferredSku),
        vendorProductName: clean(item.vendorProductName || item.productName || item.name),
        lineType: orderCategory === "liquor" ? "Liquor bottle" : orderCategory === "mixers" ? "Mixer" : "Supply",
        orderCategory,
        casePackaged: Boolean(item.casePackaged),
        packSize: Math.max(1, number(item.packSize) || 1),
        unitCost: Math.max(0, number(item.unitCost)),
        hasKnownPrice: item.hasKnownPrice === true,
        excludeFromOrderCost: Boolean(item.excludeFromOrderCost),
      };
    })
    .filter((item) => item.id && item.name && item.vendor)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
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
    item.inventoryStateMissing
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
      "held-liquor-bottles",
      "heldQty",
      normalizeLiquorTapProductName,
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

export function isRecommendationSourceRevisionCurrent(
  stateRevision,
  sourceStateRevision,
  publishedStateRevision,
) {
  if (stateRevision === null || stateRevision === undefined || stateRevision === "") return false;
  const currentRevision = Number(stateRevision);
  const publishedRevision = Number(publishedStateRevision);
  if (
    publishedStateRevision !== null
    && publishedStateRevision !== undefined
    && publishedStateRevision !== ""
  ) {
    return Number.isInteger(currentRevision)
      && Number.isInteger(publishedRevision)
      && currentRevision > 0
      && publishedRevision > 0
      && currentRevision === publishedRevision;
  }
  if (sourceStateRevision === null || sourceStateRevision === undefined || sourceStateRevision === "") return false;
  const sourceRevision = Number(sourceStateRevision);
  return Number.isInteger(currentRevision)
    && Number.isInteger(sourceRevision)
    && currentRevision > 0
    && sourceRevision >= 0
    && currentRevision === sourceRevision + 1;
}

function getMondayWeekStartTime(value) {
  const time = parseTime(value);
  if (!time) return 0;
  const date = new Date(time);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function isRecommendationForOperatingWeek(generatedAt, now = new Date()) {
  const generatedWeek = getMondayWeekStartTime(generatedAt);
  const currentWeek = getMondayWeekStartTime(now);
  return generatedWeek > 0 && currentWeek > 0 && generatedWeek === currentWeek;
}

export function isWeeklyPlanLockedForOrderingWeek(generatedAt, now = new Date()) {
  return isRecommendationForOperatingWeek(generatedAt, now);
}

export function shouldRefreshMondayPlanForUsage(generatedAt, weeklyUsageLastSyncAt, now = new Date()) {
  if (!isRecommendationForOperatingWeek(generatedAt, now)) return true;
  const currentTime = parseTime(now);
  const generatedTime = parseTime(generatedAt);
  const usageTime = parseTime(weeklyUsageLastSyncAt);
  return new Date(currentTime).getDay() === 1 && usageTime > generatedTime;
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
  inventorySnapshotCurrent = true,
  inventorySavePending = false,
  inventorySaveError = "",
  missingInventoryCount = 0,
  heldLineCount = 0,
  excludedLineCount = 0,
  missingPriceCount = 0,
  lockedForWeek = false,
  now = new Date(),
  staleAfterDays = 8,
} = {}) {
  const blockers = [];
  const staleReasons = [];
  const reviewReasons = [];
  const generatedTime = parseTime(recommendationGeneratedAt);
  const currentTime = parseTime(now) || Date.now();
  const operatingWeekCurrent = isRecommendationForOperatingWeek(generatedTime, currentTime);
  const publishedPlanLocked = lockedForWeek && operatingWeekCurrent;

  if (!publishedPlanLocked && !parInitialized) blockers.push("Shared Keg Levels setup is incomplete.");
  if (!publishedPlanLocked && !inventoryInitialized) blockers.push("Shared inventory setup is incomplete.");
  // The combined Save & lock action captures the current Monday snapshot before
  // publishing, so a missing current snapshot is not a preflight blocker.
  if (!publishedPlanLocked && inventorySavePending) blockers.push("Inventory changes are still saving.");
  if (!publishedPlanLocked && inventorySaveError) blockers.push(`The latest inventory save failed: ${clean(inventorySaveError)}`);
  if (!publishedPlanLocked && !weeklyUsageInitialized) blockers.push("Shared Weekly Usage setup is incomplete.");
  if (!publishedPlanLocked && weeklyUsageSavePending) blockers.push("Weekly Usage changes are still saving.");
  if (!publishedPlanLocked && weeklyUsageSaveError) blockers.push(`The latest Weekly Usage save failed: ${clean(weeklyUsageSaveError)}`);
  if (!generatedTime) blockers.push("Keg and prep recommendations have not been generated.");
  if (!publishedPlanLocked && recommendationInventoryMissing) blockers.push("Keg backup/on-hand counts are incomplete, so ordering is held.");
  if (!publishedPlanLocked && missingInventoryCount > 0) {
    blockers.push(`${missingInventoryCount} inventory item${missingInventoryCount === 1 ? " is" : "s are"} using an old baseline instead of a current saved count.`);
  }
  if (!publishedPlanLocked && recommendationError) blockers.push(`The latest update failed: ${clean(recommendationError)}`);

  if (!publishedPlanLocked && weeklyUsageInitialized && !latestCompletedUsageSaved) {
    staleReasons.push("The latest completed Monday-Sunday usage report is not saved.");
  }
  if (generatedTime && !operatingWeekCurrent && !recommendationSourceCurrent) {
    staleReasons.push("Keg Levels inputs changed after these recommendations; the old order and prep quantities are hidden until refreshed.");
  }
  if (generatedTime && !operatingWeekCurrent) {
    staleReasons.push("A new Monday operating week has started. Calculate this week's plan from the new Monday inputs.");
  } else if (!publishedPlanLocked && generatedTime && shouldRefreshMondayPlanForUsage(generatedTime, weeklyUsageLastSyncAt, currentTime)) {
    staleReasons.push("Monday Weekly Usage changed after this week's plan was calculated.");
  }
  if (generatedTime && !operatingWeekCurrent && parseTime(parInputsChangedAt) > generatedTime) {
    staleReasons.push("Keg counts, pars, or On Deck choices changed after this run.");
  }
  if (generatedTime && !operatingWeekCurrent && currentTime - generatedTime > staleAfterDays * 24 * 60 * 60 * 1000) {
    staleReasons.push(`Recommendations are more than ${staleAfterDays} days old.`);
  }

  if (heldLineCount > 0) reviewReasons.push(`${heldLineCount} recommendation line${heldLineCount === 1 ? " is" : "s are"} held for review.`);
  if (excludedLineCount > 0) reviewReasons.push(`${excludedLineCount} inventory ordering rule${excludedLineCount === 1 ? " is" : "s are"} shown for review.`);
  if (missingPriceCount > 0) reviewReasons.push(`${missingPriceCount} active purchase line${missingPriceCount === 1 ? " is" : "s are"} missing a price.`);
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
  const orderingInventoryItems = inventoryItems.filter((item) => (
    !Object.hasOwn(item || {}, "par")
    || number(item.par) > 0
    || number(item.cocktailPrepShortageUnits) > 0
  ));
  const inventoryOrders = normalizeInventoryOrders(
    orderingInventoryItems.filter((item) => !clean(item.orderHoldReason || item.exclusionReason)),
  );
  const excludedInventory = normalizeExcludedInventory(orderingInventoryItems);
  const activeRecommendations = recommendations.filter((item) => number(item.orderQty) > 0);
  const beerKegs = aggregateTapActions(
    activeRecommendations.filter((item) => item.actionType === "order" && item.isKegTap),
    "beer-kegs",
  );
  const liquorTapBottles = aggregateTapActions(
    activeRecommendations.filter((item) => item.actionType === "order" && item.isLiquorTap),
    "liquor-tap-bottles",
    "orderQty",
    normalizeLiquorTapProductName,
  ).map((item) => ({ ...item, isLiquorTapOrder: true }));
  const cocktails = aggregateTapActions(
    activeRecommendations.filter((item) => item.actionType === "make"),
    "cocktails",
    "orderQty",
    (name, item) => getCocktailPrepLabelName(name, item.wall),
  ).map((item) => ({
    ...item,
    batchSizeOz: getCocktailRecipeYieldOz(item.name),
  })).sort((a, b) => (
    number(a.tapNumbers?.[0]) - number(b.tapNumbers?.[0])
    || a.name.localeCompare(b.name)
  ));
  const liquor = inventoryOrders.filter((item) => item.category === "liquor");
  const mixers = inventoryOrders.filter((item) => item.category === "mixers");
  const supplies = inventoryOrders.filter((item) => item.category === "supplies");
  const heldRecommendations = normalizeHeldRecommendations(recommendations);
  const missingPriceCount = [
    ...beerKegs.filter((item) => !item.hasKnownPrice),
    ...liquorTapBottles.filter((item) => !item.hasKnownPrice),
    ...inventoryOrders.filter((item) => !item.hasKnownPrice),
  ].length;
  const estimatedBeerCost = beerKegs.reduce((total, item) => total + item.estimatedCost, 0);
  const estimatedLiquorTapCost = liquorTapBottles.reduce((total, item) => total + item.estimatedCost, 0);
  const estimatedInventoryCost = inventoryOrders.reduce((total, item) => total + item.estimatedCost, 0);

  return {
    orders: {
      beerKegs,
      liquorTapBottles,
      liquor,
      mixers,
      supplies,
    },
    prep: { cocktails },
    review: {
      heldRecommendations,
      deferredLiquorRefills: [],
      excludedInventory,
    },
    summary: {
      orderLineCount: beerKegs.length + liquorTapBottles.length + inventoryOrders.length,
      inventoryLineCount: inventoryOrders.length,
      inventoryUnitTotal: inventoryOrders.reduce((total, item) => total + item.quantity, 0),
      estimatedInventoryCost,
      estimatedBeerCost,
      estimatedLiquorTapCost,
      estimatedKnownPurchaseCost: estimatedInventoryCost + estimatedBeerCost + estimatedLiquorTapCost,
      missingPriceCount,
      estimatedPurchaseCostComplete: missingPriceCount === 0,
      beerKegTotal: beerKegs.reduce((total, item) => total + item.quantity, 0),
      liquorTapBottleTotal: liquorTapBottles.reduce((total, item) => total + item.quantity, 0),
      liquorTapBottleLineCount: liquorTapBottles.length,
      liquorRefillTotal: 0,
      deferredLiquorRefillLineCount: 0,
      cocktailBatchTotal: cocktails.reduce((total, item) => total + item.quantity, 0),
      cocktailLineCount: cocktails.length,
      heldLineCount: heldRecommendations.length,
      heldUnitTotal: heldRecommendations.reduce((total, item) => total + item.quantity, 0),
      excludedLineCount: excludedInventory.length,
    },
  };
}

export function refreshWeeklyPlanMetadata(plan, {
  resolveBeerOrder = () => null,
  excludeInventoryReview = () => false,
} = {}) {
  if (!plan || typeof plan !== "object") return plan;

  const beerKegs = (plan?.orders?.beerKegs || []).map((item) => {
    const metadata = resolveBeerOrder(item);
    if (!metadata || typeof metadata !== "object") return item;

    const unitCost = number(metadata.unitCost) || number(item.unitCost);
    const vendor = clean(metadata.vendor) || clean(item.vendor);
    const hasKnownPrice = metadata.hasKnownPrice === undefined
      ? unitCost > 0 || item.hasKnownPrice === true
      : Boolean(metadata.hasKnownPrice);
    return {
      ...item,
      vendor,
      vendors: uniqueStrings([...(item.vendors || []), vendor]),
      vendorSku: clean(metadata.vendorSku || metadata.preferredSku || item.vendorSku),
      vendorProductName: clean(metadata.vendorProductName || metadata.productName || item.vendorProductName || item.name),
      unitCost,
      estimatedCost: unitCost > 0 ? number(item.quantity) * unitCost : number(item.estimatedCost),
      hasKnownPrice,
    };
  });
  const liquorTapBottles = plan?.orders?.liquorTapBottles || [];
  const inventoryOrders = [
    ...(plan?.orders?.liquor || []),
    ...(plan?.orders?.mixers || []),
    ...(plan?.orders?.supplies || []),
  ];
  const excludedInventory = (plan?.review?.excludedInventory || [])
    .filter((item) => !excludeInventoryReview(item));
  const purchaseLines = [...beerKegs, ...liquorTapBottles, ...inventoryOrders];
  const missingPriceCount = purchaseLines.filter((item) => (
    item.hasKnownPrice === false
    || (item.hasKnownPrice === undefined && number(item.estimatedCost) <= 0)
  )).length;
  const estimatedBeerCost = beerKegs.reduce((total, item) => total + number(item.estimatedCost), 0);
  const estimatedLiquorTapCost = liquorTapBottles.reduce((total, item) => total + number(item.estimatedCost), 0);
  const estimatedInventoryCost = inventoryOrders.reduce((total, item) => total + number(item.estimatedCost), 0);

  return {
    ...plan,
    orders: { ...plan.orders, beerKegs },
    review: { ...plan.review, excludedInventory },
    summary: {
      ...plan.summary,
      estimatedBeerCost,
      estimatedLiquorTapCost,
      estimatedInventoryCost,
      estimatedKnownPurchaseCost: estimatedBeerCost + estimatedLiquorTapCost + estimatedInventoryCost,
      missingPriceCount,
      estimatedPurchaseCostComplete: missingPriceCount === 0,
      excludedLineCount: excludedInventory.length,
    },
  };
}

function hasWeeklyPlanShape(plan) {
  return Boolean(plan)
    && typeof plan === "object"
    && Array.isArray(plan?.orders?.beerKegs)
    && Array.isArray(plan?.orders?.liquorTapBottles)
    && Array.isArray(plan?.orders?.liquor)
    && Array.isArray(plan?.orders?.mixers)
    && Array.isArray(plan?.orders?.supplies)
    && Array.isArray(plan?.prep?.cocktails)
    && Boolean(plan?.summary && typeof plan.summary === "object");
}

function upgradeLegacyWeeklyPlanSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.plan || typeof snapshot.plan !== "object") {
    return snapshot;
  }
  if (Array.isArray(snapshot?.plan?.orders?.liquorTapBottles)) return snapshot;
  const legacyDeferred = Array.isArray(snapshot?.plan?.review?.deferredLiquorRefills)
    ? snapshot.plan.review.deferredLiquorRefills
    : [];
  const liquorTapBottles = legacyDeferred.map((item) => ({
    ...item,
    category: "liquor-tap-bottles",
    name: normalizeLiquorTapProductName(item.name),
    quantity: number(item.quantity) * 2,
    vendor: clean(item.vendor) || "OHLQ",
    vendors: uniqueStrings([...(item.vendors || []), item.vendor, "OHLQ"]),
    estimatedCost: 0,
    hasKnownPrice: false,
    isLiquorTapOrder: true,
  }));
  const legacyDeferredUnits = legacyDeferred.reduce((total, item) => total + number(item.quantity), 0);
  const summary = snapshot?.plan?.summary || {};
  return {
    ...snapshot,
    version: 2,
    plan: {
      ...snapshot.plan,
      orders: {
        ...snapshot.plan.orders,
        liquorTapBottles,
      },
      review: {
        ...snapshot.plan.review,
        deferredLiquorRefills: [],
      },
      summary: {
        ...summary,
        orderLineCount: number(summary.orderLineCount) + liquorTapBottles.length,
        liquorTapBottleTotal: liquorTapBottles.reduce((total, item) => total + item.quantity, 0),
        liquorTapBottleLineCount: liquorTapBottles.length,
        liquorRefillTotal: 0,
        deferredLiquorRefillLineCount: 0,
        heldLineCount: Math.max(0, number(summary.heldLineCount) - legacyDeferred.length),
        heldUnitTotal: Math.max(0, number(summary.heldUnitTotal) - legacyDeferredUnits),
        missingPriceCount: number(summary.missingPriceCount) + liquorTapBottles.length,
        estimatedPurchaseCostComplete: liquorTapBottles.length === 0
          && summary.estimatedPurchaseCostComplete !== false,
      },
    },
  };
}

function upgradeWeeklyPlanPrepLabels(snapshot, recommendations) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.plan || typeof snapshot.plan !== "object") {
    return snapshot;
  }
  const existingCocktails = Array.isArray(snapshot?.plan?.prep?.cocktails)
    ? snapshot.plan.prep.cocktails
    : [];
  const sourceRecommendations = Array.isArray(recommendations?.items) ? recommendations.items : [];
  const rebuiltCocktails = buildWeeklyActionPlan({ recommendations: sourceRecommendations }).prep.cocktails;
  const existingTotal = existingCocktails.reduce((total, item) => total + number(item.quantity), 0);
  const rebuiltTotal = rebuiltCocktails.reduce((total, item) => total + number(item.quantity), 0);
  const canUseRebuiltLabels = rebuiltCocktails.length > 0 && rebuiltTotal === existingTotal;
  const cocktails = canUseRebuiltLabels
    ? rebuiltCocktails
    : existingCocktails.map((item) => ({
        ...item,
        batchSizeOz: number(item.batchSizeOz) || getCocktailRecipeYieldOz(item.name),
      }));

  return {
    ...snapshot,
    version: 3,
    plan: {
      ...snapshot.plan,
      prep: { ...snapshot.plan.prep, cocktails },
      summary: {
        ...snapshot.plan.summary,
        cocktailBatchTotal: cocktails.reduce((total, item) => total + number(item.quantity), 0),
        cocktailLineCount: cocktails.length,
      },
    },
  };
}

export function createWeeklyPlanSnapshot({
  generatedAt,
  inventoryItems = [],
  orderPolicy = null,
  recommendations = [],
  publishedAt = new Date().toISOString(),
} = {}) {
  const normalizedGeneratedAt = clean(generatedAt);
  if (!parseTime(normalizedGeneratedAt)) return null;
  return {
    version: 3,
    generatedAt: normalizedGeneratedAt,
    publishedAt: clean(publishedAt),
    orderCatalog: normalizeInventoryOrderCatalog(inventoryItems),
    ...(orderPolicy && typeof orderPolicy === "object" ? { orderPolicy } : {}),
    plan: buildWeeklyActionPlan({ inventoryItems, recommendations }),
  };
}

export function getCurrentWeeklyPlanSnapshot(recommendations, now = new Date()) {
  const legacyUpgraded = upgradeLegacyWeeklyPlanSnapshot(recommendations?.weeklyPlanSnapshot);
  const snapshot = upgradeWeeklyPlanPrepLabels(legacyUpgraded, recommendations);
  if (!snapshot || typeof snapshot !== "object") return null;
  if (clean(snapshot.generatedAt) !== clean(recommendations?.generatedAt)) return null;
  if (!isRecommendationForOperatingWeek(snapshot.generatedAt, now)) return null;
  if (!hasWeeklyPlanShape(snapshot.plan)) return null;
  return snapshot;
}

export function groupWeeklyPlanOrdersByVendor(plan = {}) {
  const lines = [
    ...(plan?.orders?.beerKegs || []).map((item) => ({ ...item, lineType: "Beer keg" })),
    ...(plan?.orders?.liquorTapBottles || []).map((item) => ({ ...item, lineType: "Liquor tap bottle" })),
    ...(plan?.orders?.liquor || []).map((item) => ({ ...item, lineType: "Liquor bottle" })),
    ...(plan?.orders?.mixers || []).map((item) => ({ ...item, lineType: "Mixer" })),
    ...(plan?.orders?.supplies || []).map((item) => ({ ...item, lineType: "Supply" })),
  ];
  const grouped = new Map();
  lines.forEach((item) => {
    const vendor = clean(item.vendor) || "Needs vendor";
    if (!grouped.has(vendor)) grouped.set(vendor, []);
    grouped.get(vendor).push(item);
  });
  const priority = new Map([["Bonbright", 0], ["Heidelberg", 1], ["Needs vendor", 99]]);
  return [...grouped.entries()]
    .sort(([left], [right]) => (
      (priority.get(left) ?? 50) - (priority.get(right) ?? 50)
      || left.localeCompare(right)
    ))
    .map(([vendor, items]) => ({
      vendor,
      items: items.slice().sort((left, right) => clean(left.name).localeCompare(clean(right.name))),
      estimatedCost: items.reduce((total, item) => total + number(item.estimatedCost), 0),
      hasCompletePricing: items.every((item) => item.hasKnownPrice !== false),
    }));
}

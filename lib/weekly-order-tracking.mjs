import {
  getCurrentWeeklyPlanSnapshot,
  groupWeeklyPlanOrdersByVendor,
} from "../public/weekly-action-plan.mjs";
import {
  buildUnifiedVendorOrderModel,
  normalizeVendorOrderPolicy,
  resolveVendorOrderIdentity,
} from "../public/vendor-order-drafts.mjs";
import {
  appendOperationalLearningEvents,
  buildOperationalLearningSuggestions,
  createOrderAdjustmentLearningEvent,
  createReceiptLearningEvent,
} from "../public/operations-learning.mjs";

const MAX_NAME_LENGTH = 80;
const MAX_ADJUSTMENT_REASON_LENGTH = 240;
const LEGACY_ORDER_CATALOG = Object.freeze([{
  id: "non-alcoholic-beer",
  name: "Non Alcoholic Beer",
  vendor: "Heidelberg",
  vendorSku: "013452-C",
  vendorProductName: "Athletic Brewing Upside Dawn Golden Ale Non-Alcoholic Beer 12oz 24pk",
  lineType: "Supply",
  orderCategory: "supplies",
  casePackaged: true,
  packSize: 24,
  unitCost: 0,
  hasKnownPrice: true,
  excludeFromOrderCost: true,
}]);
const RECEIPT_STATUSES = new Set(["received", "partial", "not-received", "rejected", "extra"]);
const SHORTAGE_REVIEW_DISPOSITIONS = new Set(["addressed", "wait"]);
const HANDOFF_STATUSES = new Set([
  "blocked",
  "ready_for_review",
  "reviewed",
  "opened_vendor",
  "manually_completed",
  "needs_attention",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableId(prefix, values) {
  return `${prefix}:${encodeURIComponent(values.map((value) => clean(value).toLowerCase()).join("|"))}`;
}

function vendorId(vendor) {
  return stableId("vendor", [vendor]);
}

function itemId(vendor, item) {
  const identity = clean(item.internalId || item.vendorSku || item.preferredSku);
  return stableId("order", [vendor, identity ? "product" : item.lineType, identity || item.name]);
}

function legacyItemId(vendor, item) {
  return stableId("order", [vendor, item.lineType, item.name]);
}

function quantityUnit(item) {
  if (item.lineType === "Beer keg") return item.quantity === 1 ? "keg" : "kegs";
  if (item.lineType === "Liquor tap bottle") return item.quantity === 1 ? "bottle" : "bottles";
  if (item.casePackaged) return item.caseCount === 1 ? "case" : "cases";
  return item.quantity === 1 ? "unit" : "units";
}

function classifyDeliveryShortage(item = {}) {
  const lineType = clean(item.lineType).toLowerCase();
  const reason = clean(item.reason).toLowerCase();
  const tapNumbers = Array.isArray(item.tapNumbers) ? item.tapNumbers.filter(Boolean) : [];
  const isVendorMinimumTopUp = /minimum top-up|meet the .* minimum|inventory covers this week/.test(reason);
  const isCurrentWeekPrep = /this week|weekly prep|cocktail prep|projected prep|prep usage/.test(reason);

  if (
    lineType === "beer keg"
    || lineType === "liquor tap bottle"
    || tapNumbers.length > 0
    || (isCurrentWeekPrep && !isVendorMinimumTopUp)
  ) {
    return {
      priority: "critical",
      reason: "Needed for this week's tap or prep plan.",
    };
  }

  return {
    priority: "wait",
    reason: "The current plan does not show a before-next-delivery need.",
  };
}

function catalogProductKey(item = {}) {
  const vendor = clean(item.vendor).toLowerCase();
  const sku = clean(item.vendorSku || item.preferredSku).toLowerCase();
  const name = clean(item.vendorProductName || item.productName || item.orderProductName || item.name).toLowerCase();
  return `${vendor}|${sku || `${clean(item.lineType).toLowerCase()}|${name}`}`;
}

function normalizeAdjustmentCatalogItem(item = {}, currentPlanQuantity = 0) {
  const vendor = clean(item.vendor);
  const resolvedIdentity = resolveVendorOrderIdentity(item, vendor);
  const lineType = clean(item.lineType || (item.isKegTap ? "Beer keg" : item.isLiquorTap ? "Liquor tap bottle" : ""));
  const name = clean(item.orderProductName || item.name || item.productName || item.vendorProductName);
  const vendorProductName = resolvedIdentity.productName;
  const vendorSku = resolvedIdentity.vendorSku;
  const internalId = clean(item.id || item.internalId || item.key || stableId("product", [vendor, lineType, name]));
  const casePackaged = Boolean(item.casePackaged);
  const packSize = Math.max(1, Number(item.packSize) || 1);
  const unitCost = Number(resolvedIdentity.unitCost);
  const excludeFromOrderCost = Boolean(item.excludeFromOrderCost);
  const hasUsableCost = Number.isFinite(unitCost) && (unitCost > 0 || excludeFromOrderCost);
  const orderCategory = clean(item.orderCategory)
    || (lineType === "Beer keg" ? "beerKegs" : lineType === "Liquor tap bottle" ? "liquorTapBottles" : casePackaged ? "mixers" : "supplies");
  const quantityUnitName = casePackaged ? "cases" : lineType === "Beer keg" ? "kegs" : lineType === "Liquor tap bottle" ? "bottles" : "units";
  const catalogId = stableId("catalog", [vendor, vendorSku || internalId, lineType, name]);
  return {
    catalogId,
    internalId,
    name,
    vendor,
    vendorSku,
    vendorProductName,
    lineType,
    orderCategory,
    casePackaged,
    packSize,
    unitCost: hasUsableCost ? Math.max(0, unitCost) : null,
    excludeFromOrderCost,
    currentPlanQuantity: Math.max(0, Number(currentPlanQuantity) || 0),
    quantityUnit: quantityUnitName,
    orderable: Boolean(vendor && (vendor === "Bonbright" || vendorSku) && name && hasUsableCost),
  };
}

export function buildOrderAdjustmentCatalog(recommendations = {}, snapshot = null) {
  const currentSnapshot = snapshot || getCurrentWeeklyPlanSnapshot(recommendations);
  if (!currentSnapshot) return [];
  const catalog = new Map();
  const add = (item, currentPlanQuantity = 0) => {
    const normalized = normalizeAdjustmentCatalogItem(item, currentPlanQuantity);
    if (!normalized.vendor || !normalized.name) return;
    const key = catalogProductKey(normalized);
    const existing = catalog.get(key);
    catalog.set(key, existing ? {
      ...normalized,
      ...existing,
      vendorSku: existing.vendorSku || normalized.vendorSku,
      unitCost: existing.unitCost || normalized.unitCost,
      excludeFromOrderCost: existing.excludeFromOrderCost || normalized.excludeFromOrderCost,
      orderable: existing.orderable || normalized.orderable,
      currentPlanQuantity: Math.max(existing.currentPlanQuantity, normalized.currentPlanQuantity),
    } : normalized);
  };
  groupWeeklyPlanOrdersByVendor(currentSnapshot.plan).forEach((group) => {
    group.items.forEach((item) => add(item, item.casePackaged ? Number(item.caseCount) || 0 : Number(item.quantity) || 0));
  });
  LEGACY_ORDER_CATALOG.forEach((item) => add(item, 0));
  (Array.isArray(currentSnapshot.orderCatalog) ? currentSnapshot.orderCatalog : []).forEach((item) => add(item, 0));
  (Array.isArray(recommendations.items) ? recommendations.items : []).forEach((item) => add(item, 0));
  return [...catalog.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
}

export class WeeklyOrderTrackingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WeeklyOrderTrackingError";
    this.code = code;
    this.status = status;
  }
}

export function buildWeeklyOrderTracking(recommendations = {}, now = new Date()) {
  const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, now);
  if (!snapshot) return null;
  const savedTracking = isPlainRecord(recommendations.weeklyOrderTracking)
    ? recommendations.weeklyOrderTracking
    : {};
  const savedVendors = isPlainRecord(savedTracking.vendors) ? savedTracking.vendors : {};
    const savedReceipts = isPlainRecord(savedTracking.receipts) ? savedTracking.receipts : {};
    const savedShortageReviews = isPlainRecord(savedTracking.shortageReviews)
      ? savedTracking.shortageReviews
      : {};
  const savedDeliveryNotes = isPlainRecord(savedTracking.deliveryNotes) ? savedTracking.deliveryNotes : {};
  const savedDrafts = isPlainRecord(savedTracking.orderDrafts) ? savedTracking.orderDrafts : {};
  const savedAdjustments = isPlainRecord(savedTracking.orderAdjustments) ? savedTracking.orderAdjustments : {};
  const learningSuggestions = buildOperationalLearningSuggestions(recommendations.operationalLearningHistory);
  const orderPolicy = normalizeVendorOrderPolicy(snapshot.orderPolicy || savedTracking.orderPolicy);
  const adjustmentCatalog = buildOrderAdjustmentCatalog(recommendations, snapshot);
  const currentCatalogIds = new Set(adjustmentCatalog.map((item) => item.catalogId));
  const adjustments = Object.values(savedAdjustments).filter((adjustment) => (
    clean(adjustment.generatedAt) === clean(recommendations.generatedAt)
    && currentCatalogIds.has(clean(adjustment.catalogId))
  ));
  const orderModel = buildUnifiedVendorOrderModel(snapshot.plan, {
    snapshot,
    orderPolicy,
    manualAdjustments: adjustments,
    manualCatalog: adjustmentCatalog,
    now,
  });
  const vendors = orderModel.drafts.map((group) => {
    const id = vendorId(group.vendor);
    const orderRecord = isPlainRecord(savedVendors[id]) ? savedVendors[id] : {};
    const orderedBy = clean(orderRecord.orderedBy).slice(0, MAX_NAME_LENGTH);
    const items = group.lines.map((item) => {
      const idValue = itemId(group.vendor, item);
      const legacyIdValue = legacyItemId(group.vendor, item);
      const receipt = isPlainRecord(savedReceipts[idValue])
        ? savedReceipts[idValue]
        : isPlainRecord(savedReceipts[legacyIdValue]) ? savedReceipts[legacyIdValue] : {};
      const savedStatus = RECEIPT_STATUSES.has(receipt.status) ? receipt.status : "pending";
      const orderedQuantity = Number(item.requestedCases) || Number(item.requestedUnits) || 0;
      const hasSavedReceivedQuantity = receipt.receivedQuantity != null && receipt.receivedQuantity !== "";
      const savedReceivedQuantity = Number(receipt.receivedQuantity);
      const receivedQuantity = savedStatus === "pending"
        ? 0
        : hasSavedReceivedQuantity && Number.isFinite(savedReceivedQuantity)
          ? Math.max(0, savedReceivedQuantity)
          : savedStatus === "received" ? orderedQuantity : 0;
      const status = savedStatus === "pending"
        ? "pending"
        : receivedQuantity > orderedQuantity
          ? "extra"
          : savedStatus === "rejected" && receivedQuantity === 0
            ? "rejected"
        : receivedQuantity >= orderedQuantity
          ? "received"
          : receivedQuantity > 0 ? "partial" : "not-received";
        const handledBy = status === "pending"
          ? ""
          : clean(receipt.handledBy).slice(0, MAX_NAME_LENGTH);
        const shortage = classifyDeliveryShortage(item);
        const savedShortageReview = isPlainRecord(savedShortageReviews[idValue])
          ? savedShortageReviews[idValue]
          : {};
        const reviewDisposition = clean(savedShortageReview.disposition).toLowerCase();
        const reviewMatchesPriority = (
          (shortage.priority === "critical" && reviewDisposition === "addressed")
          || (shortage.priority === "wait" && reviewDisposition === "wait")
        );
        const shortageReview = (
          handledBy
          && SHORTAGE_REVIEW_DISPOSITIONS.has(reviewDisposition)
          && clean(savedShortageReview.generatedAt) === clean(recommendations.generatedAt)
          && clean(savedShortageReview.receiptUpdatedAt) === clean(receipt.updatedAt)
          && reviewMatchesPriority
        ) ? {
          disposition: reviewDisposition,
          reviewedAt: clean(savedShortageReview.reviewedAt),
        } : null;
        return {
        id: idValue,
        vendor: group.vendor,
        name: clean(item.name || item.productName),
        lineType: clean(item.lineType),
        quantity: orderedQuantity,
        receivedQuantity: handledBy ? receivedQuantity : 0,
        missingQuantity: handledBy ? Math.max(0, orderedQuantity - receivedQuantity) : 0,
        extraQuantity: handledBy ? Math.max(0, receivedQuantity - orderedQuantity) : 0,
        unit: quantityUnit({ ...item, quantity: orderedQuantity, casePackaged: Number(item.requestedCases) > 0 }),
        inventoryItemId: clean(item.internalId || item.id),
        inventoryUnitsPerReceiptUnit: Number(item.requestedCases) > 0 ? Math.max(1, Number(item.packSize) || 1) : 1,
        lineType: clean(item.lineType),
        tapNumbers: Array.isArray(item.tapNumbers) ? item.tapNumbers : [],
        status: handledBy ? status : "pending",
        handledBy,
          updatedAt: handledBy ? clean(receipt.updatedAt) : "",
          reason: handledBy ? clean(receipt.reason) : "",
          orderReason: clean(item.reason),
          shortagePriority: shortage.priority,
          shortageReason: shortage.reason,
          shortageReview,
        };
    });
    return {
      id,
      vendor: group.vendor,
      estimatedTotal: Number(group.estimatedTotal) || 0,
      ordered: Boolean(orderedBy),
      orderedBy,
      orderedAt: orderedBy ? clean(orderRecord.orderedAt) : "",
      updatedAt: orderedBy ? clean(orderRecord.updatedAt || orderRecord.orderedAt) : "",
      deliveryNote: clean(savedDeliveryNotes[id]?.note),
      deliveryNoteBy: clean(savedDeliveryNotes[id]?.handledBy),
      deliveryNoteAt: clean(savedDeliveryNotes[id]?.updatedAt),
      items,
    };
    });
    const items = vendors.flatMap((vendor) => vendor.items);
    const notReceivedItems = items.filter((item) => ["partial", "not-received", "rejected"].includes(item.status));
    const activeNotReceivedItems = notReceivedItems.filter((item) => !item.shortageReview);
    const criticalNotReceivedItems = activeNotReceivedItems.filter((item) => item.shortagePriority === "critical");
    const waitNotReceivedItems = activeNotReceivedItems.filter((item) => item.shortagePriority === "wait");
    return {
    generatedAt: clean(recommendations.generatedAt),
    orderPolicy,
    adjustments,
    learningSuggestions,
    adjustmentCatalog,
    drafts: Object.values(savedDrafts)
      .filter((draft) => clean(draft.generatedAt) === clean(recommendations.generatedAt))
      .map((draft) => ({
        ...draft,
        status: HANDOFF_STATUSES.has(draft.status)
          ? draft.status
          : draft.approvedAt ? "reviewed" : draft.createdAt ? "ready_for_review" : "blocked",
      })),
    vendors,
      itemCount: items.length,
      receivedCount: items.filter((item) => item.status === "received").length,
      notReceivedCount: notReceivedItems.length,
      notReceivedItems,
      activeNotReceivedCount: activeNotReceivedItems.length,
      activeNotReceivedItems,
      criticalNotReceivedItems,
      waitNotReceivedItems,
    };
}

export function applyWeeklyOrderTrackingUpdate(
  recommendations,
  payload = {},
  { role = "employee", now = () => new Date() } = {},
) {
  const current = buildWeeklyOrderTracking(recommendations, now());
  if (!current) {
    throw new WeeklyOrderTrackingError(
      "WEEKLY_ORDER_PLAN_MISSING",
      "The current weekly order plan is not available.",
      409,
    );
  }
  if (clean(payload.generatedAt) !== current.generatedAt) {
    throw new WeeklyOrderTrackingError(
      "WEEKLY_ORDER_PLAN_CHANGED",
      "The weekly order changed. Reload before saving.",
      409,
    );
  }

  const timestamp = now().toISOString();
  const tracking = isPlainRecord(recommendations.weeklyOrderTracking)
    ? { ...recommendations.weeklyOrderTracking }
    : {};
  const vendors = isPlainRecord(tracking.vendors) ? { ...tracking.vendors } : {};
  const receipts = isPlainRecord(tracking.receipts) ? { ...tracking.receipts } : {};
  const deliveryNotes = isPlainRecord(tracking.deliveryNotes) ? { ...tracking.deliveryNotes } : {};
    const orderDrafts = isPlainRecord(tracking.orderDrafts) ? { ...tracking.orderDrafts } : {};
    const orderAdjustments = isPlainRecord(tracking.orderAdjustments) ? { ...tracking.orderAdjustments } : {};
    const shortageReviews = isPlainRecord(tracking.shortageReviews) ? { ...tracking.shortageReviews } : {};
  let orderPolicy = normalizeVendorOrderPolicy(tracking.orderPolicy || current.orderPolicy);
  const learningEvents = [];

  if (["set-order-adjustment", "set-order-adjustments", "remove-order-adjustment"].includes(payload.action)) {
    if (role !== "owner") throw new WeeklyOrderTrackingError("OWNER_ORDER_ADJUSTMENT_REQUIRED", "Only an owner can adjust an order.", 403);
    const actor = clean(payload.adjustedBy).slice(0, MAX_NAME_LENGTH);
    if (!actor) throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_ACTOR_REQUIRED", "Enter the manager adjusting this order.");
    const updates = payload.action === "set-order-adjustments"
      ? Array.isArray(payload.adjustments) ? payload.adjustments : []
      : [payload];
    if (!updates.length || updates.length > 100) {
      throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENTS_REQUIRED", "Choose between 1 and 100 order lines to update.");
    }
    const affectedVendors = new Set();
    updates.forEach((update) => {
      const catalogItem = current.adjustmentCatalog.find((item) => item.catalogId === clean(update.catalogId));
      if (!catalogItem || clean(update.vendor) !== catalogItem.vendor) {
        throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_PRODUCT_REQUIRED", "Choose a current mapped product.", 409);
      }
      const adjustmentId = stableId("adjustment", [current.generatedAt, catalogItem.catalogId]);
      const placedVendor = current.vendors.find((vendor) => vendor.vendor === catalogItem.vendor && vendor.ordered);
      if (placedVendor) throw new WeeklyOrderTrackingError("ORDER_ALREADY_PLACED", "This vendor order is already marked as placed.", 409);
      if (payload.action === "remove-order-adjustment") {
        if (!isPlainRecord(orderAdjustments[adjustmentId])) {
          throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_NOT_FOUND", "That order adjustment is no longer active.", 409);
        }
        delete orderAdjustments[adjustmentId];
      } else {
        const quantity = Number(update.quantity);
        const reason = clean(update.reason).slice(0, MAX_ADJUSTMENT_REASON_LENGTH);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
          throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_QUANTITY_INVALID", "Enter a whole order quantity from 0 to 999.");
        }
        if (quantity > 0 && !catalogItem.orderable) throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_PRODUCT_BLOCKED", "This product needs a current SKU and price before it can be added.", 409);
        if (quantity === 0 && Number(catalogItem.currentPlanQuantity) <= 0) {
          throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_REMOVAL_NOT_APPLICABLE", "That product is not on this week's order.", 409);
        }
        if (!reason) throw new WeeklyOrderTrackingError("ORDER_ADJUSTMENT_REASON_REQUIRED", "Enter why this order differs from the Weekly Plan.");
        orderAdjustments[adjustmentId] = {
          id: adjustmentId,
          generatedAt: current.generatedAt,
          catalogId: catalogItem.catalogId,
          internalId: catalogItem.internalId,
          vendor: catalogItem.vendor,
          name: catalogItem.name,
          quantity,
          quantityUnit: catalogItem.quantityUnit,
          reason,
          adjustedBy: actor,
          adjustedAt: timestamp,
        };
        const learningEvent = createOrderAdjustmentLearningEvent({
          generatedAt: current.generatedAt,
          occurredAt: timestamp,
          catalogItem,
          quantity,
          reason,
        });
        if (learningEvent) learningEvents.push(learningEvent);
      }
      affectedVendors.add(catalogItem.vendor);
    });
    Object.entries(orderDrafts).forEach(([id, draft]) => {
      if (clean(draft.generatedAt) === current.generatedAt && affectedVendors.has(clean(draft.vendor))) delete orderDrafts[id];
    });
  } else if (["create-draft", "approve-draft", "review-and-approve"].includes(payload.action)) {
    if (role !== "owner") throw new WeeklyOrderTrackingError("OWNER_ORDER_DRAFT_REQUIRED", "Only an owner can create or approve order drafts.", 403);
    const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, now());
    if (payload.orderPolicy && typeof payload.orderPolicy === "object") {
      orderPolicy = normalizeVendorOrderPolicy(payload.orderPolicy);
    }
    const model = buildUnifiedVendorOrderModel(snapshot?.plan, {
      snapshot,
      orderPolicy,
      deliveryLocations: { [clean(payload.vendor)]: clean(payload.deliveryLocation) },
      manualAdjustments: current.adjustments,
      manualCatalog: current.adjustmentCatalog,
      now: now(),
    });
    const draft = model.drafts.find((entry) => entry.vendor === clean(payload.vendor));
    if (!draft) throw new WeeklyOrderTrackingError("ORDER_DRAFT_NOT_FOUND", "That vendor draft is not on the current weekly plan.", 409);
    const existing = isPlainRecord(orderDrafts[draft.id]) ? orderDrafts[draft.id] : {};
    const createdBy = clean(payload.createdBy || payload.approvedBy).slice(0, MAX_NAME_LENGTH);
    if (!createdBy) throw new WeeklyOrderTrackingError("ORDER_DRAFT_ACTOR_REQUIRED", "Enter the manager creating this draft.");
    const record = {
      ...existing,
      id: draft.id,
      generatedAt: current.generatedAt,
      vendor: draft.vendor,
      lineCount: draft.lineCount,
      estimatedTotal: draft.estimatedTotal,
      deliveryLocation: draft.deliveryLocation,
      blockerCodes: draft.blockers.map((entry) => entry.code),
      createdBy: clean(existing.createdBy) || createdBy,
      createdAt: clean(existing.createdAt) || timestamp,
      updatedAt: timestamp,
      status: draft.blockers.length
        ? "blocked"
        : draft.warnings.length ? "needs_attention" : "ready_for_review",
    };
    if (["approve-draft", "review-and-approve"].includes(payload.action)) {
      const approvedBy = clean(payload.approvedBy).slice(0, MAX_NAME_LENGTH);
      if (!approvedBy) throw new WeeklyOrderTrackingError("ORDER_DRAFT_APPROVER_REQUIRED", "Enter the manager approving this draft.");
      if (payload.confirmed !== true) throw new WeeklyOrderTrackingError("ORDER_DRAFT_CONFIRMATION_REQUIRED", "Confirm the vendor, total, and line count.");
      if (!draft.canApprove) throw new WeeklyOrderTrackingError("ORDER_DRAFT_BLOCKED", draft.blockers[0]?.message || "This draft is blocked.", 409);
      record.approvedBy = approvedBy;
      record.approvedAt = clean(existing.approvedAt) || timestamp;
      record.blockerCodes = [];
      record.status = "reviewed";
    }
    orderDrafts[draft.id] = record;
  } else if (payload.action === "record-handoff") {
    if (role !== "owner") throw new WeeklyOrderTrackingError("OWNER_ORDER_DRAFT_REQUIRED", "Only an owner can record an order handoff.", 403);
    const target = Object.values(orderDrafts).find((draft) => (
      clean(draft.id) === clean(payload.draftId)
      && clean(draft.generatedAt) === current.generatedAt
      && clean(draft.vendor) === clean(payload.vendor)
    ));
    if (!target) throw new WeeklyOrderTrackingError("ORDER_DRAFT_NOT_FOUND", "Create and approve this vendor draft first.", 409);
    if (!target.approvedAt) throw new WeeklyOrderTrackingError("ORDER_DRAFT_NOT_APPROVED", "Approve this vendor draft first.", 409);
    const event = clean(payload.event);
    if (!new Set(["copied", "opened_vendor"]).has(event)) {
      throw new WeeklyOrderTrackingError("ORDER_HANDOFF_EVENT_REQUIRED", "Choose a supported handoff action.");
    }
    const actor = clean(target.approvedBy || target.createdBy || role).slice(0, MAX_NAME_LENGTH);
    const next = { ...target, statusActor: actor, updatedAt: timestamp };
    if (event === "copied") next.copiedAt = clean(target.copiedAt) || timestamp;
    if (event === "opened_vendor") {
      next.openedAt = clean(target.openedAt) || timestamp;
      if (target.status !== "manually_completed") next.status = "opened_vendor";
    }
    orderDrafts[target.id] = next;
  } else if (payload.action === "set-ordered") {
    if (role !== "owner") {
      throw new WeeklyOrderTrackingError(
        "OWNER_ORDER_TRACKING_REQUIRED",
        "Only an owner can record who placed an order.",
        403,
      );
    }
    const target = current.vendors.find((vendor) => vendor.id === clean(payload.vendorId));
    if (!target) {
      throw new WeeklyOrderTrackingError(
        "WEEKLY_ORDER_VENDOR_NOT_FOUND",
        "That vendor is not on the current weekly order.",
        409,
      );
    }
    if (payload.ordered !== true) {
      delete vendors[target.id];
    } else {
      const orderedBy = clean(payload.orderedBy).slice(0, MAX_NAME_LENGTH);
      if (!orderedBy) {
        throw new WeeklyOrderTrackingError(
          "ORDERED_BY_REQUIRED",
          "Enter who placed the order before checking it off.",
        );
      }
      const existing = isPlainRecord(vendors[target.id]) ? vendors[target.id] : {};
      vendors[target.id] = {
        vendor: target.vendor,
        orderedBy,
        orderedAt: clean(existing.orderedAt) || timestamp,
        updatedAt: timestamp,
      };
      Object.values(orderDrafts).forEach((draft) => {
        if (clean(draft.generatedAt) !== current.generatedAt || clean(draft.vendor) !== target.vendor) return;
        orderDrafts[draft.id] = {
          ...draft,
          status: "manually_completed",
          completedBy: orderedBy,
          completedAt: clean(draft.completedAt) || timestamp,
          statusActor: orderedBy,
          updatedAt: timestamp,
        };
      });
    }
    } else if (payload.action === "review-shortages") {
      if (role !== "owner") {
        throw new WeeklyOrderTrackingError(
          "OWNER_SHORTAGE_REVIEW_REQUIRED",
          "Only a manager can clear delivery shortages from the briefing.",
          403,
        );
      }
      const disposition = clean(payload.disposition).toLowerCase();
      if (!SHORTAGE_REVIEW_DISPOSITIONS.has(disposition)) {
        throw new WeeklyOrderTrackingError(
          "SHORTAGE_REVIEW_DISPOSITION_REQUIRED",
          "Choose addressed or wait until next week.",
        );
      }
      const itemIds = [...new Set((Array.isArray(payload.itemIds) ? payload.itemIds : [])
        .map(clean)
        .filter(Boolean))];
      if (!itemIds.length || itemIds.length > 100) {
        throw new WeeklyOrderTrackingError(
          "SHORTAGE_REVIEW_ITEMS_REQUIRED",
          "Choose between 1 and 100 current delivery shortages.",
        );
      }
      const expectedPriority = disposition === "addressed" ? "critical" : "wait";
      const targets = itemIds.map((id) => current.notReceivedItems.find((item) => item.id === id));
      if (targets.some((item) => !item)) {
        throw new WeeklyOrderTrackingError(
          "WEEKLY_ORDER_SHORTAGE_NOT_FOUND",
          "A delivery shortage changed. Reload before reviewing it.",
          409,
        );
      }
      if (targets.some((item) => item.shortagePriority !== expectedPriority)) {
        throw new WeeklyOrderTrackingError(
          "WEEKLY_ORDER_SHORTAGE_PRIORITY_CHANGED",
          "A delivery shortage priority changed. Reload before reviewing it.",
          409,
        );
      }
      targets.forEach((target) => {
        shortageReviews[target.id] = {
          generatedAt: current.generatedAt,
          receiptUpdatedAt: target.updatedAt,
          disposition,
          reviewedAt: timestamp,
        };
      });
    } else if (payload.action === "set-receipts") {
    const targetVendor = current.vendors.find((vendor) => vendor.id === clean(payload.vendorId));
    if (!targetVendor) {
      throw new WeeklyOrderTrackingError(
        "WEEKLY_ORDER_VENDOR_NOT_FOUND",
        "That vendor is not on the current weekly order.",
        409,
      );
    }
    if (!targetVendor.ordered) {
      throw new WeeklyOrderTrackingError(
        "WEEKLY_ORDER_VENDOR_NOT_ORDERED",
        "A manager must mark this vendor order as placed before it can be received.",
        409,
      );
    }
    if (payload.confirmed !== true) {
      throw new WeeklyOrderTrackingError(
        "RECEIPT_BATCH_CONFIRMATION_REQUIRED",
        "Review and confirm the complete vendor delivery before saving.",
      );
    }
    const handledBy = clean(payload.handledBy).slice(0, MAX_NAME_LENGTH);
    if (!handledBy) {
      throw new WeeklyOrderTrackingError(
        "RECEIVED_BY_REQUIRED",
        "Enter who checked the delivery before saving.",
      );
    }
    const entries = Array.isArray(payload.receipts) ? payload.receipts : [];
    if (!entries.length || entries.length !== targetVendor.items.length || entries.length > 100) {
      throw new WeeklyOrderTrackingError(
        "RECEIPT_BATCH_INCOMPLETE",
        "The reviewed delivery must include every item for this vendor.",
      );
    }
    const seenItemIds = new Set();
    const updates = entries.map((entry) => {
      const target = targetVendor.items.find((item) => item.id === clean(entry?.itemId));
      if (!target || seenItemIds.has(target.id)) {
        throw new WeeklyOrderTrackingError(
          "WEEKLY_ORDER_ITEM_NOT_FOUND",
          "The reviewed delivery contains an unknown or duplicate order item.",
          409,
        );
      }
      seenItemIds.add(target.id);
      const requestedQuantity = Number(entry?.receivedQuantity);
      if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0 || requestedQuantity > 9999) {
        throw new WeeklyOrderTrackingError(
          "RECEIVED_QUANTITY_INVALID",
          "Enter a whole received quantity from 0 to 9,999.",
        );
      }
      const reason = clean(entry?.reason).slice(0, 120);
      const status = requestedQuantity > target.quantity
        ? "extra"
        : reason === "rejected" && requestedQuantity === 0
          ? "rejected"
        : requestedQuantity >= target.quantity
        ? "received"
        : requestedQuantity > 0 ? "partial" : "not-received";
      if (clean(entry?.status) !== status) {
        throw new WeeklyOrderTrackingError(
          "RECEIPT_STATUS_CONFLICT",
          "A reviewed delivery status does not match its received quantity.",
        );
      }
      return { target, requestedQuantity, status, reason };
    });
    if (seenItemIds.size !== targetVendor.items.length) {
      throw new WeeklyOrderTrackingError(
        "RECEIPT_BATCH_INCOMPLETE",
        "The reviewed delivery must include every item for this vendor.",
      );
    }
    updates.forEach(({ target, requestedQuantity, status, reason }) => {
        receipts[target.id] = {
        status,
        receivedQuantity: requestedQuantity,
        handledBy,
        reason,
          updatedAt: timestamp,
        };
        delete shortageReviews[target.id];
      const learningEvent = createReceiptLearningEvent({
        generatedAt: current.generatedAt,
        occurredAt: timestamp,
        item: target,
        status,
        receivedQuantity: requestedQuantity,
        reason,
      });
      if (learningEvent) learningEvents.push(learningEvent);
    });
    const note = clean(payload.note).slice(0, 1200);
    if (note) deliveryNotes[targetVendor.id] = { note, handledBy, updatedAt: timestamp };
    else delete deliveryNotes[targetVendor.id];
  } else if (payload.action === "set-receipt") {
    const target = current.vendors
      .flatMap((vendor) => vendor.items)
      .find((item) => item.id === clean(payload.itemId));
    if (!target) {
      throw new WeeklyOrderTrackingError(
        "WEEKLY_ORDER_ITEM_NOT_FOUND",
        "That item is not on the current weekly order.",
        409,
      );
    }
      const status = clean(payload.status).toLowerCase();
      if (status === "pending") {
        delete receipts[target.id];
        delete shortageReviews[target.id];
      } else {
      if (!RECEIPT_STATUSES.has(status)) {
        throw new WeeklyOrderTrackingError(
          "RECEIPT_STATUS_REQUIRED",
          "Choose received or not received.",
        );
      }
      const handledBy = clean(payload.handledBy).slice(0, MAX_NAME_LENGTH);
      if (!handledBy) {
        throw new WeeklyOrderTrackingError(
          "RECEIVED_BY_REQUIRED",
          "Enter who checked the delivery before saving.",
        );
      }
      const requestedQuantity = status === "received"
        ? target.quantity
        : payload.receivedQuantity == null || payload.receivedQuantity === ""
          ? 0
          : Number(payload.receivedQuantity);
      if (
        !Number.isInteger(requestedQuantity)
        || requestedQuantity < 0
        || requestedQuantity > 9999
      ) {
        throw new WeeklyOrderTrackingError(
          "RECEIVED_QUANTITY_INVALID",
          "Enter a whole received quantity from 0 to 9,999.",
        );
      }
      const normalizedStatus = requestedQuantity > target.quantity
        ? "extra"
        : clean(payload.reason) === "rejected" && requestedQuantity === 0
          ? "rejected"
        : requestedQuantity >= target.quantity
        ? "received"
        : requestedQuantity > 0 ? "partial" : "not-received";
        receipts[target.id] = {
        status: normalizedStatus,
        receivedQuantity: requestedQuantity,
        handledBy,
        reason: clean(payload.reason).slice(0, 120),
          updatedAt: timestamp,
        };
        delete shortageReviews[target.id];
      const learningEvent = createReceiptLearningEvent({
        generatedAt: current.generatedAt,
        occurredAt: timestamp,
        item: target,
        status: normalizedStatus,
        receivedQuantity: requestedQuantity,
        reason: clean(payload.reason),
      });
      if (learningEvent) learningEvents.push(learningEvent);
    }
  } else {
    throw new WeeklyOrderTrackingError(
      "WEEKLY_ORDER_ACTION_REQUIRED",
      "Choose an order-tracking action.",
    );
  }

  return {
    ...recommendations,
    operationalLearningHistory: appendOperationalLearningEvents(
      recommendations.operationalLearningHistory,
      learningEvents,
    ),
      weeklyOrderTracking: {
        vendors,
        receipts,
        deliveryNotes,
        orderDrafts,
        orderAdjustments,
        orderPolicy,
        shortageReviews,
      },
    };
}

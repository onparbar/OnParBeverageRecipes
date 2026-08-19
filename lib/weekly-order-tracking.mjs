import {
  getCurrentWeeklyPlanSnapshot,
  groupWeeklyPlanOrdersByVendor,
} from "../public/weekly-action-plan.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";

const MAX_NAME_LENGTH = 80;
const RECEIPT_STATUSES = new Set(["received", "partial", "not-received"]);
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
  return stableId("order", [vendor, item.lineType, item.name]);
}

function quantityUnit(item) {
  if (item.lineType === "Beer keg") return item.quantity === 1 ? "keg" : "kegs";
  if (item.lineType === "Liquor tap bottle") return item.quantity === 1 ? "bottle" : "bottles";
  if (item.casePackaged) return item.caseCount === 1 ? "case" : "cases";
  return item.quantity === 1 ? "unit" : "units";
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
  const savedDrafts = isPlainRecord(savedTracking.orderDrafts) ? savedTracking.orderDrafts : {};
  const vendors = groupWeeklyPlanOrdersByVendor(snapshot.plan).map((group) => {
    const id = vendorId(group.vendor);
    const orderRecord = isPlainRecord(savedVendors[id]) ? savedVendors[id] : {};
    const orderedBy = clean(orderRecord.orderedBy).slice(0, MAX_NAME_LENGTH);
    const items = group.items.map((item) => {
      const idValue = itemId(group.vendor, item);
      const receipt = isPlainRecord(savedReceipts[idValue]) ? savedReceipts[idValue] : {};
      const savedStatus = RECEIPT_STATUSES.has(receipt.status) ? receipt.status : "pending";
      const orderedQuantity = item.casePackaged
        ? Number(item.caseCount) || 0
        : Number(item.quantity) || 0;
      const hasSavedReceivedQuantity = receipt.receivedQuantity != null && receipt.receivedQuantity !== "";
      const savedReceivedQuantity = Number(receipt.receivedQuantity);
      const receivedQuantity = savedStatus === "pending"
        ? 0
        : hasSavedReceivedQuantity && Number.isFinite(savedReceivedQuantity)
          ? Math.max(0, Math.min(orderedQuantity, savedReceivedQuantity))
          : savedStatus === "received" ? orderedQuantity : 0;
      const status = savedStatus === "pending"
        ? "pending"
        : receivedQuantity >= orderedQuantity
          ? "received"
          : receivedQuantity > 0 ? "partial" : "not-received";
      const handledBy = status === "pending"
        ? ""
        : clean(receipt.handledBy).slice(0, MAX_NAME_LENGTH);
      return {
        id: idValue,
        vendor: group.vendor,
        name: clean(item.name),
        lineType: clean(item.lineType),
        quantity: orderedQuantity,
        receivedQuantity: handledBy ? receivedQuantity : 0,
        missingQuantity: handledBy ? Math.max(0, orderedQuantity - receivedQuantity) : 0,
        unit: quantityUnit(item),
        tapNumbers: Array.isArray(item.tapNumbers) ? item.tapNumbers : [],
        status: handledBy ? status : "pending",
        handledBy,
        updatedAt: handledBy ? clean(receipt.updatedAt) : "",
      };
    });
    return {
      id,
      vendor: group.vendor,
      ordered: Boolean(orderedBy),
      orderedBy,
      orderedAt: orderedBy ? clean(orderRecord.orderedAt) : "",
      updatedAt: orderedBy ? clean(orderRecord.updatedAt || orderRecord.orderedAt) : "",
      items,
    };
  });
  const items = vendors.flatMap((vendor) => vendor.items);
  return {
    generatedAt: clean(recommendations.generatedAt),
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
    notReceivedCount: items.filter((item) => ["partial", "not-received"].includes(item.status)).length,
    notReceivedItems: items.filter((item) => ["partial", "not-received"].includes(item.status)),
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
  const orderDrafts = isPlainRecord(tracking.orderDrafts) ? { ...tracking.orderDrafts } : {};

  if (["create-draft", "approve-draft"].includes(payload.action)) {
    if (role !== "owner") throw new WeeklyOrderTrackingError("OWNER_ORDER_DRAFT_REQUIRED", "Only an owner can create or approve order drafts.", 403);
    const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, now());
    const model = buildVendorOrderDrafts(snapshot?.plan, {
      generatedAt: current.generatedAt,
      sourceDate: snapshot?.publishedAt,
      deliveryLocations: { [clean(payload.vendor)]: clean(payload.deliveryLocation) },
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
    if (payload.action === "approve-draft") {
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
      if (!Number.isInteger(requestedQuantity) || requestedQuantity < 0 || requestedQuantity > target.quantity) {
        throw new WeeklyOrderTrackingError(
          "RECEIVED_QUANTITY_INVALID",
          `Enter a whole received quantity from 0 to ${target.quantity}.`,
        );
      }
      const status = requestedQuantity >= target.quantity
        ? "received"
        : requestedQuantity > 0 ? "partial" : "not-received";
      if (clean(entry?.status) !== status) {
        throw new WeeklyOrderTrackingError(
          "RECEIPT_STATUS_CONFLICT",
          "A reviewed delivery status does not match its received quantity.",
        );
      }
      return { target, requestedQuantity, status };
    });
    if (seenItemIds.size !== targetVendor.items.length) {
      throw new WeeklyOrderTrackingError(
        "RECEIPT_BATCH_INCOMPLETE",
        "The reviewed delivery must include every item for this vendor.",
      );
    }
    updates.forEach(({ target, requestedQuantity, status }) => {
      receipts[target.id] = {
        status,
        receivedQuantity: requestedQuantity,
        handledBy,
        updatedAt: timestamp,
      };
    });
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
        || requestedQuantity > target.quantity
      ) {
        throw new WeeklyOrderTrackingError(
          "RECEIVED_QUANTITY_INVALID",
          `Enter a whole received quantity from 0 to ${target.quantity}.`,
        );
      }
      const normalizedStatus = requestedQuantity >= target.quantity
        ? "received"
        : requestedQuantity > 0 ? "partial" : "not-received";
      receipts[target.id] = {
        status: normalizedStatus,
        receivedQuantity: requestedQuantity,
        handledBy,
        updatedAt: timestamp,
      };
    }
  } else {
    throw new WeeklyOrderTrackingError(
      "WEEKLY_ORDER_ACTION_REQUIRED",
      "Choose an order-tracking action.",
    );
  }

  return {
    ...recommendations,
    weeklyOrderTracking: { vendors, receipts, orderDrafts },
  };
}

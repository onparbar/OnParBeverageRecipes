import {
  buildVerifiedKegSlotMap,
  verifyExactKegTarget,
} from "./pmb-keg-safety.mjs";

const MAX_PORTION_PRICE_CENTS = 100_000;
const MAX_PORTION_QUANTITY_OZ = 128;
const MAX_SCALE_DP = 6;

export class PmbPortionPriceUpdateError extends Error {
  constructor(message, { code = "PMB_PORTION_PRICE_INVALID", status = 400, details = {} } = {}) {
    super(message);
    this.name = "PmbPortionPriceUpdateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function exactNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function invalid(message, code = "PMB_PORTION_PRICE_INVALID", details = {}) {
  throw new PmbPortionPriceUpdateError(message, { code, status: 400, details });
}

function conflict(message, code, details = {}) {
  throw new PmbPortionPriceUpdateError(message, { code, status: 409, details });
}

function unavailable(message, code = "PMB_PORTION_WRITE_UNVERIFIED", details = {}) {
  throw new PmbPortionPriceUpdateError(message, { code, status: 503, details });
}

function getAssignmentKey(assignment) {
  return `${positiveInteger(assignment?.tapNumber)}:${positiveInteger(assignment?.deviceId)}:${positiveInteger(assignment?.lineNum)}`;
}

function stableItemId(value) {
  const id = clean(value);
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return "";
  return id;
}

function requireSchemaField(schema, key) {
  const field = clean(schema?.[key]);
  if (!field) {
    unavailable(
      `PMB portion writes are disabled until the live ${key} is verified on the on-site controller.`,
      "PMB_PORTION_SCHEMA_UNVERIFIED",
      { missingSchemaField: key },
    );
  }
  return field;
}

function scaledIntegerToNumber(rawValue, rawDp, label) {
  const value = exactNonNegativeInteger(rawValue);
  const dp = exactNonNegativeInteger(rawDp);
  if (value == null || dp == null || dp > MAX_SCALE_DP) {
    unavailable(
      `PMB returned an invalid ${label} value. No shot price was changed.`,
      "PMB_PORTION_ITEM_INVALID",
      { rawValue, rawDp, field: label },
    );
  }
  return value / (10 ** dp);
}

export function portionDollarsToCents(value, label = "Shot price") {
  const text = clean(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    invalid(`${label} must be a dollar amount with no more than two decimal places.`);
  }
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_PORTION_PRICE_CENTS) {
    invalid(`${label} must be greater than $0 and no more than $1,000.`);
  }
  return cents;
}

export function pmbScaledPriceToCents(rawPrice, rawDp) {
  const price = exactNonNegativeInteger(rawPrice);
  const dp = exactNonNegativeInteger(rawDp);
  if (price == null || price <= 0 || dp == null || dp > MAX_SCALE_DP) {
    unavailable(
      "PMB returned an invalid portion price. No shot price was changed.",
      "PMB_PORTION_ITEM_INVALID",
      { rawPrice, rawDp },
    );
  }
  const scaledCents = (price * 100) / (10 ** dp);
  if (!Number.isSafeInteger(scaledCents) || scaledCents <= 0 || scaledCents > MAX_PORTION_PRICE_CENTS) {
    unavailable(
      "PMB returned a portion price that cannot be represented exactly in cents. No shot price was changed.",
      "PMB_PORTION_PRICE_PRECISION_UNSUPPORTED",
      { rawPrice: price, rawDp: dp },
    );
  }
  return scaledCents;
}

export function portionCentsToPmbScaledPrice(cents, priceDp) {
  const normalizedCents = exactNonNegativeInteger(cents);
  const dp = exactNonNegativeInteger(priceDp);
  if (normalizedCents == null || normalizedCents <= 0 || dp == null || dp > MAX_SCALE_DP) {
    invalid("The requested shot price or PMB decimal precision is invalid.");
  }
  const rawPrice = (normalizedCents * (10 ** dp)) / 100;
  if (!Number.isSafeInteger(rawPrice)) {
    invalid(
      "That shot price cannot be represented exactly with PMB's current decimal precision.",
      "PMB_PORTION_PRICE_PRECISION_UNSUPPORTED",
      { cents: normalizedCents, priceDp: dp },
    );
  }
  return rawPrice;
}

export function isLiquorPortionTapNumber(value) {
  const tapNumber = positiveInteger(value);
  return (tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92);
}

/**
 * Converts a raw `/api/itemlist` row into a write-safe identity. PMB builds can
 * expose different ID/quantity field names, so callers must supply field names
 * confirmed from this venue's live controller. Missing configuration blocks a
 * write instead of falling back to array order or the words Single/Double.
 */
export function normalizePmbPortionItem(row, schema = {}) {
  const itemIdField = requireSchemaField(schema, "itemIdField");
  const quantityField = requireSchemaField(schema, "quantityField");
  const quantityDpField = clean(schema.quantityDpField);
  const itemId = stableItemId(row?.[itemIdField]);
  const productPlu = positiveInteger(row?.product_plu);
  const portionName = clean(row?.portion_name);
  if (!itemId || !productPlu || !portionName) {
    unavailable(
      "PMB returned a portion without an exact item ID, product PLU, or portion name. No shot price was changed.",
      "PMB_PORTION_ITEM_INVALID",
      { itemIdField, itemId: itemId || null, productPlu: productPlu || null, portionName },
    );
  }

  const quantityOz = quantityDpField
    ? scaledIntegerToNumber(row?.[quantityField], row?.[quantityDpField], "portion quantity")
    : Number(row?.[quantityField]);
  if (!Number.isFinite(quantityOz) || quantityOz <= 0 || quantityOz > MAX_PORTION_QUANTITY_OZ) {
    unavailable(
      "PMB returned an invalid portion quantity. No shot price was changed.",
      "PMB_PORTION_ITEM_INVALID",
      { itemId, quantityField, quantityDpField: quantityDpField || null },
    );
  }

  const priceRaw = exactNonNegativeInteger(row?.price);
  const priceDp = exactNonNegativeInteger(row?.price_dp);
  const priceCents = pmbScaledPriceToCents(priceRaw, priceDp);
  return {
    itemId,
    productPlu,
    portionName,
    quantityOz,
    priceRaw,
    priceDp,
    priceCents,
  };
}

export function validatePmbPortionPriceUpdateInput(input = {}) {
  const exactIdentity = input?.exactIdentity && typeof input.exactIdentity === "object"
    ? input.exactIdentity
    : {};
  const kind = clean(input.kind).toLowerCase();
  if (kind !== "liquor") {
    invalid(
      "Only verified liquor taps in Portion Mode can use shot pricing.",
      "PMB_PORTION_KIND_NOT_ELIGIBLE",
    );
  }

  const identity = {
    plu: positiveInteger(input.plu || exactIdentity.plu),
    deviceId: positiveInteger(exactIdentity.deviceId || input.deviceId),
    lineNum: positiveInteger(exactIdentity.lineNum || input.lineNum),
    tapNumber: positiveInteger(exactIdentity.tapNumber || input.tapNumber),
    name: clean(exactIdentity.name || input.name),
  };
  if (!identity.plu || !identity.deviceId || !identity.lineNum || !identity.tapNumber || !identity.name) {
    invalid(
      "PMB PLU, device ID, line number, tap number, and product name are required.",
      "PMB_PORTION_TARGET_REQUIRED",
    );
  }
  if (!isLiquorPortionTapNumber(identity.tapNumber)) {
    invalid(
      `Tap ${identity.tapNumber} is not a verified liquor tap.`,
      "PMB_PORTION_NON_LIQUOR_TAP",
    );
  }

  if (!Array.isArray(input.expectedAssignments) || !input.expectedAssignments.length) {
    invalid(
      "Every displayed PMB tap sharing this liquor product must be confirmed before its shot prices can change.",
      "PMB_PORTION_ASSIGNMENTS_REQUIRED",
    );
  }
  const expectedAssignments = input.expectedAssignments.map((assignment) => ({
    tapNumber: positiveInteger(assignment?.tapNumber),
    deviceId: positiveInteger(assignment?.deviceId),
    lineNum: positiveInteger(assignment?.lineNum),
  }));
  if (expectedAssignments.some((assignment) => !assignment.tapNumber || !assignment.deviceId || !assignment.lineNum)) {
    invalid(
      "Each confirmed PMB assignment needs a tap number, device ID, and line number.",
      "PMB_PORTION_ASSIGNMENTS_REQUIRED",
    );
  }
  const assignmentKeys = expectedAssignments.map(getAssignmentKey);
  if (new Set(assignmentKeys).size !== assignmentKeys.length) {
    invalid("The confirmed PMB assignment list contains duplicates.", "PMB_PORTION_ASSIGNMENTS_INVALID");
  }

  if (!Array.isArray(input.portions) || input.portions.length !== 2) {
    invalid(
      "Shot pricing requires exactly two verified PMB portions.",
      "PMB_PORTION_PAIR_REQUIRED",
    );
  }
  const portions = input.portions.map((portion, index) => {
    const itemId = stableItemId(portion?.itemId);
    const name = clean(portion?.name);
    const quantityOz = Number(portion?.quantityOz);
    const expectedPriceRaw = exactNonNegativeInteger(portion?.expectedPriceRaw);
    const priceDp = exactNonNegativeInteger(portion?.priceDp);
    if (
      !itemId
      || !name
      || !Number.isFinite(quantityOz)
      || quantityOz <= 0
      || quantityOz > MAX_PORTION_QUANTITY_OZ
      || expectedPriceRaw == null
      || expectedPriceRaw <= 0
      || priceDp == null
      || priceDp > MAX_SCALE_DP
    ) {
      invalid(
        `Portion ${index + 1} is missing its exact PMB item identity, quantity, or raw price.`,
        "PMB_PORTION_IDENTITY_REQUIRED",
      );
    }
    const expectedCurrentPriceCents = pmbScaledPriceToCents(expectedPriceRaw, priceDp);
    const submittedExpectedCents = portionDollarsToCents(
      portion.expectedCurrentPrice,
      `${name} expected current price`,
    );
    if (submittedExpectedCents !== expectedCurrentPriceCents) {
      invalid(
        `${name}'s displayed price does not match its exact PMB raw price. Refresh shot pricing before trying again.`,
        "PMB_PORTION_DISPLAY_PRICE_MISMATCH",
      );
    }
    const newPriceCents = portionDollarsToCents(portion.newPrice, `${name} new price`);
    const newPriceRaw = portionCentsToPmbScaledPrice(newPriceCents, priceDp);
    return {
      itemId,
      name,
      quantityOz,
      expectedPriceRaw,
      priceDp,
      expectedCurrentPriceCents,
      newPriceCents,
      newPriceRaw,
    };
  });

  if (new Set(portions.map((portion) => portion.itemId)).size !== portions.length) {
    invalid("The two PMB portions must have different stable item IDs.", "PMB_PORTION_IDENTITY_DUPLICATE");
  }
  if (new Set(portions.map((portion) => normalizeName(portion.name))).size !== portions.length) {
    invalid("The two PMB portions must have different names.", "PMB_PORTION_IDENTITY_DUPLICATE");
  }
  if (new Set(portions.map((portion) => portion.quantityOz)).size !== portions.length) {
    invalid("The two PMB portions must have different quantities.", "PMB_PORTION_IDENTITY_DUPLICATE");
  }
  if (portions.every((portion) => portion.newPriceRaw === portion.expectedPriceRaw)) {
    invalid("At least one shot price must change.", "PMB_PORTION_PRICE_NO_CHANGE");
  }

  return { kind, identity, expectedAssignments, portions };
}

export function verifyPmbPortionTarget(rows, request) {
  const exact = verifyExactKegTarget(rows, request.identity);
  if (exact.tapNumber !== request.identity.tapNumber) {
    conflict(
      "That PMB tap number changed. Refresh shot pricing before trying again.",
      "PMB_PORTION_TAP_NUMBER_MISMATCH",
      { requestedTapNumber: request.identity.tapNumber, currentTapNumber: exact.tapNumber },
    );
  }
  if (normalizeName(exact.product) !== normalizeName(request.identity.name)) {
    conflict(
      "That PMB liquor assignment changed. Refresh shot pricing before trying again.",
      "PMB_PORTION_PRODUCT_NAME_MISMATCH",
      { requestedName: request.identity.name, currentName: exact.product },
    );
  }

  const affectedAssignments = [...buildVerifiedKegSlotMap(rows).values()]
    .filter((row) => row.plu === request.identity.plu)
    .map((row) => ({
      plu: row.plu,
      deviceId: row.deviceId,
      lineNum: row.lineNum,
      tapNumber: row.tapNumber,
      name: row.product,
    }));
  if (affectedAssignments.some((assignment) => !assignment.tapNumber)) {
    conflict(
      `PMB PLU ${request.identity.plu} has a live assignment without a verified tap number. No shot price was changed.`,
      "PMB_PORTION_ASSIGNMENT_INCOMPLETE",
      { affectedAssignments },
    );
  }
  const expectedKeys = request.expectedAssignments.map(getAssignmentKey).sort();
  const currentKeys = affectedAssignments.map(getAssignmentKey).sort();
  if (
    expectedKeys.length !== currentKeys.length
    || expectedKeys.some((key, index) => key !== currentKeys[index])
  ) {
    conflict(
      "The live taps sharing this PMB liquor product changed after confirmation. Refresh shot pricing before trying again.",
      "PMB_PORTION_ASSIGNMENTS_CHANGED",
      { expectedAssignments: request.expectedAssignments, affectedAssignments },
    );
  }
  const nonLiquorAssignment = affectedAssignments.find((row) => !isLiquorPortionTapNumber(row.tapNumber));
  if (nonLiquorAssignment) {
    conflict(
      `PMB PLU ${request.identity.plu} is also assigned to non-liquor tap ${nonLiquorAssignment.tapNumber}. No shot price was changed.`,
      "PMB_PORTION_SHARED_WITH_NON_LIQUOR_TAP",
      { affectedAssignments },
    );
  }
  return { exact, affectedAssignments };
}

function verifyPortionSnapshot(itemRows, request, schema, priceKey, failureCode) {
  if (!Array.isArray(itemRows)) {
    unavailable("PMB portion pricing is unavailable. No shot price was changed.", "PMB_PORTION_ITEMS_UNAVAILABLE");
  }
  const matchingRows = itemRows.filter((row) => positiveInteger(row?.product_plu) === request.identity.plu);
  if (matchingRows.length !== request.portions.length) {
    conflict(
      `PMB returned ${matchingRows.length} portion records for PLU ${request.identity.plu}; exactly two were expected. No shot price was changed.`,
      "PMB_PORTION_SET_CHANGED",
      { plu: request.identity.plu, expectedCount: request.portions.length, currentCount: matchingRows.length },
    );
  }
  const currentItems = matchingRows.map((row) => normalizePmbPortionItem(row, schema));
  if (new Set(currentItems.map((item) => item.itemId)).size !== currentItems.length) {
    unavailable(
      "PMB returned duplicate portion item IDs. No shot price was changed.",
      "PMB_PORTION_ITEM_AMBIGUOUS",
      { plu: request.identity.plu },
    );
  }

  request.portions.forEach((expected) => {
    const current = currentItems.find((item) => item.itemId === expected.itemId);
    if (!current) {
      conflict(
        "A PMB portion item changed after this pricing screen was loaded. Refresh shot pricing before trying again.",
        "PMB_PORTION_IDENTITY_CHANGED",
        { itemId: expected.itemId },
      );
    }
    if (
      normalizeName(current.portionName) !== normalizeName(expected.name)
      || Math.abs(current.quantityOz - expected.quantityOz) > 0.000001
      || current.priceDp !== expected.priceDp
    ) {
      conflict(
        "A PMB portion name, quantity, or decimal precision changed after this pricing screen was loaded. Refresh shot pricing before trying again.",
        "PMB_PORTION_IDENTITY_CHANGED",
        { expected, current },
      );
    }
    if (current.priceRaw !== expected[priceKey]) {
      const readback = failureCode === "PMB_PORTION_READBACK_FAILED";
      throw new PmbPortionPriceUpdateError(
        readback
          ? "PMB did not confirm both requested shot prices after saving."
          : "A live PMB shot price changed after this pricing screen was loaded. Refresh shot pricing before trying again.",
        {
          code: failureCode,
          status: readback ? 502 : 409,
          details: {
            itemId: expected.itemId,
            expectedPriceRaw: expected[priceKey],
            currentPriceRaw: current.priceRaw,
            priceDp: current.priceDp,
          },
        },
      );
    }
  });
  return currentItems;
}

export function verifyPmbPortionItems(itemRows, request, schema = {}) {
  return verifyPortionSnapshot(
    itemRows,
    request,
    schema,
    "expectedPriceRaw",
    "PMB_PORTION_PRICE_STALE",
  );
}

export function verifyPmbPortionReadback(itemRows, request, schema = {}) {
  return verifyPortionSnapshot(
    itemRows,
    request,
    schema,
    "newPriceRaw",
    "PMB_PORTION_READBACK_FAILED",
  );
}

/**
 * Verifies an adapter's parsed management-form controls before it mutates the
 * copied form. HTML parsing stays adapter-specific because the on-site TTG form
 * shape must be captured and tested rather than guessed here.
 */
export function verifyPmbPortionFormTargets(formTargets, request) {
  if (!Array.isArray(formTargets) || formTargets.length !== request.portions.length) {
    unavailable(
      "PMB did not expose one unambiguous price control for each verified portion. No shot price was changed.",
      "PMB_PORTION_FORM_UNVERIFIED",
      { expectedCount: request.portions.length, formTargetCount: Array.isArray(formTargets) ? formTargets.length : 0 },
    );
  }
  const controlKeys = formTargets.map((target) => stableItemId(target?.controlKey));
  if (controlKeys.some((key) => !key) || new Set(controlKeys).size !== controlKeys.length) {
    unavailable(
      "PMB portion price controls could not be identified uniquely. No shot price was changed.",
      "PMB_PORTION_FORM_UNVERIFIED",
    );
  }

  const edits = request.portions.map((expected) => {
    const matches = formTargets.filter((target) => stableItemId(target?.itemId) === expected.itemId);
    if (matches.length !== 1) {
      unavailable(
        "PMB did not expose one unambiguous price control for a verified portion. No shot price was changed.",
        "PMB_PORTION_FORM_UNVERIFIED",
        { itemId: expected.itemId, matchCount: matches.length },
      );
    }
    const target = matches[0];
    const targetQuantityOz = Number(target.quantityOz);
    if (
      positiveInteger(target.productPlu) !== request.identity.plu
      || normalizeName(target.portionName) !== normalizeName(expected.name)
      || !Number.isFinite(targetQuantityOz)
      || Math.abs(targetQuantityOz - expected.quantityOz) > 0.000001
      || exactNonNegativeInteger(target.priceDp) !== expected.priceDp
      || exactNonNegativeInteger(target.currentPriceRaw) !== expected.expectedPriceRaw
    ) {
      conflict(
        "The PMB management form no longer matches the verified portion item. Refresh shot pricing before trying again.",
        "PMB_PORTION_FORM_TARGET_MISMATCH",
        { expected, target },
      );
    }
    return {
      controlKey: stableItemId(target.controlKey),
      itemId: expected.itemId,
      previousPriceRaw: expected.expectedPriceRaw,
      newPriceRaw: expected.newPriceRaw,
      priceDp: expected.priceDp,
    };
  });
  return edits;
}

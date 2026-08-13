import {
  buildVerifiedKegSlotMap,
  verifyExactKegTarget,
} from "./pmb-keg-safety.mjs";

const MAX_PRICE_CENTS = 10_000;

export class PmbPriceUpdateError extends Error {
  constructor(message, { code = "PMB_PRICE_UPDATE_INVALID", status = 400, details = {} } = {}) {
    super(message);
    this.name = "PmbPriceUpdateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function invalid(message, code = "PMB_PRICE_UPDATE_INVALID", details = {}) {
  throw new PmbPriceUpdateError(message, { code, status: 400, details });
}

function conflict(message, code, details = {}) {
  throw new PmbPriceUpdateError(message, { code, status: 409, details });
}

export function pricePerOzToCents(value, label = "Price") {
  const text = clean(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    invalid(`${label} must be a dollar amount with no more than two decimal places.`);
  }
  const cents = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_PRICE_CENTS) {
    invalid(`${label} must be greater than $0 and no more than $100 per ounce.`);
  }
  return cents;
}

export function isLiquorTapNumber(value) {
  const tapNumber = positiveInteger(value);
  return (tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92);
}

export function validatePmbPriceUpdateInput(input = {}) {
  const exactIdentity = input?.exactIdentity && typeof input.exactIdentity === "object"
    ? input.exactIdentity
    : {};
  const kind = clean(input.kind).toLowerCase();
  if (!kind || kind === "liquor" || !["beer", "cocktail"].includes(kind)) {
    invalid(
      "Only verified beer and cocktail taps can use the 82% pricing update.",
      "PMB_PRICE_KIND_NOT_ELIGIBLE",
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
      "PMB_PRICE_TARGET_REQUIRED",
    );
  }
  if (isLiquorTapNumber(identity.tapNumber)) {
    invalid(
      `Tap ${identity.tapNumber} is a liquor tap and cannot use the 82% pricing update.`,
      "PMB_PRICE_LIQUOR_TAP_REJECTED",
    );
  }

  const expectedCurrentPriceCents = pricePerOzToCents(
    input.expectedCurrentPricePerOz,
    "Expected current price",
  );
  const newPriceCents = pricePerOzToCents(input.newPricePerOz, "New price");
  if (newPriceCents <= expectedCurrentPriceCents) {
    invalid(
      "The new PMB price must be higher than the current price. This endpoint never lowers prices or republishes an unchanged price.",
      newPriceCents === expectedCurrentPriceCents
        ? "PMB_PRICE_NO_CHANGE"
        : "PMB_PRICE_DECREASE_REJECTED",
    );
  }

  if (!Array.isArray(input.expectedAssignments) || !input.expectedAssignments.length) {
    invalid(
      "Every displayed PMB tap sharing this product must be confirmed before its price can change.",
      "PMB_PRICE_ASSIGNMENTS_REQUIRED",
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
      "PMB_PRICE_ASSIGNMENTS_REQUIRED",
    );
  }
  const assignmentKeys = expectedAssignments.map(getAssignmentKey);
  if (new Set(assignmentKeys).size !== assignmentKeys.length) {
    invalid("The confirmed PMB assignment list contains duplicates.", "PMB_PRICE_ASSIGNMENTS_INVALID");
  }

  return {
    kind,
    identity,
    expectedCurrentPriceCents,
    newPriceCents,
    expectedAssignments,
  };
}

function getAssignmentKey(assignment) {
  return `${positiveInteger(assignment?.tapNumber)}:${positiveInteger(assignment?.deviceId)}:${positiveInteger(assignment?.lineNum)}`;
}

export function verifyPmbPriceTarget(rows, request) {
  const exact = verifyExactKegTarget(rows, request.identity);
  if (exact.tapNumber !== request.identity.tapNumber) {
    conflict(
      "That PMB tap number changed. Refresh tap pricing before trying again.",
      "PMB_PRICE_TAP_NUMBER_MISMATCH",
      { requestedTapNumber: request.identity.tapNumber, currentTapNumber: exact.tapNumber },
    );
  }
  if (normalizeName(exact.product) !== normalizeName(request.identity.name)) {
    conflict(
      "That PMB product assignment changed. Refresh tap pricing before trying again.",
      "PMB_PRICE_PRODUCT_NAME_MISMATCH",
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
      `PMB PLU ${request.identity.plu} has a live assignment without a verified tap number. No price was changed.`,
      "PMB_PRICE_ASSIGNMENT_INCOMPLETE",
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
      "The live taps sharing this PMB product changed after confirmation. Refresh tap pricing before trying again.",
      "PMB_PRICE_ASSIGNMENTS_CHANGED",
      { expectedAssignments: request.expectedAssignments, affectedAssignments },
    );
  }
  const liquorAssignment = affectedAssignments.find((row) => isLiquorTapNumber(row.tapNumber));
  if (liquorAssignment) {
    invalid(
      `PMB PLU ${request.identity.plu} is also assigned to liquor tap ${liquorAssignment.tapNumber}, so its price cannot be changed by the 82% advisor.`,
      "PMB_PRICE_SHARED_WITH_LIQUOR_TAP",
      { affectedAssignments },
    );
  }
  return { exact, affectedAssignments };
}

export function getUniquePmbProduct(products, request) {
  const matches = (Array.isArray(products) ? products : [])
    .filter((product) => positiveInteger(product?.plu) === request.identity.plu);
  if (matches.length !== 1) {
    conflict(
      matches.length
        ? `PMB returned ${matches.length} product records for PLU ${request.identity.plu}. No price was changed.`
        : `PMB product PLU ${request.identity.plu} is no longer available. No price was changed.`,
      "PMB_PRICE_PRODUCT_AMBIGUOUS",
      { plu: request.identity.plu, matchCount: matches.length },
    );
  }

  const product = matches[0];
  if (normalizeName(product.name) !== normalizeName(request.identity.name)) {
    conflict(
      "The PMB product name changed. Refresh tap pricing before trying again.",
      "PMB_PRICE_PRODUCT_NAME_MISMATCH",
      { requestedName: request.identity.name, currentName: clean(product.name) },
    );
  }
  const productType = Number(product.product_type);
  if (
    (request.kind === "beer" && productType !== 1)
    || (request.kind === "cocktail" && productType !== 3)
  ) {
    conflict(
      "The PMB product type no longer matches the reviewed beer or cocktail row. Refresh tap pricing before trying again.",
      "PMB_PRICE_PRODUCT_KIND_MISMATCH",
      { requestedKind: request.kind, productType },
    );
  }

  const currentPriceCents = Number(product.price_per_unit);
  if (!Number.isSafeInteger(currentPriceCents) || currentPriceCents <= 0) {
    conflict(
      "PMB returned an invalid current price. No price was changed.",
      "PMB_PRICE_CURRENT_INVALID",
    );
  }
  if (currentPriceCents !== request.expectedCurrentPriceCents) {
    conflict(
      "The live PMB price changed after this recommendation was loaded. Refresh tap pricing before trying again.",
      "PMB_PRICE_STALE",
      {
        expectedCurrentPriceCents: request.expectedCurrentPriceCents,
        currentPriceCents,
      },
    );
  }
  return product;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function parseAttributes(tag) {
  const attributes = {};
  const source = String(tag || "").replace(/^<\/?[a-z0-9:-]+\s*/i, "").replace(/\/?\s*>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function findEditForm(html) {
  const forms = String(html || "").match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const matches = forms.filter((form) => /name\s*=\s*["']submit_saveedit_product["']/i.test(form));
  if (matches.length !== 1) {
    throw new PmbPriceUpdateError(
      "PMB did not return one unambiguous product edit form. No price was changed.",
      { code: "PMB_PRICE_EDIT_FORM_INVALID", status: 502, details: { formCount: matches.length } },
    );
  }
  return matches[0];
}

function getSelectedOptionValues(selectHtml, selectAttributes) {
  const options = [...String(selectHtml || "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => {
      const attributes = parseAttributes(`<option ${match[1]}>`);
      return {
        value: attributes.value ?? decodeHtml(String(match[2] || "").replace(/<[^>]+>/g, "")).trim(),
        selected: Object.hasOwn(attributes, "selected"),
        disabled: Object.hasOwn(attributes, "disabled"),
      };
    })
    .filter((option) => !option.disabled);
  const selected = options.filter((option) => option.selected);
  if (Object.hasOwn(selectAttributes, "multiple")) return selected.map((option) => option.value);
  return [(selected[0] || options[0])?.value].filter((value) => value != null);
}

export function parsePmbProductEditForm(html) {
  const form = findEditForm(html);
  const controls = form.match(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>|<select\b[^>]*>[\s\S]*?<\/select>/gi) || [];
  const entries = [];

  controls.forEach((control) => {
    const openingTag = control.match(/^<[^>]+>/)?.[0] || control;
    const attributes = parseAttributes(openingTag);
    const name = clean(attributes.name);
    if (!name || /^submit_/i.test(name) || /^fd_delete_image$/i.test(name)) return;
    if (Object.hasOwn(attributes, "disabled")) return;

    if (/^<input\b/i.test(control)) {
      const type = clean(attributes.type || "text").toLowerCase();
      if (["submit", "button", "reset", "file", "image"].includes(type)) return;
      if (["checkbox", "radio"].includes(type) && !Object.hasOwn(attributes, "checked")) return;
      entries.push([name, attributes.value ?? (type === "checkbox" || type === "radio" ? "on" : "")]);
      return;
    }

    if (/^<textarea\b/i.test(control)) {
      const value = control.replace(/^<textarea\b[^>]*>/i, "").replace(/<\/textarea>$/i, "");
      entries.push([name, decodeHtml(value)]);
      return;
    }

    getSelectedOptionValues(control, attributes).forEach((value) => entries.push([name, value]));
  });

  return entries;
}

function getSingleEntry(entries, name) {
  const values = entries.filter(([key]) => key === name).map(([, value]) => value);
  if (values.length !== 1) {
    throw new PmbPriceUpdateError(
      `PMB product edit form did not contain one ${name} field. No price was changed.`,
      { code: "PMB_PRICE_EDIT_FORM_INVALID", status: 502, details: { field: name, count: values.length } },
    );
  }
  return values[0];
}

export function buildPmbPriceOnlyEditEntries(html, { plu, currentPriceCents, newPriceCents }) {
  const entries = parsePmbProductEditForm(html);
  const formPlu = positiveInteger(getSingleEntry(entries, "fd_plu"));
  const formPriceCents = pricePerOzToCents(getSingleEntry(entries, "fd_price_per_unit"), "PMB edit-form price");
  if (formPlu !== positiveInteger(plu)) {
    conflict(
      "The PMB product edit form opened a different PLU. No price was changed.",
      "PMB_PRICE_EDIT_FORM_TARGET_MISMATCH",
      { requestedPlu: positiveInteger(plu), formPlu },
    );
  }
  if (formPriceCents !== Number(currentPriceCents)) {
    conflict(
      "The PMB price changed while its edit form was opening. Refresh tap pricing before trying again.",
      "PMB_PRICE_STALE",
      { expectedCurrentPriceCents: Number(currentPriceCents), currentPriceCents: formPriceCents },
    );
  }

  const nextEntries = entries.map(([name, value]) => (
    name === "fd_price_per_unit"
      ? [name, (Number(newPriceCents) / 100).toFixed(2)]
      : [name, value]
  ));
  nextEntries.push(["submit_saveedit_product", "save"]);
  return nextEntries;
}

export function verifyPmbPriceReadback(products, { plu, newPriceCents }) {
  const matches = (Array.isArray(products) ? products : [])
    .filter((product) => positiveInteger(product?.plu) === positiveInteger(plu));
  const actualPriceCents = matches.length === 1 ? Number(matches[0].price_per_unit) : 0;
  if (matches.length !== 1 || actualPriceCents !== Number(newPriceCents)) {
    throw new PmbPriceUpdateError(
      "PMB did not confirm the requested price after saving.",
      {
        code: "PMB_PRICE_READBACK_FAILED",
        status: 502,
        details: { plu: positiveInteger(plu), matchCount: matches.length, expectedPriceCents: Number(newPriceCents), actualPriceCents },
      },
    );
  }
  return matches[0];
}

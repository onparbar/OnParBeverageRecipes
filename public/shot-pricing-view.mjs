function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isShotPricingTap(value) {
  const tap = number(value);
  return (tap >= 1 && tap <= 20) || (tap >= 83 && tap <= 92);
}

function normalizeAssignments(livePrice) {
  const provided = Array.isArray(livePrice?.assignments) ? livePrice.assignments : [];
  const fallback = livePrice?.tapPosition ? [livePrice] : [];
  return (provided.length ? provided : fallback).map((assignment) => ({
    tapNumber: number(assignment?.tapNumber || assignment?.tapPosition),
    deviceId: number(assignment?.deviceId),
    lineNum: number(assignment?.lineNum),
    wall: clean(assignment?.wall),
  }));
}

function normalizePortion(portion) {
  const price = number(portion?.price);
  return {
    name: clean(portion?.name),
    price,
    itemId: clean(portion?.itemId),
    quantityOz: number(portion?.quantityOz),
    priceRaw: number(portion?.priceRaw),
    priceDp: Number.isSafeInteger(Number(portion?.priceDp)) ? Number(portion.priceDp) : -1,
  };
}

function unique(values) {
  return new Set(values).size === values.length;
}

export function getShotPricingRowKey(livePrice = {}) {
  return `${number(livePrice.plu) || "no-plu"}:${number(livePrice.tapPosition) || "no-tap"}`;
}

export function buildShotPricingRows(tapRows = [], capability = {}) {
  const seenPlus = new Set();
  const rows = [];

  (Array.isArray(tapRows) ? tapRows : []).forEach((tapRow) => {
    const livePrice = tapRow?.livePrice || tapRow;
    const tapNumber = number(livePrice?.tapPosition);
    const plu = number(livePrice?.plu);
    const portions = (Array.isArray(livePrice?.portions) ? livePrice.portions : [])
      .map(normalizePortion)
      .filter((portion) => portion.name && portion.price > 0);
    if (!isShotPricingTap(tapNumber) || !portions.length) return;
    if (plu && seenPlus.has(plu)) return;
    if (plu) seenPlus.add(plu);

    const assignments = normalizeAssignments(livePrice);
    const blockers = [];
    if (!plu || !clean(livePrice?.name)) blockers.push("PMB product identity is incomplete.");
    if (livePrice?.isCurrentTap !== true || !assignments.length) {
      blockers.push("Refresh PMB prices on the work network to verify this physical tap.");
    } else if (assignments.some((assignment) => (
      !isShotPricingTap(assignment.tapNumber) || !assignment.deviceId || !assignment.lineNum
    ))) {
      blockers.push("Every PMB assignment sharing this product must be a verified liquor tap.");
    }
    if (portions.length !== 2) {
      blockers.push(`Exactly two PMB portions are required; ${portions.length} ${portions.length === 1 ? "was" : "were"} found.`);
    } else if (!unique(portions.map((portion) => portion.name.toLowerCase()))) {
      blockers.push("The two PMB portions must have different names.");
    }
    const stablePortions = portions.length === 2 && portions.every((portion) => (
      portion.itemId
      && portion.quantityOz > 0
      && portion.priceRaw > 0
      && portion.priceDp >= 0
    ));
    if (portions.length === 2 && !stablePortions) {
      blockers.push("One-time PMB portion identity verification is still required.");
    }
    if (capability?.writeAvailable !== true) {
      blockers.push(clean(capability?.message) || "Live PMB portion writes are not configured yet.");
    }

    rows.push({
      key: getShotPricingRowKey(livePrice),
      livePrice,
      plu,
      tapNumber,
      name: clean(livePrice?.name) || "Unmapped liquor",
      wall: clean(livePrice?.wall),
      assignments,
      portions,
      blockers: [...new Set(blockers)],
      canEdit: blockers.length === 0,
    });
  });

  return rows;
}

export function summarizeShotPricingRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    editable: list.filter((row) => row.canEdit).length,
    setupRequired: list.filter((row) => row.blockers.some((blocker) => /verification|configured/i.test(blocker))).length,
    blocked: list.filter((row) => !row.canEdit).length,
  };
}

export function validateShotPricePair(row, values = []) {
  if (!row?.canEdit) return { valid: false, message: row?.blockers?.[0] || "This shot price cannot be edited safely." };
  if (!Array.isArray(values) || values.length !== 2 || row.portions.length !== 2) {
    return { valid: false, message: "Both PMB portion prices are required." };
  }
  const cents = values.map((value) => {
    const text = clean(value);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return 0;
    const result = Math.round(Number(text) * 100);
    return Number.isSafeInteger(result) && result > 0 && result <= 100_000 ? result : 0;
  });
  if (cents.some((value) => !value)) {
    return { valid: false, message: "Enter both prices as positive dollar amounts with no more than two decimals." };
  }
  const currentCents = row.portions.map((portion) => Math.round(portion.price * 100));
  if (cents.every((value, index) => value === currentCents[index])) {
    return { valid: false, message: "Change at least one portion price before saving." };
  }
  return { valid: true, cents };
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export class PmbKegSafetyError extends Error {
  constructor(message, { code = "PMB_KEG_SAFETY_CHECK_FAILED", status = 503, details = {} } = {}) {
    super(message);
    this.name = "PmbKegSafetyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function unavailable(message, details = {}) {
  return new PmbKegSafetyError(message, {
    code: "PMB_TAP_CONFIG_UNAVAILABLE",
    status: 503,
    details,
  });
}

function normalizeActiveTapRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    throw unavailable(
      "Live PMB tap configuration is unavailable. No keg levels were returned.",
    );
  }

  const activeRows = rows
    .filter((row) => !row?.unused)
    .map((row) => ({
      plu: positiveInteger(row?.plu),
      deviceId: positiveInteger(row?.deviceId),
      lineNum: positiveInteger(row?.lineNum),
      tapNumber: positiveInteger(row?.tapNumber) || null,
      product: String(row?.product || "").replace(/\s+/g, " ").trim(),
    }));

  const invalidRow = activeRows.find((row) => !row.plu || !row.deviceId || !row.lineNum);
  if (invalidRow) {
    throw unavailable(
      "Live PMB tap configuration contains an incomplete active tap. No keg levels were returned.",
    );
  }

  if (!activeRows.length) {
    throw unavailable(
      "Live PMB tap configuration has no active taps. No keg levels were returned.",
    );
  }

  return activeRows;
}

/**
 * Returns every verified physical tap, preferring its customer-facing tap number
 * as the identity and falling back to the device/line tuple. A PLU may
 * legitimately appear on multiple walls, but physical slots and tap numbers
 * must remain unique.
 */
export function buildVerifiedKegSlotMap(rows) {
  const activeRows = normalizeActiveTapRows(rows);
  const verifiedSlots = new Map();
  const assignmentByPhysicalSlot = new Map();
  const assignmentByTapNumber = new Map();

  activeRows.forEach((row) => {
    const physicalSlotKey = `${row.deviceId}:${row.lineNum}`;
    const existingPhysicalAssignment = assignmentByPhysicalSlot.get(physicalSlotKey);
    const existingTapAssignment = row.tapNumber
      ? assignmentByTapNumber.get(row.tapNumber)
      : null;

    if (existingPhysicalAssignment && existingPhysicalAssignment.plu === row.plu
      && existingPhysicalAssignment.tapNumber === row.tapNumber
      && existingPhysicalAssignment.product === row.product) return;

    if (existingTapAssignment) {
      throw new PmbKegSafetyError(
        `PMB tap number ${row.tapNumber} is assigned to more than one live tap. No keg levels were returned.`,
        {
          code: "PMB_TAP_CONFIG_AMBIGUOUS",
          status: 503,
          details: { tapNumber: row.tapNumber },
        },
      );
    }

    if (
      existingPhysicalAssignment
      && (
        existingPhysicalAssignment.plu !== row.plu
        || existingPhysicalAssignment.tapNumber !== row.tapNumber
        || existingPhysicalAssignment.product !== row.product
      )
    ) {
      throw new PmbKegSafetyError(
        `PMB device ${row.deviceId}, line ${row.lineNum} has conflicting product assignments. No keg levels were returned.`,
        {
          code: "PMB_TAP_CONFIG_AMBIGUOUS",
          status: 503,
          details: { deviceId: row.deviceId, lineNum: row.lineNum },
        },
      );
    }

    // Identical no-tap-number rows do not create duplicate API items. Rows with
    // tap numbers were already rejected above because duplicate display taps
    // are never safe to choose between.
    if (existingPhysicalAssignment) return;

    const slotKey = row.tapNumber
      ? `tap:${row.tapNumber}`
      : `slot:${physicalSlotKey}`;
    const verifiedRow = { ...row, slotKey };
    verifiedSlots.set(slotKey, verifiedRow);
    assignmentByPhysicalSlot.set(physicalSlotKey, verifiedRow);
    if (row.tapNumber) assignmentByTapNumber.set(row.tapNumber, verifiedRow);
  });

  return verifiedSlots;
}

export function buildVerifiedPmbProductMap(products) {
  if (!Array.isArray(products) || !products.length) throw unavailable("PMB product catalog is unavailable.");
  const result = new Map();
  for (const product of products) {
    const plu = positiveInteger(product?.plu);
    if (!plu) throw unavailable("PMB returned an invalid product identity.");
    const prior = result.get(plu);
    if (prior && JSON.stringify(prior) !== JSON.stringify(product)) {
      throw unavailable(`PMB returned conflicting product records for PLU ${plu}.`, { plu });
    }
    result.set(plu, product);
  }
  return result;
}

/**
 * The live tap configuration owns controller identity. Catalog records provide
 * product metadata only for those verified assignments; a malformed, unrelated
 * catalog entry must not discard readings from every controller.
 */
export function buildVerifiedKegProductCatalog(products, slots) {
  if (!Array.isArray(products) || !products.length) throw unavailable("PMB product catalog is unavailable.");
  const verifiedSlots = [...buildVerifiedKegSlotMap(slots).values()];
  const assignedPlus = new Set(verifiedSlots.map(slot => slot.plu));
  const catalogIssues = [];
  const assignedProducts = products.filter((product, index) => {
    const plu = positiveInteger(product?.plu);
    if (!plu) {
      // Return only bounded identification fields, never the raw upstream record.
      catalogIssues.push({
        recordNumber: index + 1,
        plu: typeof product?.plu === "number" && Number.isFinite(product.plu) ? product.plu
          : typeof product?.plu === "string" ? product.plu.slice(0, 80) : null,
        name: typeof product?.name === "string" ? product.name.replace(/\s+/g, " ").trim().slice(0, 240) : "",
        code: "PMB_PRODUCT_IDENTITY_INVALID",
      });
      return false;
    }
    return assignedPlus.has(plu);
  });
  const productByPlu = assignedProducts.length ? buildVerifiedPmbProductMap(assignedProducts) : new Map();
  const nameKey = value => String(value || "").normalize("NFKC").replace(/’/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  for (const slot of verifiedSlots) {
    const product = productByPlu.get(slot.plu);
    if (!product || !nameKey(slot.product) || nameKey(product.name) !== nameKey(slot.product)) {
      throw unavailable(`PMB product identity could not be verified for tap ${slot.tapNumber || `${slot.deviceId}:${slot.lineNum}`} (PLU ${slot.plu}).`, {
        tapNumber: slot.tapNumber, plu: slot.plu,
      });
    }
  }
  return { productByPlu, catalogIssues };
}

export function requireKegTargetIdentity(requestedTarget = {}) {
  const plu = positiveInteger(requestedTarget.plu);
  const deviceId = positiveInteger(requestedTarget.deviceId);
  const lineNum = positiveInteger(requestedTarget.lineNum);

  if (!plu || !deviceId || !lineNum) {
    throw new PmbKegSafetyError(
      "A PMB PLU, device ID, and line number are all required to adjust a keg level.",
      {
        code: "PMB_TAP_TARGET_REQUIRED",
        status: 400,
      },
    );
  }

  return { plu, deviceId, lineNum };
}

/**
 * Verifies the complete client target against a freshly-read PMB tap config.
 * The write API intentionally does not infer any missing member of this tuple.
 */
export function verifyExactKegTarget(rows, requestedTarget = {}) {
  const { plu, deviceId, lineNum } = requireKegTargetIdentity(requestedTarget);

  const verifiedSlots = [...buildVerifiedKegSlotMap(rows).values()];
  const currentTargets = verifiedSlots.filter((row) => row.plu === plu);
  const exactTarget = currentTargets.find(
    (row) => row.deviceId === deviceId && row.lineNum === lineNum,
  );
  if (!exactTarget) {
    throw new PmbKegSafetyError(
      "That PMB tap assignment changed or could not be verified. Refresh keg levels before trying again.",
      {
        code: "PMB_TAP_TARGET_MISMATCH",
        status: 409,
        details: {
          requested: { plu, deviceId, lineNum },
          currentTargets: currentTargets.map((row) => ({
            plu: row.plu,
            deviceId: row.deviceId,
            lineNum: row.lineNum,
          })),
        },
      },
    );
  }

  return { ...exactTarget };
}

/**
 * Product replacement rewrites the product record at the current PLU. It is
 * safe only when that PLU belongs to one physical tap; otherwise other walls
 * carrying the same PLU would change too.
 */
export function verifyUniqueKegProductAssignment(rows, requestedTarget = {}) {
  const exactTarget = verifyExactKegTarget(rows, requestedTarget);
  const assignments = [...buildVerifiedKegSlotMap(rows).values()]
    .filter((row) => row.plu === exactTarget.plu);

  if (assignments.length !== 1) {
    throw new PmbKegSafetyError(
      `PMB PLU ${exactTarget.plu} is assigned to ${assignments.length} physical taps, so one tap cannot be replaced safely.`,
      {
        code: "PMB_PRODUCT_ASSIGNMENT_AMBIGUOUS",
        status: 409,
        details: {
          plu: exactTarget.plu,
          assignments: assignments.map((row) => ({
            deviceId: row.deviceId,
            lineNum: row.lineNum,
            tapNumber: row.tapNumber,
          })),
        },
      },
    );
  }

  return exactTarget;
}

export function requireSuccessfulKegLevelResponse(
  response,
  slot = {},
  { requireKegSize = true } = {},
) {
  const status = Number(response?.status || 0);
  const parseRequiredNumber = (value) => (
    value == null || String(value).trim() === "" ? Number.NaN : Number(value)
  );
  const rawPercent = parseRequiredNumber(response?.json?.fill_level_perc);
  const rawKegSize = parseRequiredNumber(response?.json?.fill_level_keg_size);
  const rawKegSizeDp = parseRequiredNumber(response?.json?.fill_level_keg_size_dp);
  // Some controllers return an all-zero payload with HTTP 200 when their
  // level configuration is unavailable. That is not evidence of an empty keg.
  const unconfiguredZero = rawPercent === 0
    && (!Number.isFinite(rawKegSize) || rawKegSize <= 0
      || !Number.isFinite(rawKegSizeDp) || rawKegSizeDp < 0 || rawKegSizeDp > 6);
  const jsonObject = Boolean(response?.json)
    && typeof response.json === "object"
    && !Array.isArray(response.json);
  let failureReason = "the response was incomplete";
  if (status !== 200) failureReason = `PMB returned HTTP ${status || 0}`;
  else if (!jsonObject) failureReason = "PMB did not return a JSON object";
  else if (!Number.isFinite(rawPercent) || rawPercent < 0 || rawPercent > 10_000) {
    failureReason = "PMB returned a missing or invalid fill_level_perc";
  } else if (unconfiguredZero) {
    failureReason = "PMB returned zero without valid keg configuration; the empty level is unverified";
  } else if (requireKegSize && (!Number.isFinite(rawKegSize) || rawKegSize <= 0)) {
    failureReason = "PMB returned a missing or invalid fill_level_keg_size";
  } else if (requireKegSize && (!Number.isFinite(rawKegSizeDp) || rawKegSizeDp < 0 || rawKegSizeDp > 6)) {
    failureReason = "PMB returned a missing or invalid fill_level_keg_size_dp";
  }
  if (
    status !== 200
    || !jsonObject
    || !Number.isFinite(rawPercent)
    || rawPercent < 0
    || rawPercent > 10_000
    || unconfiguredZero
    || (
      requireKegSize
      && (
        !Number.isFinite(rawKegSize)
        || rawKegSize <= 0
        || !Number.isFinite(rawKegSizeDp)
        || rawKegSizeDp < 0
        || rawKegSizeDp > 6
      )
    )
  ) {
    throw new PmbKegSafetyError(
      `PMB keg-level read failed for device ${positiveInteger(slot.deviceId) || "?"}, line ${positiveInteger(slot.lineNum) || "?"} (${status}): ${failureReason}. No keg levels were returned.`,
      {
        code: "PMB_KEG_LEVEL_READ_FAILED",
        status: 503,
        details: {
          deviceId: positiveInteger(slot.deviceId) || null,
          lineNum: positiveInteger(slot.lineNum) || null,
          upstreamStatus: status,
          failureReason,
        },
      },
    );
  }

  return response.json;
}

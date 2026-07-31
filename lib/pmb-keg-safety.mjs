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

export function requireSuccessfulKegLevelResponse(response, slot = {}) {
  const status = Number(response?.status || 0);
  const rawPercent = Number(response?.json?.fill_level_perc);
  const rawKegSize = Number(response?.json?.fill_level_keg_size);
  const rawKegSizeDp = Number(response?.json?.fill_level_keg_size_dp);
  if (
    status !== 200
    || !response?.json
    || typeof response.json !== "object"
    || Array.isArray(response.json)
    || !Number.isFinite(rawPercent)
    || rawPercent < 0
    || rawPercent > 10_000
    || !Number.isFinite(rawKegSize)
    || rawKegSize <= 0
    || !Number.isFinite(rawKegSizeDp)
    || rawKegSizeDp < 0
    || rawKegSizeDp > 6
  ) {
    throw new PmbKegSafetyError(
      `PMB keg-level read failed for device ${positiveInteger(slot.deviceId) || "?"}, line ${positiveInteger(slot.lineNum) || "?"} (${status}). No keg levels were returned.`,
      {
        code: "PMB_KEG_LEVEL_READ_FAILED",
        status: 503,
        details: {
          deviceId: positiveInteger(slot.deviceId) || null,
          lineNum: positiveInteger(slot.lineNum) || null,
          upstreamStatus: status,
        },
      },
    );
  }

  return response.json;
}

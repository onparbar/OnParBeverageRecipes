import { PmbKegSafetyError } from "./pmb-keg-safety.mjs";
import { applyTapReplacementSafety } from "./tap-replacement-safety.mjs";

function number(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function addToMapList(map, key, value) {
  const existing = map.get(key) || [];
  existing.push(value);
  map.set(key, existing);
}

export function buildWeeklyUsageTapContext(
  currentTaps,
  tapLookup = { byExactAlias: new Map(), byLooseAlias: new Map() },
) {
  const currentTapsByPlu = new Map();
  const currentTapByNumber = new Map();
  const currentTapByPhysicalSlot = new Map();

  currentTaps.forEach((tap) => {
    addToMapList(currentTapsByPlu, number(tap.plu), tap);
    if (number(tap.tapNumber)) currentTapByNumber.set(number(tap.tapNumber), tap);
    if (number(tap.deviceId) && number(tap.lineNum)) {
      currentTapByPhysicalSlot.set(`${number(tap.deviceId)}:${number(tap.lineNum)}`, tap);
    }
  });

  return { tapLookup, currentTaps, currentTapsByPlu, currentTapByNumber, currentTapByPhysicalSlot };
}

export function applyWeeklyUsageTapReplacementSafety(
  currentTaps,
  replacements = {},
  approvedChangeovers = [],
) {
  return applyTapReplacementSafety(currentTaps, replacements, approvedChangeovers);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strictPmbNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "number"
    ? String(value)
    : String(value).trim().replace(/,/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function requirePlausibleWeeklyTransactions(
  transactions,
  {
    label = "completed week",
    minimumPositiveRows = 1,
    allowReviewedSparseWeek = false,
  } = {},
) {
  if (!Array.isArray(transactions)) {
    throw new PmbKegSafetyError(
      `PMB returned an invalid transaction list for ${clean(label) || "the completed week"}. No usage was saved.`,
      {
        code: "PMB_WEEKLY_USAGE_SCHEMA_INVALID",
        status: 503,
        details: { transactionCount: 0, invalidTransactionCount: 1 },
      },
    );
  }

  const invalidRows = transactions.filter((transaction) => {
    if (!isPlainObject(transaction)) return true;
    const plu = strictPmbNumber(transaction.plu);
    const volume = strictPmbNumber(transaction.volume_amount);
    return !Number.isSafeInteger(plu) || plu <= 0 || volume === null || volume < 0;
  });
  if (invalidRows.length) {
    throw new PmbKegSafetyError(
      `PMB returned ${invalidRows.length} malformed transaction row${invalidRows.length === 1 ? "" : "s"} for ${clean(label) || "the completed week"}. No usage was saved.`,
      {
        code: "PMB_WEEKLY_USAGE_SCHEMA_INVALID",
        status: 503,
        details: {
          transactionCount: transactions.length,
          invalidTransactionCount: invalidRows.length,
        },
      },
    );
  }

  const positiveRowCount = transactions.filter((transaction) => (
    strictPmbNumber(transaction.volume_amount) > 0
  )).length;
  const requiredPositiveRows = Math.max(1, Math.floor(Number(minimumPositiveRows) || 1));
  if (positiveRowCount < requiredPositiveRows && !allowReviewedSparseWeek) {
    const reason = positiveRowCount === 0 ? "closed-or-empty" : "sparse";
    throw new PmbKegSafetyError(
      `PMB returned ${positiveRowCount ? `only ${positiveRowCount} positive pour row${positiveRowCount === 1 ? "" : "s"}` : "no positive pour transactions"} for ${clean(label) || "the completed week"}. Owner review is required before this week can be accepted.`,
      {
        code: "PMB_WEEKLY_USAGE_REVIEW_REQUIRED",
        status: 409,
        details: {
          reason,
          transactionCount: transactions.length,
          positiveRowCount,
          minimumPositiveRows: requiredPositiveRows,
        },
      },
    );
  }
  return transactions;
}

function getTransactionTapNumber(transaction) {
  return number(
    transaction?.tapNumber
    ?? transaction?.tap_number
    ?? transaction?.tap_num
    ?? transaction?.tap_no
    ?? transaction?.tap,
  );
}

function getTransactionPhysicalSlot(transaction) {
  const deviceId = number(
    transaction?.deviceId
    ?? transaction?.device_id
    ?? transaction?.controller_id,
  );
  const lineNum = number(
    transaction?.lineNum
    ?? transaction?.line_num
    ?? transaction?.line_number,
  );
  return deviceId && lineNum ? `${deviceId}:${lineNum}` : "";
}

function resolveTransactionTap(transaction, plu, context) {
  const tapNumber = getTransactionTapNumber(transaction);
  const physicalSlot = getTransactionPhysicalSlot(transaction);
  const tap = (tapNumber ? context.currentTapByNumber.get(tapNumber) : null)
    || (physicalSlot ? context.currentTapByPhysicalSlot.get(physicalSlot) : null)
    || null;
  if (tap && number(tap.plu) !== plu) {
    throw new PmbKegSafetyError(
      `PMB weekly usage identified tap ${tap.tapNumber || "?"} with a PLU that does not match its live assignment. No usage was saved.`,
      {
        code: "PMB_WEEKLY_USAGE_TAP_MISMATCH",
        status: 503,
        details: { tapNumber: tap.tapNumber || null, transactionPlu: plu, currentPlu: number(tap.plu) },
      },
    );
  }
  if (tap) return tap;

  const candidates = context.currentTapsByPlu.get(plu) || [];
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new PmbKegSafetyError(
      `PMB weekly usage returned PLU ${plu} without a physical tap identity, but that PLU is installed on taps ${candidates.map((item) => item.tapNumber).join(", ")}. No usage was saved.`,
      {
        code: "PMB_WEEKLY_USAGE_AMBIGUOUS_TAP",
        status: 503,
        details: { plu, tapNumbers: candidates.map((item) => item.tapNumber) },
      },
    );
  }
  return null;
}

export function buildPhysicalWeeklyUsageItems(transactions, productByPlu, context) {
  const grouped = new Map();
  transactions.forEach((transaction) => {
    const plu = number(transaction?.plu);
    const volumeOz = number(transaction?.volume_amount);
    if (!plu || volumeOz <= 0) return;
    const tap = resolveTransactionTap(transaction, plu, context);
    const key = tap ? `tap:${tap.tapNumber}` : `plu:${plu}`;

    const existing = grouped.get(key) || {
      plu,
      name: clean(productByPlu.get(plu)?.name) || `PLU ${plu}`,
      volumeOz: 0,
      transactionCount: 0,
      tapNumber: tap?.tapNumber || null,
      wall: tap?.wall || "",
      type: tap?.type || "",
      brand: tap?.brand || tap?.name || "",
      templateBrand: tap?.templateBrand || "",
      isCurrentTap: Boolean(tap),
    };
    existing.volumeOz += volumeOz;
    existing.transactionCount += 1;
    grouped.set(key, existing);
  });

  context.currentTaps.forEach((tap) => {
    const key = `tap:${tap.tapNumber}`;
    if (grouped.has(key)) return;
    grouped.set(key, {
      plu: tap.plu,
      name: tap.name || productByPlu.get(tap.plu)?.name || `PLU ${tap.plu}`,
      volumeOz: 0,
      transactionCount: 0,
      tapNumber: tap.tapNumber,
      wall: tap.wall || "",
      type: tap.type || "",
      brand: tap.brand || tap.name || "",
      templateBrand: tap.templateBrand || "",
      isCurrentTap: true,
    });
  });

  return [...grouped.values()];
}

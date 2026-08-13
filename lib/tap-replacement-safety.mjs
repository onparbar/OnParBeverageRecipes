function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeKind(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "recipe" || normalized === "cocktail") return "cocktail";
  if (normalized === "beer") return "beer";
  if (normalized === "liquor" || normalized === "shots" || normalized === "shot") return "liquor";
  if ([
    "ale", "blonde", "bourbon ale", "cider", "golden wheat", "ipa", "lager",
    "seasonal", "seltzer", "sour", "stout", "strong ale", "wheat",
  ].includes(normalized)) return "beer";
  return "";
}

function getReplacementTapNumber(key, replacement = {}) {
  const explicit = positiveInteger(replacement.tapNumber);
  if (explicit) return explicit;
  const matches = clean(key).match(/(?:^|-)(\d+)(?:-|$)/g) || [];
  for (const match of matches) {
    const tapNumber = positiveInteger(match.replace(/-/g, ""));
    if (tapNumber) return tapNumber;
  }
  return 0;
}

export class TapReplacementSafetyError extends Error {
  constructor(message, { code = "TAP_REPLACEMENT_UNSAFE", status = 409, details = {} } = {}) {
    super(message);
    this.name = "TapReplacementSafetyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getVerifiedTapReplacement(tap, replacements = {}) {
  const tapNumber = positiveInteger(tap?.tapNumber);
  const currentPlu = positiveInteger(tap?.plu);
  if (!tapNumber) return null;

  const candidates = Object.entries(replacements || {}).filter(([key, replacement]) => (
    replacement
    && typeof replacement === "object"
    && getReplacementTapNumber(key, replacement) === tapNumber
  ));
  if (!candidates.length) return null;

  const matching = candidates.filter(([, replacement]) => (
    !positiveInteger(replacement.newPlu)
    || !currentPlu
    || positiveInteger(replacement.newPlu) === currentPlu
  ));
  if (matching.length !== 1) {
    throw new TapReplacementSafetyError(
      `Tap ${tapNumber} has ambiguous or stale replacement metadata. Existing recommendations were kept.`,
      {
        code: "TAP_REPLACEMENT_METADATA_AMBIGUOUS",
        details: { tapNumber, currentPlu, candidateCount: candidates.length, matchingCount: matching.length },
      },
    );
  }

  const replacement = matching[0][1];
  const kind = normalizeKind(replacement.newKind);
  if (!kind) {
    throw new TapReplacementSafetyError(
      `Tap ${tapNumber} was replaced, but its beverage kind is unknown. Existing recommendations were kept.`,
      {
        code: "TAP_REPLACEMENT_KIND_UNKNOWN",
        details: { tapNumber, currentPlu },
      },
    );
  }
  if (!clean(replacement.replacedAt)) {
    throw new TapReplacementSafetyError(
      `Tap ${tapNumber} replacement history has no changeover timestamp. Existing recommendations were kept.`,
      {
        code: "TAP_REPLACEMENT_BOUNDARY_MISSING",
        details: { tapNumber, currentPlu },
      },
    );
  }

  return { ...replacement, tapNumber, kind };
}

export function applyVerifiedTapReplacement(tap, replacements = {}) {
  const replacement = getVerifiedTapReplacement(tap, replacements);
  if (!replacement) return { ...tap };
  const type = replacement.kind === "cocktail"
    ? "Cocktail"
    : replacement.kind === "liquor"
      ? "Shots"
      : "Beer";
  return {
    ...tap,
    type,
    replacementKind: replacement.kind,
    replacementChangedAt: replacement.replacedAt,
  };
}

function normalizeProductName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+[123]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getUnsafeReplacementHistoryReason(tap, replacement, approvedChangeovers = []) {
  if (!replacement || typeof replacement !== "object") return "";
  const oldName = clean(replacement.oldBrand);
  const newName = clean(replacement.newBrand || tap?.name);
  if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) return "";
  const oldPlu = positiveInteger(replacement.oldPlu);
  const newPlu = positiveInteger(replacement.newPlu || tap?.plu);
  if (!clean(replacement.replacedAt)) return "The tap replacement has no recorded changeover timestamp.";
  if (!oldPlu || !newPlu || oldPlu === newPlu) {
    const hasApprovedBoundary = (approvedChangeovers || []).some((changeover) => (
      positiveInteger(changeover?.tapNumber) === positiveInteger(tap?.tapNumber)
      && normalizeProductName(changeover?.currentName) === normalizeProductName(newName)
      && /^\d{4}-\d{2}-\d{2}$/.test(clean(changeover?.effectiveDate))
      && ["current", "previous"].includes(clean(changeover?.splitWeek).toLowerCase())
    ));
    if (hasApprovedBoundary) return "";
    return "The tap replacement reused its PMB PLU, so historical usage cannot be separated automatically at the recorded changeover.";
  }
  return "";
}

export function applyTapReplacementSafety(
  currentTaps,
  replacements = {},
  approvedChangeovers = [],
) {
  return (currentTaps || []).map((tap) => {
    const replacement = getVerifiedTapReplacement(tap, replacements);
    const reason = getUnsafeReplacementHistoryReason(tap, replacement, approvedChangeovers);
    if (reason) {
      throw new TapReplacementSafetyError(
        `Tap ${positiveInteger(tap?.tapNumber) || "?"} replacement history cannot be separated safely: ${reason}`,
        {
          code: "TAP_REPLACEMENT_HISTORY_UNSAFE",
          details: { tapNumber: positiveInteger(tap?.tapNumber) || null, reason },
        },
      );
    }
    return replacement ? applyVerifiedTapReplacement(tap, replacements) : { ...tap };
  });
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSnapshot(snapshot) {
  return {
    updatedAt: String(snapshot?.updatedAt || "").trim(),
    items: Array.isArray(snapshot?.items) ? snapshot.items : [],
    deviceLevels: snapshot?.deviceLevels && typeof snapshot.deviceLevels === "object"
      ? snapshot.deviceLevels
      : {},
  };
}

function validateCompleteSnapshot(snapshot, expectedTapNumbers) {
  const expected = expectedTapNumbers.map(positiveInteger).filter(Boolean);
  const expectedSet = new Set(expected);
  if (!expected.length || expectedSet.size !== expected.length) {
    return { valid: false, issue: "The saved wall tap list is incomplete." };
  }

  const normalized = normalizeSnapshot(snapshot);
  const seen = new Set();
  for (const item of normalized.items) {
    const tapNumber = positiveInteger(item?.tapNumber);
    const productName = String(item?.name || item?.tapProduct || "").trim();
    if (!tapNumber || !positiveInteger(item?.plu) || !productName || seen.has(tapNumber)) {
      return { valid: false, issue: "PMB returned an incomplete or duplicate tap." };
    }
    seen.add(tapNumber);
  }

  const exactWall = seen.size === expectedSet.size
    && [...expectedSet].every((tapNumber) => seen.has(tapNumber));
  if (!exactWall) {
    return { valid: false, issue: "PMB did not return the complete saved wall." };
  }

  return {
    valid: true,
    snapshot: {
      ...normalized,
      items: normalized.items.slice().sort((a, b) => positiveInteger(a.tapNumber) - positiveInteger(b.tapNumber)),
    },
  };
}

export function selectPmbCurrentTapSnapshot({
  candidate,
  fallback,
  expectedTapNumbers = [],
} = {}) {
  const candidateResult = validateCompleteSnapshot(candidate, expectedTapNumbers);
  if (candidateResult.valid) {
    return {
      accepted: true,
      source: "candidate",
      snapshot: candidateResult.snapshot,
      issue: "",
    };
  }

  const fallbackResult = validateCompleteSnapshot(fallback, expectedTapNumbers);
  return {
    accepted: false,
    source: fallbackResult.valid ? "fallback" : "none",
    snapshot: fallbackResult.valid ? fallbackResult.snapshot : null,
    issue: candidateResult.issue,
  };
}

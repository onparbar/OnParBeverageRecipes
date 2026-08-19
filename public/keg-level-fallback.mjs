function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function findExactLastKnownKegLevel(snapshot, slot) {
  if (!snapshot || !Array.isArray(snapshot.items) || !slot) return null;
  const identity = {
    tapNumber: positiveInteger(slot.tapNumber),
    deviceId: positiveInteger(slot.deviceId),
    lineNum: positiveInteger(slot.lineNum),
    plu: positiveInteger(slot.plu),
  };
  if (Object.values(identity).some((value) => !value)) return null;

  const matches = snapshot.items.filter((item) => (
    positiveInteger(item?.tapNumber) === identity.tapNumber
    && positiveInteger(item?.deviceId) === identity.deviceId
    && positiveInteger(item?.lineNum) === identity.lineNum
    && positiveInteger(item?.plu) === identity.plu
  ));
  if (matches.length !== 1) return null;

  const fillLevelPercent = Number(matches[0].fillLevelPercent);
  if (!Number.isFinite(fillLevelPercent) || fillLevelPercent < 0 || fillLevelPercent > 100) return null;
  return {
    ...matches[0],
    fillLevelPercent,
    lastKnownAt: String(snapshot.updatedAt || ""),
  };
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function compareAssignments(a, b) {
  const tapA = positiveInteger(a.tapNumber) || Number.MAX_SAFE_INTEGER;
  const tapB = positiveInteger(b.tapNumber) || Number.MAX_SAFE_INTEGER;
  return tapA - tapB
    || positiveInteger(a.deviceId) - positiveInteger(b.deviceId)
    || positiveInteger(a.lineNum) - positiveInteger(b.lineNum);
}

function assignmentIdentity(assignment) {
  const deviceId = positiveInteger(assignment.deviceId);
  const lineNum = positiveInteger(assignment.lineNum);
  if (deviceId && lineNum) return `${deviceId}:${lineNum}`;
  const tapNumber = positiveInteger(assignment.tapNumber);
  return tapNumber ? `tap:${tapNumber}` : "";
}

/**
 * Groups every verified physical PMB assignment by product PLU. A PLU may be
 * installed on more than one wall, so callers must not reduce this to a
 * single map value before exposing identity for a write review.
 */
export function buildCurrentTapAssignments(rows = [], tapLookup = { byTap: new Map() }) {
  const byPlu = new Map();
  const seenAssignments = new Set();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (row?.unused) return;
    const plu = positiveInteger(row?.plu);
    const tapNumber = positiveInteger(row?.tapNumber);
    const deviceId = positiveInteger(row?.deviceId);
    const lineNum = positiveInteger(row?.lineNum);
    if (!plu || !tapNumber || !deviceId || !lineNum) return;

    const template = tapLookup?.byTap?.get(tapNumber) || {};
    const assignment = {
      tapPosition: tapNumber,
      tapNumber,
      wall: clean(template.wall),
      type: clean(template.type),
      matchedBrand: clean(row.product) || clean(template.brand),
      templateBrand: clean(template.brand),
      deviceId,
      lineNum,
    };
    const identity = assignmentIdentity(assignment);
    const seenKey = `${plu}:${identity}`;
    if (!identity || seenAssignments.has(seenKey)) return;
    seenAssignments.add(seenKey);

    if (!byPlu.has(plu)) byPlu.set(plu, []);
    byPlu.get(plu).push(assignment);
  });

  byPlu.forEach((assignments) => assignments.sort(compareAssignments));
  return byPlu;
}

export function getTapPricingRepresentativeAssignment(assignments = []) {
  return [...(Array.isArray(assignments) ? assignments : [])].sort(compareAssignments)[0] || null;
}

export function expandTapPricingAssignments(assignments = []) {
  return [...(Array.isArray(assignments) ? assignments : [])].sort(compareAssignments);
}

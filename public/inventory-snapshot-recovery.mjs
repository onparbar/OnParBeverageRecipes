function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// Voice aliases and modification timestamps can advance the revision without
// changing any input used by the inventory snapshot.
export function inventorySnapshotInputsMatch(local = {}, shared = {}) {
  const inputs = (state) => ({
    onHandOverrides: state.onHandOverrides || {},
    parOverrides: state.parOverrides || {},
    customItems: state.customItems || [],
    itemOrder: state.itemOrder || [],
  });
  return JSON.stringify(canonical(inputs(local))) === JSON.stringify(canonical(inputs(shared)));
}

export function isRejectedInventorySnapshot(entry) {
  if (entry?.payload?.action !== "save-snapshot") return false;
  if (entry.conflict === true) return true;
  const capturedRevision = entry.payload.snapshotBaseState?.revision;
  // Older clients rebased the request envelope without changing its captured
  // inputs. That request is invalid, including after its error text was lost.
  // An intact capture with an uncertain network outcome must remain retryable.
  return entry.payload.reliableCapture === true
    && Number.isSafeInteger(capturedRevision) && capturedRevision >= 0
    && Number.isSafeInteger(entry.baseRevision) && entry.baseRevision >= 0
    && capturedRevision !== entry.baseRevision;
}

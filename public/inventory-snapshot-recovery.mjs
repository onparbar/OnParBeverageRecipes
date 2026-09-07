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

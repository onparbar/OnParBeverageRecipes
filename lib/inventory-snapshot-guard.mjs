function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function inventorySnapshotBaseMatches(base, current) {
  if (!base?.initialized || !current?.initialized
    || !base.current || !current.current
    || !Array.isArray(base.snapshots) || !Array.isArray(current.snapshots)) return false;
  const inputs = (state) => ({
    // Learned words and edit timestamps do not change snapshot inputs. Keep
    // every other field, including counts, cabinet assignments, and receipts.
    current: Object.fromEntries(Object.entries(state.current).filter(([key]) => (
      !["speechAliases", "updatedAt", "updatedByRole"].includes(key)
    ))),
    snapshots: state.snapshots,
  });
  return JSON.stringify(canonical(inputs(base))) === JSON.stringify(canonical(inputs(current)));
}

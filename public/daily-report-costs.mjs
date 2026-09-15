const nameKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function fillDailyReportCost(row, costs = []) {
  // Preserve captured historical costs. Today's cost is only an explicitly
  // labeled estimate, never a replacement for a saved historical snapshot.
  if (Number.isFinite(row.estimatedGrossProfit)) return row;
  let costPerOz = Number(row.costPerOz);
  let currentCostEstimate = false;
  if (!(costPerOz > 0)) {
    const matches = costs.filter(cost => Number(row.plu) > 0
      && Number(cost.plu) === Number(row.plu)
      && nameKey(cost.product) === nameKey(row.product)
      && Number(cost.costPerOz) > 0 && Number.isFinite(Number(cost.costPerOz)));
    const prices = [...new Set(matches.map(cost => Number(cost.costPerOz)))];
    // A shared PLU is safe only when product identity and cost agree.
    if (prices.length !== 1) return row;
    costPerOz = prices[0];
    currentCostEstimate = true;
  }
  if (!Number.isFinite(row.volumeOz) || row.volumeOz < 0) return row;
  const estimatedCost = row.volumeOz * costPerOz;
  return { ...row, estimatedCost, currentCostEstimate,
    estimatedGrossProfit: Number.isFinite(row.revenue) ? row.revenue - estimatedCost : null };
}

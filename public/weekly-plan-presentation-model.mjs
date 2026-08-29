import { formatNumber, sum, toNumber } from "./dashboard-formatters.mjs";

export function buildWeeklyPlanPresentationModel({
  plan,
  vendorOrderModel,
  planLocked,
  isMonday,
}) {
  const activeOrderLines = vendorOrderModel.drafts.flatMap((draft) => draft.lines || []);
  const activeMissingPriceCount = activeOrderLines.filter((line) => (
    !line.excludeFromOrderCost && !(toNumber(line.unitCost) > 0)
  )).length;
  const summary = {
    ...plan.summary,
    orderLineCount: activeOrderLines.length,
    beerKegTotal: sum(activeOrderLines
      .filter((line) => line.lineType === "Beer keg")
      .map((line) => toNumber(line.requestedUnits))),
    liquorTapBottleTotal: sum(activeOrderLines
      .filter((line) => line.lineType === "Liquor tap bottle")
      .map((line) => toNumber(line.requestedUnits))),
    estimatedKnownPurchaseCost: vendorOrderModel.weeklyTotal,
    missingPriceCount: activeMissingPriceCount,
    estimatedPurchaseCostComplete: activeMissingPriceCount === 0,
  };
  const requiresLateSnapshotReason = !planLocked && !isMonday;
  const priceNote = summary.estimatedPurchaseCostComplete
    ? ""
    : `${summary.missingPriceCount ? `${formatNumber(summary.missingPriceCount)} active line${summary.missingPriceCount === 1 ? " is" : "s are"} missing a price. ` : ""}The total shown is the known-price subtotal, not a complete spend total.`;

  return {
    activeOrderLines,
    priceNote,
    requiresLateSnapshotReason,
    summary,
  };
}

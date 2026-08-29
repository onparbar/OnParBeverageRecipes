import { clean, toNumber } from "./dashboard-formatters.mjs";
import { normalizeVendorOrderPolicy } from "./vendor-order-drafts.mjs";

export function normalizeWeeklyOrderTracking(result = {}) {
  return {
    available: result?.available === true,
    generatedAt: clean(result?.generatedAt),
    drafts: Array.isArray(result?.drafts) ? result.drafts : [],
    adjustments: Array.isArray(result?.adjustments) ? result.adjustments : [],
    adjustmentCatalog: Array.isArray(result?.adjustmentCatalog) ? result.adjustmentCatalog : [],
    vendors: Array.isArray(result?.vendors) ? result.vendors : [],
    itemCount: toNumber(result?.itemCount),
    receivedCount: toNumber(result?.receivedCount),
    notReceivedCount: toNumber(result?.notReceivedCount),
    notReceivedItems: Array.isArray(result?.notReceivedItems) ? result.notReceivedItems : [],
    orderPolicy: normalizeVendorOrderPolicy(result?.orderPolicy),
    stateRevision: toNumber(result?.stateRevision),
    message: clean(result?.message),
  };
}

export function normalizeDashboardStaffPrepPlan(result = {}) {
  return {
    available: result?.available === true,
    generatedAt: clean(result?.generatedAt),
    items: Array.isArray(result?.items) ? result.items : [],
    liquorRefills: Array.isArray(result?.liquorRefills) ? result.liquorRefills : [],
    completedCount: toNumber(result?.completedCount),
    totalCount: toNumber(result?.totalCount),
    liquorRefillCompletedCount: toNumber(result?.liquorRefillCompletedCount),
    liquorRefillTotalCount: toNumber(result?.liquorRefillTotalCount),
    message: clean(result?.message),
  };
}

export function buildFinishWeekProgress({ weeklyOrderTracking = {}, dashboardStaffPrepPlan = {} } = {}) {
  const deliveryItems = weeklyOrderTracking.available
    ? (weeklyOrderTracking.vendors || []).flatMap((vendor) => Array.isArray(vendor.items) ? vendor.items : [])
    : [];
  const deliveryReviewedCount = deliveryItems.filter((item) => clean(item.status) !== "pending").length;
  const deliveryTotalCount = deliveryItems.length;
  const cocktailCompletedCount = toNumber(dashboardStaffPrepPlan.completedCount);
  const cocktailTotalCount = toNumber(dashboardStaffPrepPlan.totalCount);
  const liquorCompletedCount = toNumber(dashboardStaffPrepPlan.liquorRefillCompletedCount);
  const liquorTotalCount = toNumber(dashboardStaffPrepPlan.liquorRefillTotalCount);
  const sections = [
    {
      id: "deliveries",
      label: "Deliveries",
      complete: weeklyOrderTracking.available === true && deliveryReviewedCount >= deliveryTotalCount,
      completedCount: deliveryReviewedCount,
      totalCount: deliveryTotalCount,
    },
    {
      id: "cocktails",
      label: "Cocktails",
      complete: dashboardStaffPrepPlan.available === true && cocktailCompletedCount >= cocktailTotalCount,
      completedCount: cocktailCompletedCount,
      totalCount: cocktailTotalCount,
    },
    {
      id: "liquor",
      label: "Liquor",
      complete: dashboardStaffPrepPlan.available === true && liquorCompletedCount >= liquorTotalCount,
      completedCount: liquorCompletedCount,
      totalCount: liquorTotalCount,
    },
  ];
  const remainingCount = sections.reduce((total, section) => (
    total + (section.complete ? 0 : Math.max(1, section.totalCount - section.completedCount))
  ), 0);
  return {
    sections,
    complete: sections.every((section) => section.complete),
    remainingCount,
  };
}

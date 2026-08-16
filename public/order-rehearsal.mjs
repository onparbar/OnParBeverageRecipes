import { createVendorOrderDraftId } from "./vendor-order-drafts.mjs";

const GENERATED_AT = "rehearsal-current-week";
const SOURCE_DATE = "Rehearsal fixture";

function line({ id, name, sku, units, cases = null, packSize = 1, unitCost, reason }) {
  return {
    id,
    internalId: id,
    name,
    productName: name,
    vendorSku: sku,
    requestedUnits: units,
    requestedCases: cases,
    packSize,
    unitCost,
    extendedCost: unitCost * (cases || units),
    reason,
    sourceDate: SOURCE_DATE,
    substitutionsAllowed: false,
    blockers: [],
    warnings: [],
    confidence: "ready",
  };
}

function draft(vendor, lines, warnings = [], proofFee = null) {
  const result = {
    generatedAt: GENERATED_AT,
    sourceDate: SOURCE_DATE,
    vendor,
    confirmationRecipient: "samantha@onparbar.com",
    lines,
    lineCount: lines.length,
    estimatedTotal: lines.reduce((total, item) => total + item.extendedCost, 0),
    substitutionsAllowed: false,
    blockers: [],
    warnings,
    proofFee,
    canApprove: true,
    status: warnings.length ? "review" : "ready",
  };
  result.id = createVendorOrderDraftId(GENERATED_AT, vendor, lines);
  return result;
}

export function buildOrderRehearsalModel() {
  const drafts = [
    draft("Bonbright", [
      line({ id: "demo-guinness", name: "Guinness", sku: "DEMO-BB-1", units: 1, unitCost: 185, reason: "Rehearsal par replacement." }),
    ]),
    draft("Heidelberg", [
      line({ id: "demo-blue-moon", name: "Blue Moon", sku: "DEMO-HD-1", units: 1, unitCost: 171, reason: "Rehearsal par replacement." }),
    ]),
    draft("Proof", [
      line({ id: "demo-lime", name: "Finest Call Lime Juice 1L", sku: "DEMO-PR-1", units: 12, cases: 1, packSize: 12, unitCost: 124.56, reason: "Rehearsal cocktail prep replacement." }),
    ], [{ code: "PROOF_DELIVERY_FEE", message: "Below $350. The delivery-fee amount is not configured." }], { threshold: 350, amount: null, configured: false }),
    draft("OHLQ", [
      line({ id: "demo-buffalo-trace", name: "Buffalo Trace Bourbon 750mL", sku: "DEMO-OH-1", units: 12, packSize: 12, unitCost: 30, reason: "Rehearsal 12-unit case replacement." }),
    ]),
  ];
  const savedDrafts = drafts.map((item) => ({
    id: item.id,
    generatedAt: GENERATED_AT,
    vendor: item.vendor,
    createdBy: "Demo Manager",
    createdAt: "rehearsal",
    approvedBy: "Demo Manager",
    approvedAt: "rehearsal",
    status: "reviewed",
  }));
  return {
    rehearsal: true,
    generatedAt: GENERATED_AT,
    sourceDate: SOURCE_DATE,
    schedule: { status: "rehearsal", label: "Rehearsal", blockers: [], warnings: [] },
    weeklyTotal: drafts.reduce((total, item) => total + item.estimatedTotal, 0),
    drafts,
    savedDrafts,
  };
}

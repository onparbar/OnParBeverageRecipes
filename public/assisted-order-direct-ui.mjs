import {
  createAuthoritativeAssistedOrderHandoff,
  formatVendorHandoff,
  getBonbrightTextWindowStatus,
} from "./assisted-order-handoff.mjs";

const VENDOR_ACTIONS = Object.freeze({
  heidelberg: { label: "Build BEES cart", vendor: "heidelberg" },
  proof: { label: "Build Proof cart", vendor: "proof" },
  ohlq: { label: "Build OHLQ cart", vendor: "ohlq" },
});

function statusLabel(order) {
  if (order.rehearsal) return "Rehearsal";
  if (order.preview) return "Blocked";
  if (["reviewed", "opened_vendor"].includes(order.status)) return "Ready";
  if (order.status === "manually_completed") return "Completed";
  return "Needs review";
}

export function buildAssistedOrderView(draft, saved = {}, options = {}) {
  const order = createAuthoritativeAssistedOrderHandoff(draft, saved, options);
  const vendorAction = VENDOR_ACTIONS[order.vendorKey] || null;
  const rehearsal = order.rehearsal === true;
  const rehearsalVendorActionLabel = vendorAction
    ? vendorAction.label.replace(/^Build (.+) cart$/, "Fill $1 rehearsal cart")
    : null;
  const lateOrderWarning = (draft?.warnings || [])
    .find((item) => item?.code === "ORDER_CUTOFF_PASSED")?.message || "";
  let note = "Approve the draft first.";
  if (order.preview) note = "Resolve the draft blockers first.";
  else if (rehearsal) note = "Fills the vendor cart for review only. Nothing is submitted.";
  else if (order.status === "manually_completed") note = "Marked completed.";
  else if (order.actionsEnabled && order.vendorKey === "bonbright") {
    note = getBonbrightTextWindowStatus(options.now).label;
  } else if (order.actionsEnabled) note = "Sign in and verify the list.";

  return {
    order,
    statusLabel: statusLabel(order),
    copyLabel: rehearsal
      ? "Copy rehearsal list"
      : order.vendorKey === "bonbright" ? "Copy TJ message" : "Copy order list",
    copyText: formatVendorHandoff(order),
    vendorActionLabel: rehearsal ? rehearsalVendorActionLabel : vendorAction?.label || null,
    vendorPath: vendorAction && order.actionsEnabled && !rehearsal
      ? `/api/vendor-handoff?vendor=${encodeURIComponent(vendorAction.vendor)}`
      : null,
    lateOrderWarning,
    note,
  };
}

export async function copyAssistedOrderText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

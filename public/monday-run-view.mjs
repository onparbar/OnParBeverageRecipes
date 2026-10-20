import { escapeHtml, formatNumber, toNumber } from "./dashboard-formatters.mjs";
import { formatOperatingWeekLabel } from "./weekly-action-plan.mjs";

export function buildMondayRunModel({
  coolerCountComplete = false,
  mainCoolerCountComplete = coolerCountComplete,
  karaokeCoolerCountComplete = coolerCountComplete,
  coolerCountSaving = false,
  kegCountSaveError = "",
  inventoryMissingCount = 0,
  inventoryCountedThisWeek = false,
  inventorySaving = false,
  inventorySharedInitialized = false,
  inventorySharedSaveError = "",
  mondaySnapshotSaved = false,
  planLocked = false,
  vendorOrders = [],
  weeklyOrderTrackingAvailable = false,
  orderLineCount = 0,
  expectedVendorCount = null,
  orderingBlocked = false,
  now = new Date(),
} = {}) {
  const mainComplete = planLocked || mondaySnapshotSaved
    || (mainCoolerCountComplete && !coolerCountSaving && !kegCountSaveError);
  const coolerComplete = planLocked || mondaySnapshotSaved
    || (mainComplete && karaokeCoolerCountComplete && !coolerCountSaving && !kegCountSaveError);
  const lineCount = Math.max(0, toNumber(orderLineCount));
  const remainingVendors = vendorOrders.filter((vendor) => vendor?.ordered !== true).length;
  const trackingMatches = expectedVendorCount == null || vendorOrders.length === expectedVendorCount;
  // Placed orders stay complete even if live recommendations later change.
  // With no orders, retain the hold guard so missing data is not "none needed".
  const ordersComplete = planLocked && weeklyOrderTrackingAvailable && trackingMatches
    && (lineCount === 0 ? vendorOrders.length === 0 && !orderingBlocked
      : vendorOrders.length > 0 && remainingVendors === 0);
  const deliveryItems = vendorOrders.flatMap((vendor) => vendor?.items || []);
  const deliveryStatus = !ordersComplete ? ""
    : vendorOrders.length === 0 ? "No orders needed"
      : deliveryItems.some((item) => ["partial", "not-received"].includes(item.status)) ? "Delivery issue"
        : vendorOrders.every((vendor) => vendor.items?.length > 0)
          && deliveryItems.every((item) => item.status === "received") ? "Received"
          : "Awaiting delivery";
  const steps = [
    {
      id: "cooler",
      label: "Main Cooler",
      target: "keg-levels",
      complete: mainComplete,
      status: mainComplete ? "Verified" : kegCountSaveError ? "Save needs retry" : coolerCountSaving ? "Saving" : "Verify Main cooler counts",
    },
    {
      id: "karaoke",
      label: "Karaoke Cooler",
      target: "keg-levels",
      complete: coolerComplete,
      status: coolerComplete ? "Verified" : !mainComplete ? "After Main cooler" : kegCountSaveError ? "Save needs retry" : coolerCountSaving ? "Saving" : "Verify Karaoke cooler counts",
    },
    {
      id: "inventory",
      label: "Bottle Inventory",
      target: "inventory",
      complete: planLocked,
      status: planLocked ? "Snapshot saved"
        : inventorySaving ? "Saving snapshot"
          : inventorySharedSaveError ? "Save needs retry"
            : mondaySnapshotSaved ? "Verify to finish saving"
              : !coolerComplete ? "After cooler count"
                : !inventorySharedInitialized ? "Set up inventory"
                  : inventoryCountedThisWeek && inventoryMissingCount === 0 ? "Ready to verify"
                    : inventoryMissingCount > 0 ? `${formatNumber(inventoryMissingCount)} left` : "Verify bottle inventory",
    },
    {
      id: "orders",
      label: "Weekly Plan",
      target: "weekly-plan",
      complete: ordersComplete,
      status: ordersComplete ? lineCount > 0 ? "All placed" : "None needed"
        : !planLocked ? "After bottle inventory"
          : !weeklyOrderTrackingAvailable || !trackingMatches ? "Loading orders"
            : orderingBlocked ? "Review order issues"
              : remainingVendors > 0 ? `${formatNumber(remainingVendors)} left` : "Review orders",
    },
  ];
  const nextIndex = steps.findIndex((step) => !step.complete);
  return {
    steps,
    weekLabel: formatOperatingWeekLabel(now),
    planLocked,
    deliveryStatus,
    completedCount: steps.filter((step) => step.complete).length,
    nextIndex,
    nextStep: steps[nextIndex < 0 ? steps.length - 1 : nextIndex],
    complete: nextIndex < 0,
  };
}

function actionLabel(run) {
  return run.nextIndex === 0 ? "Start Count" : "Continue";
}

function actionButton(run) {
  if (run.complete) return '<button class="primary-button" type="button" data-dashboard-target="weekly-plan">View plan</button>';
  const target = run.nextStep.id === "orders" ? run.nextStep.target : "weekly-order";
  return `<button class="primary-button" type="button" data-monday-run-step="${escapeHtml(run.nextStep.id)}" data-dashboard-target="${escapeHtml(target)}">${actionLabel(run)}</button>`;
}

function weekBadge(run) {
  const label = run.weekLabel || formatOperatingWeekLabel();
  return label ? `<span class="monday-run__week" aria-label="Collecting for ${escapeHtml(label)}">${escapeHtml(label)}</span>` : "";
}

export function renderMondayRun(run) {
  const progress = Math.round(run.completedCount / run.steps.length * 100);
  const number = run.complete ? run.steps.length : run.nextIndex + 1;
  return `
    <section class="monday-run" aria-labelledby="monday-run-title">
      <header class="monday-run__header">
        <div><h2 id="monday-run-title">Weekly Run</h2><span>${run.complete ? "Complete" : `Step ${number} of ${run.steps.length}`}</span></div>
        <div class="monday-run__header-actions">${weekBadge(run)}${run.complete ? "" : actionButton(run)}</div>
      </header>
      <div class="monday-run__progress" role="progressbar" aria-label="Weekly Run progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="--monday-run-progress: ${progress}%"></span></div>
      ${run.complete ? "" : `<details class="monday-run__details monday-run__focus" id="monday-run-steps">
        <summary><span>${number}</span><span><small>${run.complete ? "Completed" : "Current step"}</small>${run.complete ? "" : `<strong>${escapeHtml(run.nextStep.label)}</strong><b>${escapeHtml(run.nextStep.status)}</b>`}</span><span class="monday-run__chevron" aria-hidden="true">&#8250;</span></summary>
        <ol class="monday-run__steps">${run.steps.map((step, index) => `
          <li class="monday-run__step${step.complete ? " monday-run__step--done" : index === run.nextIndex ? " monday-run__step--current" : ""}">
            <button type="button" data-monday-run-step="${escapeHtml(step.id)}" data-dashboard-target="${escapeHtml(step.id === "orders" ? step.target : "weekly-order")}"${index === run.nextIndex ? ' aria-current="step"' : ""}>
              <span>${index + 1}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.complete ? "Done" : step.status)}</small>
            </button>
          </li>`).join("")}</ol>
      </details>`}
    </section>`;
}

export function renderMondayRunCompact(run) {
  const navigationLabel = run.planLocked ? "Open this week's order" : "Weekly Order — Start here";
  return `
    <section class="monday-run monday-run--compact${run.complete ? " is-complete" : ""}" aria-label="Weekly Order">
      <button class="monday-run__card-link" type="button" data-dashboard-target="weekly-order" aria-label="${escapeHtml(navigationLabel)}"></button>
      <header class="monday-run__header"><div class="monday-run__summary"><div class="monday-run__title-week"><h2>${run.planLocked ? "Weekly Order" : "WEEKLY ORDER — START HERE"}</h2>${weekBadge(run)}</div><p class="monday-run__order-status">${escapeHtml(run.planLocked ? run.deliveryStatus || "Your weekly plan is saved" : "Check five areas. Then review your weekly plan.")}</p></div>
        <div class="monday-run__header-actions monday-run__start-action"><button class="primary-button" type="button" data-dashboard-target="weekly-order">${run.planLocked ? "Open weekly order" : "Start here"}</button></div>
      </header>
    </section>`;
}

import { escapeHtml, formatNumber, toNumber } from "./dashboard-formatters.mjs";
import { formatOperatingWeekLabel } from "./weekly-action-plan.mjs";

export function buildMondayRunModel({
  coolerCountComplete = false,
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
  const coolerComplete = planLocked || mondaySnapshotSaved
    || (coolerCountComplete && !coolerCountSaving && !kegCountSaveError);
  const lineCount = Math.max(0, toNumber(orderLineCount));
  const remainingVendors = vendorOrders.filter((vendor) => vendor?.ordered !== true).length;
  const trackingMatches = expectedVendorCount == null || vendorOrders.length === expectedVendorCount;
  // Placed orders stay complete even if live recommendations later change.
  // With no orders, retain the hold guard so missing data is not "none needed".
  const ordersComplete = planLocked && weeklyOrderTrackingAvailable && trackingMatches
    && (lineCount === 0 ? vendorOrders.length === 0 && !orderingBlocked
      : vendorOrders.length > 0 && remainingVendors === 0);
  const steps = [
    {
      id: "cooler",
      label: "Cooler Count",
      target: "keg-levels",
      complete: coolerComplete,
      status: coolerComplete ? "Done" : kegCountSaveError ? "Save needs retry" : coolerCountSaving ? "Saving" : "Count coolers",
    },
    {
      id: "inventory",
      label: "Inventory",
      target: "inventory",
      complete: planLocked,
      status: planLocked ? "Snapshot saved"
        : inventorySaving ? "Saving snapshot"
          : inventorySharedSaveError ? "Save needs retry"
            : mondaySnapshotSaved ? "Submit to finish saving"
              : !coolerComplete ? "After cooler count"
                : !inventorySharedInitialized ? "Set up inventory"
                  : inventoryCountedThisWeek && inventoryMissingCount === 0 ? "Ready to submit"
                    : inventoryMissingCount > 0 ? `${formatNumber(inventoryMissingCount)} left` : "Count inventory",
    },
    {
      id: "orders",
      label: "Order",
      target: "weekly-plan",
      complete: ordersComplete,
      status: ordersComplete ? lineCount > 0 ? "All placed" : "None needed"
        : !planLocked ? "After inventory submit"
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
    completedCount: steps.filter((step) => step.complete).length,
    nextIndex,
    nextStep: steps[nextIndex < 0 ? steps.length - 1 : nextIndex],
    complete: nextIndex < 0,
  };
}

function actionLabel(run) {
  return run.nextIndex === 0 ? "Start" : "Continue";
}

function actionButton(run) {
  if (run.complete) return '<button class="primary-button" type="button" data-dashboard-target="weekly-plan">View plan</button>';
  return `<button class="primary-button" type="button" data-monday-run-step="${escapeHtml(run.nextStep.id)}" data-dashboard-target="${escapeHtml(run.nextStep.target)}">${actionLabel(run)}</button>`;
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
            <button type="button" data-monday-run-step="${escapeHtml(step.id)}" data-dashboard-target="${escapeHtml(step.target)}"${index === run.nextIndex ? ' aria-current="step"' : ""}>
              <span>${index + 1}</span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.complete ? "Done" : step.status)}</small>
            </button>
          </li>`).join("")}</ol>
      </details>`}
    </section>`;
}

export function renderMondayRunCompact(run) {
  const progress = Math.round(run.completedCount / run.steps.length * 100);
  const target = run.complete ? "weekly-plan" : run.nextStep.target;
  const navigationLabel = run.complete ? "View weekly plan" : `Open weekly plan: ${run.nextStep.label}`;
  return `
    <section class="monday-run monday-run--compact${run.complete ? " is-complete" : ""}" aria-label="Weekly Plan">
      <button class="monday-run__card-link" type="button" data-dashboard-target="${escapeHtml(target)}"${run.complete ? "" : ` data-monday-run-step="${escapeHtml(run.nextStep.id)}"`} aria-label="${escapeHtml(navigationLabel)}"></button>
      <header class="monday-run__header"><div><div class="monday-run__title-week"><h2>Weekly Plan</h2>${weekBadge(run)}</div><span>${run.complete ? "Complete" : `Step ${run.nextIndex + 1} of ${run.steps.length}`}</span></div>${!run.complete && run.nextIndex === 0 ? `<div class="monday-run__header-actions monday-run__start-action">${actionButton(run)}</div>` : ""}</header>
      ${run.complete ? "" : `<p class="monday-run__current-step"><span>Next:</span> <strong>${escapeHtml(run.nextStep.label)}</strong></p>`}
      <div class="monday-run__progress" role="progressbar" aria-label="Weekly Plan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="--monday-run-progress: ${progress}%"></span></div>
    </section>`;
}

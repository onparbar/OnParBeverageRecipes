import { escapeHtml, formatNumber, toNumber } from "./dashboard-formatters.mjs";

export function buildMondayRunModel({
  kegFeed = {},
  pricingFeed = {},
  inventoryMissingCount = 0,
  inventorySaving = false,
  inventorySharedInitialized = false,
  inventorySharedSaveError = "",
  mondaySnapshotSaved = false,
  planLocked = false,
  weeklyUsageCaptured = false,
  pmbRefreshPending = false,
  vendorOrders = [],
  weeklyOrderTrackingAvailable = false,
  orderLineCount = 0,
  tapSheets = [],
  planActionable = false,
} = {}) {
  const lockedPlanCapturedSetup = planLocked;
  const pmbFeedsReady = kegFeed.status === "online" && pricingFeed.status === "online";
  const outstandingVendorCount = vendorOrders.filter((vendor) => vendor?.ordered !== true).length;
  const normalizedOrderLineCount = toNumber(orderLineCount);
  const ordersPlaced = planLocked && (
    normalizedOrderLineCount <= 0
    || (weeklyOrderTrackingAvailable && vendorOrders.length > 0 && outstandingVendorCount === 0)
  );
  const tapSheetsToPrint = tapSheets.filter((sheet) => !sheet.isCurrent).length;
  const steps = [
    {
      id: "pmb",
      label: "Refresh PMB & capture usage",
      target: "dashboard",
      complete: lockedPlanCapturedSetup || (pmbFeedsReady && weeklyUsageCaptured),
      status: pmbRefreshPending
        ? "Refreshing"
        : !pmbFeedsReady
          ? "Refresh PMB"
          : weeklyUsageCaptured
            ? "Ready"
            : "Capture usage",
    },
    {
      id: "inventory",
      label: "Count inventory",
      target: "inventory",
      complete: lockedPlanCapturedSetup || (
        inventorySharedInitialized
        && inventoryMissingCount === 0
        && !inventorySaving
        && !inventorySharedSaveError
      ),
      status: inventorySaving
        ? "Saving"
        : inventorySharedSaveError
          ? "Retry needed"
        : inventoryMissingCount > 0
          ? `${formatNumber(inventoryMissingCount)} left`
          : inventorySharedInitialized
            ? "Counted"
            : "Set up",
    },
    {
      id: "plan",
      label: "Save & lock plan",
      target: "weekly-plan",
      complete: planLocked,
      status: planLocked ? "Locked" : mondaySnapshotSaved ? "Snapshot saved" : planActionable ? "Ready" : "Waiting",
    },
    {
      id: "orders",
      label: "Place orders",
      target: "weekly-plan",
      complete: ordersPlaced,
      status: ordersPlaced
        ? normalizedOrderLineCount > 0 ? "Placed" : "None needed"
        : !planLocked
          ? "After plan"
          : weeklyOrderTrackingAvailable && outstandingVendorCount > 0
            ? `${formatNumber(outstandingVendorCount)} left`
            : "Review",
    },
    {
      id: "print",
      label: "Print tap sheets",
      target: "print",
      complete: tapSheets.length > 0 && tapSheetsToPrint === 0,
      status: tapSheetsToPrint > 0 ? `${formatNumber(tapSheetsToPrint)} left` : tapSheets.length ? "Current" : "Review",
    },
  ];
  const completedCount = steps.filter((step) => step.complete).length;
  const nextIndex = steps.findIndex((step) => !step.complete);
  return {
    steps,
    completedCount,
    nextIndex,
    nextStep: steps[nextIndex < 0 ? 0 : nextIndex],
    complete: nextIndex < 0,
  };
}

export function renderMondayRun(run) {
  const progress = run.steps.length ? Math.round((run.completedCount / run.steps.length) * 100) : 0;
  const currentStepNumber = run.complete ? run.steps.length : run.nextIndex + 1;
  const continueStepId = run.complete ? "review" : run.nextStep.id;
  const continueTarget = run.complete ? "weekly-plan" : run.nextStep.target;
  const focusStep = run.complete
    ? { id: "review", label: "Review this week", status: "Complete", target: "weekly-plan" }
    : run.nextStep;
  const focusNumber = currentStepNumber;
  return `
    <section class="monday-run" aria-labelledby="monday-run-title">
      <header class="monday-run__header">
        <div><h2 id="monday-run-title">Monday Run</h2><span>Step ${formatNumber(currentStepNumber)} of ${formatNumber(run.steps.length)}</span></div>
        <button class="${run.complete ? "ghost-button" : "primary-button"}" type="button" data-monday-run-step="${escapeHtml(continueStepId)}" data-dashboard-target="${escapeHtml(continueTarget)}">${run.complete ? "Review" : "Continue"}</button>
      </header>
      <div class="monday-run__progress" role="progressbar" aria-label="Monday Run progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="--monday-run-progress: ${progress}%"></span></div>
      <article class="monday-run__focus${run.complete ? " is-complete" : ""}">
        <button type="button" data-monday-run-step="${escapeHtml(focusStep.id)}" data-dashboard-target="${escapeHtml(focusStep.target)}"${run.complete ? "" : ' aria-current="step"'}>
          <span>${formatNumber(focusNumber)}</span>
          <span><small>${run.complete ? "Completed" : currentStepNumber === run.steps.length ? "Final step" : "Current step"}</small><strong>${escapeHtml(focusStep.label)}</strong></span>
          <b>${escapeHtml(run.complete ? "Done" : focusStep.status)}</b>
        </button>
      </article>
      <details class="monday-run__details">
        <summary>View all ${formatNumber(run.steps.length)} steps</summary>
        <ol class="monday-run__steps">
          ${run.steps.map((step, index) => `
            <li class="monday-run__step${step.complete ? " monday-run__step--done" : index === run.nextIndex ? " monday-run__step--current" : ""}">
              <button type="button" data-monday-run-step="${escapeHtml(step.id)}" data-dashboard-target="${escapeHtml(step.target)}"${index === run.nextIndex ? ' aria-current="step"' : ""}>
                <span>${formatNumber(index + 1)}</span>
                <strong>${escapeHtml(step.label)}</strong>
                <small>${escapeHtml(step.complete ? "Done" : step.status)}</small>
              </button>
            </li>
          `).join("")}
        </ol>
      </details>
    </section>
  `;
}

export function renderMondayRunCompact(run) {
  const progress = run.steps.length ? Math.round((run.completedCount / run.steps.length) * 100) : 0;
  const currentStepNumber = run.complete ? run.steps.length : run.nextIndex + 1;
  return `
    <section class="monday-run monday-run--compact${run.complete ? " is-complete" : ""}" aria-label="Weekly Plan">
      <header class="monday-run__header">
        <div><h2>Weekly Plan</h2><span>${run.complete ? "Complete" : `Step ${formatNumber(currentStepNumber)} of ${formatNumber(run.steps.length)}`}</span></div>
        ${run.complete ? "" : `<button class="primary-button" type="button" data-monday-run-step="${escapeHtml(run.nextStep.id)}" data-dashboard-target="${escapeHtml(run.nextStep.target)}">Continue</button>`}
      </header>
      ${run.complete ? "" : `<p class="monday-run__current-step"><span>Next:</span> <strong>${escapeHtml(run.nextStep.label)}</strong></p>`}
      <div class="monday-run__progress" role="progressbar" aria-label="Weekly Plan progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="--monday-run-progress: ${progress}%"></span></div>
    </section>
  `;
}

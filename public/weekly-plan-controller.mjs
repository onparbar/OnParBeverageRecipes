export const WEEKLY_PLAN_REHEARSAL_MESSAGES = Object.freeze({
  active: "Rehearsal uses the latest locked Weekly Plan and never submits orders.",
  inactive: "Live Weekly Plan restored.",
});

export function getWeeklyPlanRehearsalMessage(active) {
  return active
    ? WEEKLY_PLAN_REHEARSAL_MESSAGES.active
    : WEEKLY_PLAN_REHEARSAL_MESSAGES.inactive;
}

function bindClick(documentRef, selector, handler) {
  if (typeof handler !== "function") return;
  documentRef.querySelector(selector)?.addEventListener("click", handler);
}

export function bindWeeklyPlanController({
  root,
  documentRef = globalThis.document,
  clean = (value) => String(value ?? "").trim(),
  runWeeklyPlanUpdate,
  recallCurrentWeeklyPlan,
  saveWeeklyPlanFinishWeek,
  openMondayRunStep,
  bindOrderTrackingEvents,
  getOutsideMondayReason,
  setOutsideMondayReason,
  getOrderRehearsalMode,
  setOrderRehearsalMode,
  setWeeklyOrderTrackingMessage,
  setFinishWeekActor,
  renderWeeklyPlan,
} = {}) {
  if (!root || typeof documentRef?.querySelector !== "function") return false;

  bindClick(documentRef, "#run-weekly-plan-agent", runWeeklyPlanUpdate);
  bindClick(documentRef, "#recall-weekly-plan", recallCurrentWeeklyPlan);
  bindClick(documentRef, "#weekly-plan-finish-save", saveWeeklyPlanFinishWeek);

  documentRef.querySelector("#weekly-plan-finish-actor")?.addEventListener("input", (event) => {
    setFinishWeekActor?.(event.currentTarget.value);
  });

  root.querySelectorAll("[data-monday-run-step]").forEach((button) => {
    button.addEventListener("click", () => {
      openMondayRunStep?.(button.dataset.mondayRunStep, button.dataset.dashboardTarget);
    });
  });

  documentRef.querySelector("#weekly-plan-late-reason")?.addEventListener("input", (event) => {
    setOutsideMondayReason?.(event.currentTarget.value);
    const currentReason = typeof getOutsideMondayReason === "function"
      ? getOutsideMondayReason()
      : event.currentTarget.value;
    const saveButton = documentRef.querySelector("#run-weekly-plan-agent");
    if (saveButton) saveButton.disabled = !clean(currentReason);
  });

  documentRef.querySelector("#toggle-order-rehearsal")?.addEventListener("click", () => {
    const active = !Boolean(getOrderRehearsalMode?.());
    setOrderRehearsalMode?.(active);
    setWeeklyOrderTrackingMessage?.(getWeeklyPlanRehearsalMessage(active));
    renderWeeklyPlan?.();
  });

  bindOrderTrackingEvents?.();
  return true;
}

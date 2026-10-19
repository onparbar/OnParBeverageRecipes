import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";
import { WEEKLY_ORDER_STEPS, renderWeeklyOrderView } from "./weekly-order-view.mjs";
import { isKorbelBrut } from "./weekly-order-data.mjs";

const STORAGE_KEY = "onpar-weekly-order-wizard-v1";
const STEP_IDS = WEEKLY_ORDER_STEPS.map(({ id }) => id);
const SCREENS = new Set(["landing", ...STEP_IDS, "review"]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => String(value ?? "").trim();

export function isValidWeeklyOrderCount(value, allowsDecimal = false) {
  const draft = text(value);
  if (!draft || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(draft)) return false;
  const number = Number(draft);
  return Number.isFinite(number) && number >= 0 && (allowsDecimal || Number.isInteger(number));
}

export function createWeeklyOrderController({
  root,
  getContext = () => ({ ready: false }),
  getRows = () => [],
  saveStep,
  savePlan,
  openPlan = () => {},
  exit = () => {},
  storage = globalThis.localStorage,
  now = () => new Date(),
} = {}) {
  let busy = false;
  let generation = 0;
  let destroyed = false;
  let state = freshState();

  function freshState() {
    return { updatedAt: new Date(now()).toISOString(), screen: "landing", lastScreen: "", completed: [], drafts: {}, reason: "", error: "" };
  }

  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (saved?.version === 1 && isRecommendationForOperatingWeek(saved.updatedAt, now())) {
      state = {
        ...state,
        updatedAt: saved.updatedAt,
        lastScreen: SCREENS.has(saved.lastScreen) ? saved.lastScreen : "",
        completed: STEP_IDS.filter((id) => saved.completed?.includes(id)),
        drafts: Object.fromEntries(STEP_IDS.filter((id) => Array.isArray(saved.drafts?.[id]))
          .map((id) => [id, saved.drafts[id].filter((row) => row && typeof row.id === "string")
            .map((row) => ({ ...row, value: String(row.value ?? "") }))])),
        reason: typeof saved.reason === "string" ? saved.reason : "",
      };
      // Completion without the verified row snapshot cannot be safely resumed.
      state.completed = state.completed.filter((id) => Object.hasOwn(state.drafts, id));
      // Preserve counts already entered before Korbel got its own physical stop.
      // The new stop still needs a person to verify it in the patio cooler.
      const moved = [];
      for (const id of ["liquor", "mixers", "other"]) {
        if (!state.drafts[id]) continue;
        moved.push(...state.drafts[id].filter(isKorbelBrut));
        state.drafts[id] = state.drafts[id].filter((row) => !isKorbelBrut(row));
      }
      if (moved.length) {
        const patio = state.drafts.patio || [];
        state.drafts.patio = [...patio, ...moved.filter((row) => !patio.some((savedRow) => savedRow.id === row.id))];
        state.completed = state.completed.filter((id) => id !== "patio");
        if (["main", "karaoke"].every((id) => state.completed.includes(id))) state.lastScreen = "patio";
      }
    }
  } catch { /* Browser progress is optional; shared count saves remain authoritative. */ }

  function checkWeek() {
    if (isRecommendationForOperatingWeek(state.updatedAt, now())) return false;
    generation += 1;
    state = freshState();
    return true;
  }

  function persist() {
    // Test the old timestamp before updating it, including when a tab stayed open overnight.
    if (checkWeek()) return false;
    state.updatedAt = new Date(now()).toISOString();
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state, error: "" })); } catch { /* Keep this session usable when storage is unavailable. */ }
    return true;
  }

  function context() {
    const current = getContext() || {};
    return { ...current, ready: current.ready === true, planLocked: current.planLocked === true };
  }

  function seedRows(current = context()) {
    if (!current.ready || current.planLocked || !STEP_IDS.includes(state.screen)
      || Object.hasOwn(state.drafts, state.screen)) return false;
    state.drafts[state.screen] = copy(getRows(state.screen) || [])
      .map((row) => ({ ...row, value: String(row.value ?? "") }));
    persist();
    return true;
  }

  function model(current = context()) {
    return {
      ...current,
      screen: state.screen,
      rows: state.drafts[state.screen] || [],
      completed: state.completed,
      busy,
      error: state.error,
      reason: state.reason,
      progressAvailable: Boolean(state.lastScreen || Object.keys(state.drafts).length || state.completed.length),
    };
  }

  function focusTitle() {
    const title = root?.querySelector?.(".weekly-order-title");
    title?.focus?.({ preventScroll: true });
    title?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  function render({ focus = false } = {}) {
    if (destroyed) return;
    checkWeek();
    const current = context();
    seedRows(current);
    if (root) root.innerHTML = renderWeeklyOrderView(model(current));
    updateControls(current);
    if (focus) focusTitle();
  }

  function inputs() {
    return [...(root?.querySelectorAll?.("[data-weekly-order-count]") || [])];
  }

  function updateControls(current = context()) {
    if (!root || destroyed) return;
    root.setAttribute?.("aria-busy", String(busy));
    root.querySelector?.(".weekly-order")?.setAttribute?.("aria-busy", String(busy));
    for (const input of inputs()) {
      input.disabled = busy;
      // A background lock must prevent edits without blurring the focused field.
      input.readOnly = current.planLocked;
    }
    const reason = root.querySelector?.("[data-weekly-order-reason]");
    if (reason) {
      reason.disabled = busy;
      reason.readOnly = current.planLocked;
      reason.required = Boolean(current.needsReason);
    }
    const reasonField = root.querySelector?.("[data-weekly-order-reason-field]");
    if (reasonField) reasonField.hidden = !current.needsReason;
    root.querySelectorAll?.("[data-weekly-order-action]").forEach((button) => {
      const action = button.dataset.weeklyOrderAction;
      button.disabled = busy
        || (["next", "save"].includes(action) && (!current.ready || current.planLocked))
        || (action === "save" && state.completed.length !== STEP_IDS.length);
      if (action === "plan") button.hidden = !current.planLocked;
      if (["next", "save"].includes(action)) button.hidden = current.planLocked;
    });
    root.querySelectorAll?.("[data-weekly-order-step]").forEach((button) => { button.disabled = busy || current.planLocked; });
    const status = root.querySelector?.("[data-weekly-order-status]");
    if (status) {
      const message = state.error || (busy ? state.screen === "review" ? "Saving your weekly order…" : "Saving your count…"
        : current.planLocked && state.screen !== "landing" ? "This week's order is saved. Open your weekly plan to continue."
          : !current.ready && !current.planLocked ? "Loading saved counts…" : "");
      status.textContent = message;
      status.hidden = !message;
      status.setAttribute?.("role", state.error ? "alert" : "status");
      status.classList?.toggle("is-error", Boolean(state.error));
    }
  }

  function refresh() {
    if (destroyed) return;
    if (checkWeek()) { render(); return; }
    const current = context();
    if (seedRows(current) || state.screen === "landing") render();
    else updateControls(current);
  }

  function navigate(screen) {
    state.screen = screen;
    if (screen !== "landing") state.lastScreen = screen;
    state.error = "";
    seedRows();
    persist();
    render({ focus: true });
  }

  function editCount(id, value) {
    if (destroyed || busy) return false;
    if (checkWeek()) { render(); return false; }
    if (context().planLocked) { updateControls(); return false; }
    const row = state.drafts[state.screen]?.find((entry) => entry.id === id);
    if (!row) return false;
    row.value = String(value ?? "");
    state.completed = state.completed.filter((step) => step !== state.screen);
    state.error = "";
    persist();
    updateControls();
    return true;
  }

  function setReason(value) {
    if (destroyed || busy) return false;
    if (checkWeek()) { render(); return false; }
    if (context().planLocked) return false;
    state.reason = String(value ?? "");
    state.error = "";
    persist();
    updateControls();
    return true;
  }

  function showError(message, invalidId) {
    state.error = message;
    updateControls();
    if (invalidId != null) {
      const input = inputs().find((entry) => entry.dataset.weeklyOrderCount === invalidId);
      input?.setAttribute?.("aria-invalid", "true");
      input?.focus?.();
      input?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
    return false;
  }

  function stillCurrent(startedAt, startedGeneration) {
    if (startedGeneration === generation && isRecommendationForOperatingWeek(startedAt, now())) return true;
    checkWeek();
    return false;
  }

  function reconcileChangedRows(stepId, latestRows) {
    const previous = new Map((state.drafts[stepId] || []).map((row) => [row.id, row]));
    state.drafts[stepId] = copy(latestRows).map((row) => {
      const old = previous.get(row.id);
      const sameIdentity = old && text(old.identity ?? old.name) === text(row.identity ?? row.name);
      const changed = !sameIdentity || text(old.expectedValue) !== text(row.expectedValue);
      return {
        ...row,
        value: sameIdentity ? old.value : "",
        conflict: changed,
        detail: `${row.detail || ""}${changed ? ` Saved count is now ${text(row.value) || "0"}. Check your number again.` : ""}`.trim(),
      };
    });
    state.completed = state.completed.filter((id) => id !== stepId);
    persist();
  }

  async function verifyStep() {
    const current = context();
    if (!current.ready) return showError("Wait for the saved counts to load, then choose Next.");
    if (current.planLocked || !STEP_IDS.includes(state.screen)) return false;
    seedRows(current);
    const stepId = state.screen;
    const rows = state.drafts[stepId] || [];
    const invalid = rows.find((row) => !isValidWeeklyOrderCount(row.value, row.allowsDecimal));
    if (invalid) return showError(`Enter ${invalid.allowsDecimal ? "a number" : "a whole number"} of 0 or more for ${invalid.name}. Use 0 if there are none.`, invalid.id);
    if (typeof saveStep !== "function") return showError("Counts cannot be saved yet. Please try again.");
    const submitted = copy(rows).map((row) => ({ ...row, value: String(Number(text(row.value))) }));
    const startedAt = new Date(now()).toISOString();
    const startedGeneration = generation;
    busy = true;
    state.error = "";
    updateControls(current);
    let success = false;
    let changedRows = false;
    try {
      await saveStep(stepId, submitted);
      if (!stillCurrent(startedAt, startedGeneration) || context().planLocked) return false;
      state.drafts[stepId] = submitted.map((row) => ({ ...row, expectedValue: row.value, conflict: false }));
      state.completed = STEP_IDS.filter((id) => id === stepId || state.completed.includes(id));
      state.screen = STEP_IDS[STEP_IDS.indexOf(stepId) + 1] || "review";
      state.lastScreen = state.screen;
      persist();
      success = true;
      return true;
    } catch (error) {
      if (!stillCurrent(startedAt, startedGeneration)) return false;
      if (error?.code === "WEEKLY_ORDER_COUNTS_CHANGED" && Array.isArray(error.latestRows)) {
        reconcileChangedRows(stepId, error.latestRows);
        changedRows = true;
      }
      state.error = error?.message || "Your count could not be saved. Your numbers are still here. Choose Next to try again.";
      return false;
    } finally {
      busy = false;
      if (success || changedRows || startedGeneration !== generation) render({ focus: success });
      else updateControls();
    }
  }

  async function finish() {
    const current = context();
    if (current.planLocked) { openPlan(); return false; }
    if (!current.ready) return showError("Wait for the saved counts to load, then save your weekly order.");
    if (state.screen !== "review" || STEP_IDS.some((id) => !state.completed.includes(id))) {
      return showError("Verify every location before saving your weekly order.");
    }
    if (current.needsReason && !text(state.reason)) {
      showError("Enter why you are saving after Monday.");
      root?.querySelector?.("[data-weekly-order-reason]")?.focus?.();
      return false;
    }
    if (typeof savePlan !== "function") return showError("Your weekly order cannot be saved yet. Please try again.");
    const startedAt = new Date(now()).toISOString();
    const startedGeneration = generation;
    busy = true;
    state.error = "";
    updateControls(current);
    let success = false;
    try {
      await savePlan(text(state.reason));
      if (!stillCurrent(startedAt, startedGeneration)) return false;
      state.screen = "landing";
      state.lastScreen = "review";
      persist();
      success = true;
      openPlan();
      return true;
    } catch (error) {
      if (!stillCurrent(startedAt, startedGeneration)) return false;
      state.error = error?.message || "Your weekly order could not be saved. Your counts are kept. Try saving again.";
      return false;
    } finally {
      busy = false;
      if (success || startedGeneration !== generation) render();
      else updateControls();
    }
  }

  async function act(action, stepId) {
    if (destroyed || busy) return false;
    if (checkWeek()) { render(); return false; }
    if (action === "exit") { exit(); return true; }
    if (context().planLocked) { openPlan(); return true; }
    if (action === "start") navigate(STEP_IDS[0]);
    else if (action === "resume") {
      const firstMissing = STEP_IDS.find((id) => !state.completed.includes(id)) || "review";
      navigate(state.lastScreen && state.lastScreen !== "landing" ? state.lastScreen : firstMissing);
    } else if (action === "back") {
      navigate(state.screen === "review" ? STEP_IDS.at(-1) : STEP_IDS[STEP_IDS.indexOf(state.screen) - 1] || "landing");
    } else if (action === "step") {
      if (!STEP_IDS.includes(stepId)) return false;
      const firstMissing = STEP_IDS.findIndex((id) => !state.completed.includes(id));
      if (firstMissing >= 0 && STEP_IDS.indexOf(stepId) > firstMissing) return false;
      navigate(stepId);
    } else if (action === "next") return verifyStep();
    else if (action === "save") return finish();
    else return false;
    return true;
  }

  function onClick(event) {
    const button = event.target?.closest?.("[data-weekly-order-action], [data-weekly-order-step]");
    if (!button || button.disabled || (root?.contains && !root.contains(button))) return;
    event.preventDefault?.();
    void act(button.dataset.weeklyOrderAction || "step", button.dataset.weeklyOrderStep);
  }

  function onInput(event) {
    const input = event.target;
    if (input?.dataset?.weeklyOrderCount != null) {
      if (editCount(input.dataset.weeklyOrderCount, input.value)) input.removeAttribute?.("aria-invalid");
    } else if (input?.hasAttribute?.("data-weekly-order-reason")) setReason(input.value);
  }

  root?.addEventListener?.("click", onClick);
  root?.addEventListener?.("input", onInput);

  return {
    open() { if (busy || destroyed) return; checkWeek(); state.screen = "landing"; render({ focus: true }); },
    refresh,
    getState() { checkWeek(); return copy({ ...state, busy }); },
    act,
    editCount,
    setReason,
    destroy() {
      destroyed = true;
      root?.removeEventListener?.("click", onClick);
      root?.removeEventListener?.("input", onInput);
    },
  };
}

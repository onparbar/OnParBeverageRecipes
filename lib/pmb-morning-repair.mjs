import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const PMB_REPAIR_TIME_ZONE = "America/New_York";
const clock = new Intl.DateTimeFormat("en-CA", {
  timeZone: PMB_REPAIR_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const schedulerKey = Symbol.for("onpar.pmb-morning-repair.scheduler");
const repairSlots = [
  { id: "monday-reset", hour: 7, scheduledTime: "07:00", verificationUntil: "07:50", weekday: 1 },
  { id: "daily", hour: 10, scheduledTime: "10:00", verificationUntil: "10:50" },
];

function slotsForDate(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return repairSlots.filter((slot) => slot.weekday === undefined || slot.weekday === weekday);
}

function currentRepairSlot(now) {
  const time = getPmbRepairClock(now);
  return slotsForDate(time.date).find((slot) => time.hour === slot.hour && time.minute === 0);
}

function claimFilename(date, slot) {
  // Preserve existing daily claims across upgrades and rollbacks.
  return slot.id === "daily" ? `${date}.json` : `${date}-${slot.id}.json`;
}

export function getPmbRepairClock(now = new Date()) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function isPmbMorningRepairEnabled(env = process.env) {
  return env.NODE_ENV === "production"
    && env.ONPAR_DEPLOYMENT_TARGET === "on-site"
    && env.ONPAR_PMB_REPAIR_SCHEDULER === "1"
    && String(env.PMB_MORNING_REPAIR_ENABLED || "").trim().toLowerCase() !== "false"
    && env.NEXT_PHASE !== "phase-production-build"
    && !env.VERCEL;
}

export function isPmbRepairWindow(now = new Date()) {
  return Boolean(currentRepairSlot(now));
}

function defaultStateDirectory() {
  // Production releases symlink data to the persistent service directory.
  return path.join(process.cwd(), "data", "pmb-morning-repair");
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readPmbMorningRepairStatus({ env = process.env, now = new Date(), stateDirectory = defaultStateDirectory() } = {}) {
  const time = getPmbRepairClock(now);
  const base = {
    enabled: isPmbMorningRepairEnabled(env),
    timeZone: PMB_REPAIR_TIME_ZONE,
    scheduledTime: "10:00",
    schedules: repairSlots.map((slot) => ({ ...slot })),
    today: time.date,
    windowOpen: isPmbRepairWindow(now),
  };
  try {
    const slots = slotsForDate(time.date);
    const runs = await Promise.all(slots.map(async (slot) => ({
      slot, run: await readJson(path.join(stateDirectory, claimFilename(time.date, slot))),
    })));
    const todayRuns = runs.map(({ run }) => run).filter(Boolean)
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    let lastRun = todayRuns[0] || await readJson(path.join(stateDirectory, "latest.json"));
    const lastSlot = repairSlots.find((slot) => slot.id === lastRun?.slotId) || repairSlots[1];
    if (["claimed", "repair-sent", "verifying"].includes(lastRun?.status)
      && (lastRun.date !== time.date || time.hour > lastSlot.hour || (time.hour === lastSlot.hour && time.minute >= 50))) {
      lastRun = {
        ...lastRun, status: "unverified",
        message: "The scheduled attempt ended without a confirmed result. Its claim is retained; this scheduled run will not be repeated.",
      };
    }
    const missedSlots = base.enabled ? runs.filter(({ slot, run }) => !run
      && (time.hour > slot.hour || (time.hour === slot.hour && time.minute > 0)))
      .map(({ slot }) => slot.scheduledTime) : [];
    return { ...base, lastRun, todayRuns, missedSlots, missedToday: missedSlots.length > 0 };
  } catch {
    return { ...base, lastRun: null, statusError: "Morning repair status could not be read. No automatic retry is permitted for an existing scheduled-run claim." };
  }
}

function validCapture(value, sentAt, now) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && time >= Date.parse(sentAt) && time <= now.getTime() + 60_000;
}

export function summarizePmbRepairRefresh({ levels = {}, pricing = {} } = {}, { sentAt, now = new Date() } = {}) {
  const expected = Number.isSafeInteger(levels.expectedCount) && levels.expectedCount > 0 ? levels.expectedCount : 0;
  const items = Array.isArray(levels.items) ? levels.items : [];
  const liveItems = items.filter((item) => item.levelAvailable === true
    && item.fillLevelPercent !== null && item.fillLevelPercent !== ""
    && Number.isFinite(Number(item.fillLevelPercent))
    && Number(item.fillLevelPercent) >= 0 && Number(item.fillLevelPercent) <= 100);
  const captured = new Set(liveItems.map((item) => Number(item.tapNumber)).filter((tap) => Number.isSafeInteger(tap) && tap > 0)).size;
  const levelsFresh = !levels.error && levels.stale === false && validCapture(levels.updatedAt, sentAt, now);
  const levelsComplete = levelsFresh && !levels.partial && !levels.degraded
    && expected > 0 && captured === expected && items.length === expected && levels.capturedCount === expected;
  const pricingFresh = !pricing.error && !pricing.stale && !pricing.degraded
    && Array.isArray(pricing.items) && pricing.items.length > 0 && validCapture(pricing.updatedAt, sentAt, now);
  return {
    verified: levelsComplete && pricingFresh,
    levelsFresh, levelsComplete, pricingFresh,
    expectedCount: expected,
    capturedCount: levelsFresh ? captured : 0,
    missingTaps: [...new Set((Array.isArray(levels.unreachableTaps) ? levels.unreachableTaps : [])
      .map((item) => Number(item.tapNumber)).filter((tap) => Number.isSafeInteger(tap) && tap > 0))].sort((a, b) => a - b),
    levelBackupSaved: levels.sharedSnapshotSaved === true,
    pricingBackupSaved: pricing.pmbBackupSaved === true,
  };
}

export function createPmbMorningRepairRunner({
  env = process.env,
  now = () => new Date(),
  stateDirectory = defaultStateDirectory(),
  repair,
  refresh,
  wait = delay,
  recordActivity = async () => {},
} = {}) {
  const running = new Set();
  return async function runScheduledRepair() {
    const started = now();
    const slot = currentRepairSlot(started);
    if (!isPmbMorningRepairEnabled(env) || !slot) return { skipped: true };
    const date = getPmbRepairClock(started).date;
    const runKey = `${date}:${slot.id}`;
    if (running.has(runKey)) return { skipped: true };
    running.add(runKey);
    const claimPath = path.join(stateDirectory, claimFilename(date, slot));
    let claimed = false;
    let writeAttempted = false;
    let state = {
      date, startedAt: started.toISOString(), status: "claimed",
      slotId: slot.id, scheduledTime: slot.scheduledTime,
      acknowledgeTapInterruption: true,
      authorization: `Owner-approved ${slot.id === "monday-reset" ? "Monday plan-reset" : "daily"} ${slot.scheduledTime} Eastern repair before the 11:00 opening.`,
      message: `${slot.scheduledTime} Eastern repair claimed. Waiting to send the scheduled configuration update.`,
    };
    const save = async (update) => {
      state = { ...state, ...update, updatedAt: now().toISOString() };
      await atomicJson(claimPath, state);
      await atomicJson(path.join(stateDirectory, "latest.json"), state);
    };
    const audit = async () => {
      await recordActivity({
        area: "Keg Levels", action: "scheduled morning PMB repair", role: "owner",
        summary: `${date} ${slot.scheduledTime} Eastern, owner-approved pre-opening repair: ${state.message}`,
      }).catch(() => {});
    };
    try {
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
      let file;
      try {
        file = await open(claimPath, "wx", 0o600);
        claimed = true;
        await file.writeFile(`${JSON.stringify(state)}\n`);
        await file.sync();
      } catch (error) {
        if (error.code === "EEXIST") return { skipped: true, alreadyClaimed: true };
        throw error;
      } finally {
        await file?.close();
      }
      if (typeof repair !== "function" || typeof refresh !== "function") throw new Error("Missing scheduled repair adapters.");
      const beforeWrite = async () => {
        const checkedAt = now();
        if (!isPmbMorningRepairEnabled(env) || currentRepairSlot(checkedAt)?.id !== slot.id || getPmbRepairClock(checkedAt).date !== date) {
          const error = new Error(`The ${slot.scheduledTime} Eastern repair window has closed.`);
          error.code = "PMB_REPAIR_WINDOW_CLOSED";
          throw error;
        }
        writeAttempted = true;
      };
      // The owner has pre-authorized the interruption during this scheduled
      // pre-opening window. Manual repairs still require guest-clear confirmation.
      // The shared PMB adapter rechecks the window before each config POST.
      await repair({ beforeWrite });
      await save({ status: "repair-sent", sentAt: now().toISOString(), message: "Scheduled repair sent. Waiting three minutes for the tap walls to reconnect." });
      await audit();
      await wait(180_000);
      for (let attempt = 1; ; attempt += 1) {
        const time = getPmbRepairClock(now());
        if (time.date !== date || time.hour !== slot.hour || time.minute >= 50 || !isPmbMorningRepairEnabled(env)) {
          await save({ status: "unverified", message: "Repair was sent; follow-up verification was skipped because its pre-opening window ended or the schedule was paused." });
          break;
        }
        let result;
        try { result = await refresh(); } catch { result = {}; }
        const verification = summarizePmbRepairRefresh(result, { sentAt: state.sentAt, now: now() });
        const coverage = verification.expectedCount ? `${verification.capturedCount}/${verification.expectedCount} taps verified` : "live tap coverage unavailable";
        await save({
          status: verification.verified ? "verified" : "verifying",
          verification, verificationAttempts: attempt,
          message: verification.verified
            ? `Repair complete: ${coverage}; current tap pricing refreshed.`
            : `Repair sent: ${coverage}; ${verification.pricingFresh ? "pricing refreshed" : "current pricing unverified"}. Retrying read-only checks until ${slot.verificationUntil} Eastern; this scheduled repair will not be repeated.`,
        });
        if (verification.verified) break;
        if (result.levels?.timedOut || result.pricing?.timedOut) {
          await save({ status: "needs-attention", message: "Repair sent, but a verification request is still unresolved. Further checks for this run are paused to avoid overlapping stalled requests. This scheduled repair will not be repeated." });
          break;
        }
        await wait(60_000);
      }
      await audit();
      return state;
    } catch (error) {
      if (!claimed) return { status: "failed", message: "Morning repair was not sent because its scheduled-run claim could not be saved." };
      const status = writeAttempted ? "uncertain" : error.code === "PMB_REPAIR_WINDOW_CLOSED" ? "missed-window" : "failed";
      const message = writeAttempted
        ? "The scheduled repair or its verification could not be confirmed. This scheduled run will not be repeated; other scheduled runs are unchanged."
        : "Morning repair was not sent. Its safe window ended or a required connection was unavailable; this run will not catch up later. Other scheduled runs are unchanged.";
      await save({ status, message }).catch(() => {});
      await audit();
      return { ...state, status, message };
    } finally {
      running.delete(runKey);
    }
  };
}

export function startPmbMorningRepairScheduler(options = {}) {
  if (!isPmbMorningRepairEnabled(options.env || process.env)) return null;
  if (globalThis[schedulerKey]) return globalThis[schedulerKey];
  const run = createPmbMorningRepairRunner(options);
  const tick = () => run().then((result) => {
    if (result && !result.skipped) console.info("PMB morning repair:", result.status, result.message);
  }).catch(() => console.error("PMB morning repair scheduler could not complete its check."));
  const timer = setInterval(tick, 15_000);
  timer.unref();
  globalThis[schedulerKey] = { stop() { clearInterval(timer); delete globalThis[schedulerKey]; } };
  // A late service startup will only check the clock; it never catches up a repair.
  tick();
  return globalThis[schedulerKey];
}

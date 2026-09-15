import { isKegOnDeckProductInstalled } from "../public/keg-on-deck-options.mjs";

const clean = (value) => String(value ?? "").trim();
const nameKey = (value) => clean(value).toLowerCase().replace(/\s+[123]$/, "");
const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

// PMB's management page reports venue-local wall time without an offset.
export function parseKegTappedOn(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  let timestamp = local;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(eastern.formatToParts(timestamp).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    if (represented === local) {
      return Number(parts.month) === month && Number(parts.day) === day && Number(parts.year) === year
        && Number(parts.hour) === hour && Number(parts.minute) === minute && Number(parts.second) === second ? timestamp : NaN;
    }
    timestamp += local - represented;
  }
  return NaN;
}

export function applyCoolerEstimateObservations(data, observations, { observedAt, fallbackAt } = {}) {
  const observedTime = Date.parse(observedAt);
  if (!Array.isArray(observations) || observations.length > 250 || !Number.isFinite(observedTime)) {
    throw new Error("Invalid cooler estimate observations.");
  }
  const next = structuredClone(data);
  next.onHandOverrides ||= {};
  next.onDeckOverrides ||= {};
  const estimate = next.coolerEstimateState || { version: 1, startedAt: observedAt, slots: {}, events: [] };
  estimate.slots ||= {};
  estimate.events ||= [];
  const recommendations = next.recommendations?.items || [];
  const seen = new Set();
  for (const item of observations) {
    if (!item || item.levelAvailable !== true || item.tappedOnCached || item.tappedOnError) continue;
    // A placeholder/configuration update is not a physical keg connection.
    if (/coming\s*soon/i.test(clean(item.name))) continue;
    const identifiers = [item.tapNumber, item.deviceId, item.lineNum, item.plu].map(Number);
    if (!identifiers.every((value) => Number.isSafeInteger(value) && value > 0)) continue;
    const slot = identifiers.slice(0, 3).join(":");
    if (seen.has(slot)) throw new Error("Duplicate cooler estimate tap observations.");
    seen.add(slot);
    const tappedAt = parseKegTappedOn(item.tappedOn);
    if (!Number.isFinite(tappedAt) || tappedAt > observedTime + 300000) continue;
    const previous = estimate.slots[slot];
    // Unchanged, old, or out-of-order observations cannot consume stock twice.
    if (previous && (Date.parse(previous.observedAt) > observedTime || tappedAt <= previous.tappedAt)) continue;
    const references = recommendations.filter((entry) => !entry.prepAdditionId
      && Number(entry.tapNumber) === Number(item.tapNumber));
    const reference = references.length === 1 ? references[0] : null;
    const key = clean(reference?.key);
    const wall = clean(reference?.wall).toLowerCase();
    const cooler = wall.includes("karaoke") ? "Karaoke cooler" : wall.includes("main") ? "Main cooler" : "";
    // Physical keg consumption is independent of whether this week needs an
    // order, cocktail prep, or neither. Liquor uses its separate ounce ledger.
    const validReference = reference?.isKegTap && !reference.isLiquorTap && key && cooler;
    const deck = validReference ? next.onDeckOverrides?.[key] : null;
    const deckMatches = deck && typeof deck === "object" && !/liquor/i.test(clean(deck.kind))
      && !/coming\s*soon/i.test(clean(deck.name))
      && clean(deck.onHandUnit) !== "oz" && isKegOnDeckProductInstalled(deck, item)
      && Number(deck.coolerTransferredPlu) !== Number(item.plu);
    const currentMatches = validReference && (Number(reference.plu) === Number(item.plu)
      && nameKey(reference.name) === nameKey(item.name)
      || previous?.key === key && Number(previous.plu) === Number(item.plu) && nameKey(previous.name) === nameKey(item.name));
    const observation = {
      observedAt, tappedAt, tappedOn: item.tappedOn, plu: Number(item.plu), name: item.name, key, cooler,
      ...(Number(previous?.plu) === Number(item.plu) && previous?.onDeckTransfer
        ? { onDeckTransfer: previous.onDeckTransfer } : {}),
    };
    estimate.slots[slot] = observation;
    if (!previous) continue; // First adoption is a baseline, never a backfill.
    let outcome = "unmatched-product";
    let deduction = 0;
    let before = null;
    let after = null;
    if (validReference && (deckMatches || currentMatches)) {
      const field = deckMatches ? "onDeckOverrides" : "onHandOverrides";
      const clock = next.inputEditState?.clocks?.[JSON.stringify([field, key])];
      const countTime = Date.parse(clock?.editedAt || next.inputEditState?.startedAt || fallbackAt || estimate.startedAt);
      const raw = deckMatches ? deck.onHand : next.onHandOverrides?.[key];
      before = raw == null || clean(raw) === "" ? null : Number(raw);
      if (tappedAt <= countTime || tappedAt <= Date.parse(estimate.startedAt)) outcome = "covered-by-newer-count-or-stock-update";
      else if (before === null || !Number.isFinite(before) || before < 0) outcome = "count-unavailable";
      else {
        after = Math.max(0, before - 1);
        deduction = before - after;
        next.onHandOverrides[key] = String(after);
        if (deckMatches) {
          // The new product is connected. Move its remaining backups to the
          // current-product count; normal On Deck cleanup retains its workflow.
          next.onDeckOverrides[key] = { ...deck, onHand: "0", coolerTransferredPlu: Number(item.plu) };
          observation.onDeckTransfer = { key, product: item.name, plu: Number(item.plu), tappedOn: item.tappedOn };
        }
        outcome = deduction ? "estimated-keg-connected" : "no-counted-backup";
      }
    }
    estimate.events.push({
      id: `${slot}:${item.tappedOn}`, slot, ...observation,
      estimated: true, deduction, before, after, outcome,
    });
  }
  estimate.events = estimate.events.slice(-2000);
  next.coolerEstimateState = estimate;
  return next;
}

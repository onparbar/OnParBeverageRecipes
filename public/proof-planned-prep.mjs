function productName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:main|karaoke|patio)(?:\s+(?:wall|cooler))?\b/gi, " ")
    .replace(/\s*[123]\s*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function wallName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+(?:wall|cooler)$/, "");
}

function tapKey(tap) {
  return String(tap.key || `${wallName(tap.wall)}:${Number(tap.tapNumber)}`);
}

function knownQuantity(value) {
  return value !== null && value !== undefined && String(value).trim() !== ""
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

// Credits exist only inside the forecast. They never change counted stock or
// mark a planned batch as physically prepared.
export function carryForwardPlannedProofPrep(options = {}) {
  const inputs = Array.isArray(options.tapInputs) ? options.tapInputs : [];
  const taps = new Map();
  for (const tap of inputs) {
    const number = Number(tap.tapNumber);
    if (!((number >= 47 && number <= 72) || (number >= 93 && number <= 102))) continue;
    if (!taps.has(tapKey(tap))) taps.set(tapKey(tap), tap);
  }

  const credits = new Map();
  let unresolved = false;
  for (const cocktail of Array.isArray(options.cocktails) ? options.cocktails : []) {
    const quantity = Number(cocktail.quantity);
    if (!(quantity > 0)) continue;
    if (!Number.isSafeInteger(quantity)) {
      unresolved = true;
      continue;
    }
    const numbers = (Array.isArray(cocktail.tapNumbers)
      ? cocktail.tapNumbers : [cocktail.tapNumber]).map(Number).filter(number => number > 0);
    const walls = (Array.isArray(cocktail.walls)
      ? cocktail.walls : [cocktail.wall]).map(wallName).filter(Boolean);
    const name = productName(cocktail.name);
    const matches = [...taps.values()].filter(tap => (
      name && productName(tap.name) === name
      && (!numbers.length || numbers.includes(Number(tap.tapNumber)))
      && (!walls.length || walls.includes(wallName(tap.wall)))
    ));

    // A single aggregate quantity cannot establish which of two walls gets
    // the keg. Keep that uncertainty instead of sharing stock between taps.
    if (matches.length > 1) {
      unresolved = true;
      continue;
    }
    // Off-wall prep still reserves its ingredients, but cannot credit an
    // unrelated product currently connected to a tap.
    if (!matches.length) continue;
    const tap = matches[0];
    if (tap.inventoryStateMissing || !knownQuantity(tap.currentStockKegs)
      || !knownQuantity(tap.avgWeeklyKegs)) {
      unresolved = true;
      continue;
    }
    const key = tapKey(tap);
    credits.set(key, (credits.get(key) || 0) + quantity);
  }

  const tapInputs = inputs.map(tap => {
    const quantity = credits.get(tapKey(tap));
    if (!quantity || !knownQuantity(tap.currentStockKegs) || !knownQuantity(tap.avgWeeklyKegs)) return tap;
    const value = tap.preThursdayUsageSharePct;
    const share = knownQuantity(value) ? Math.min(1, Number(value) / 100) : 3 / 7;
    // Prep arrives on Thursday, after the pre-Thursday drawdown. Express that
    // credit without consuming the new batch to cover earlier empty stock.
    return {
      ...tap,
      currentStockKegs: Math.max(Number(tap.currentStockKegs), Number(tap.avgWeeklyKegs) * share) + quantity,
    };
  });
  return { options: { ...options, tapInputs }, unresolved };
}

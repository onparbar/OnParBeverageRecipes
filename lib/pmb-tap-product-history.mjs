const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const nameKey = (value) => clean(value).normalize("NFKC").replace(/\u2019/g, "'").toLowerCase();
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function tapProductIdentity(item) {
  const name = clean(item.tapProduct || item.product || item.name);
  if (![item.tapNumber, item.deviceId, item.lineNum, item.plu].every(positiveInteger) || !name) return null;
  return {
    slotKey: `${Number(item.tapNumber)}:${Number(item.deviceId)}:${Number(item.lineNum)}`,
    tapNumber: Number(item.tapNumber), deviceId: Number(item.deviceId), lineNum: Number(item.lineNum),
    plu: Number(item.plu), name, nameKey: nameKey(name),
  };
}

export function sameTapProduct(left, right) {
  const a = tapProductIdentity(left || {});
  const b = tapProductIdentity(right || {});
  return Boolean(a && b && a.slotKey === b.slotKey && a.plu === b.plu && a.nameKey === b.nameKey);
}

// The database serializes observations and records transitions atomically.
// Missing readings are omitted; absence is never a product-change event.
export async function recordTapProductObservations(items, {
  observedAt = new Date().toISOString(), source = "detected", env = process.env, fetchImpl = globalThis.fetch,
} = {}) {
  if (!["detected", "confirmed"].includes(source) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("Invalid tap history observation.");
  }
  const observations = items.filter((item) => item.levelAvailable !== false).flatMap((item) => {
    const identity = tapProductIdentity(item);
    return identity ? [{ ...identity, tappedOn: clean(item.tappedOn).slice(0, 40) }] : [];
  });
  if (!observations.length) return [];
  if (observations.length > 250
    || new Set(observations.map((item) => item.slotKey)).size !== observations.length
    || new Set(observations.map((item) => item.tapNumber)).size !== observations.length) {
    throw new Error("Ambiguous tap history observations.");
  }
  const baseUrl = clean(env.SUPABASE_URL).replace(/\/+$/, "");
  const secret = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) throw new Error("Tap history storage is not configured.");
  const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/record_pmb_tap_product_observations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json", apikey: secret,
      ...(secret.split(".").length === 3 ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ p_observations: observations, p_observed_at: observedAt, p_source: source }),
    cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) throw new Error("Tap history storage is unavailable.");
  return body;
}

export function attachTapProductHistory(items, records, { unavailable = false } = {}) {
  const bySlot = new Map(records.map((row) => [row.slot_key, row.data]));
  return items.map((item) => {
    const identity = tapProductIdentity(item);
    const candidate = identity && bySlot.get(identity.slotKey);
    const saved = candidate && sameTapProduct(candidate, item) ? candidate : null;
    return {
      ...item,
      tappedOn: item.tappedOn || saved?.lastTappedOn || "",
      tappedOnCached: item.tappedOn ? Boolean(item.tappedOnCached) : Boolean(saved?.lastTappedOn),
      productHistory: saved ? {
        firstSeenAt: saved.firstSeenAt,
        changedAt: saved.changedAt || "",
        source: saved.source,
        previousName: saved.previousProduct?.name || "",
        lastSeenAt: saved.lastSeenAt,
        introducedAt: saved.introducedAt || "",
        introductionSource: saved.introductionSource || "baseline",
        introductionPreviousName: saved.introductionPreviousProduct?.name || "",
      } : item.productHistory || null,
      productHistoryUnavailable: unavailable,
    };
  });
}

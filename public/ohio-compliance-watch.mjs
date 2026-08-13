const FINGERPRINT_PATTERN = /^ohio-compliance-v1:[a-f0-9]{64}$/;

function clean(value, maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeOhioComplianceFingerprint(value) {
  const fingerprint = clean(value, 120).toLowerCase();
  return FINGERPRINT_PATTERN.test(fingerprint) ? fingerprint : "";
}

function safeOfficialUrl(value) {
  const text = clean(value, 2_000);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "";
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["codes.ohio.gov", "ohiohouse.gov"].includes(hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((source) => ({
    id: clean(source?.id, 80),
    title: clean(source?.title, 180),
    summary: clean(source?.summary, 360),
    status: clean(source?.status, 120),
    source: clean(source?.source, 100),
    url: safeOfficialUrl(source?.url),
  })).filter((source) => source.id && source.title && source.url);
}

/**
 * Compare the server's complete official-source fingerprint with the last
 * owner-acknowledged fingerprint. A missing acknowledgement silently creates
 * a baseline candidate; it never produces a first-run change alert.
 */
export function buildOhioComplianceWatchViewModel(watch, {
  acknowledgedFingerprint = "",
} = {}) {
  const currentFingerprint = normalizeOhioComplianceFingerprint(watch?.currentFingerprint);
  const acknowledged = normalizeOhioComplianceFingerprint(acknowledgedFingerprint);
  const isComplete = watch?.isComplete === true
    && clean(watch?.status, 40).toLowerCase() === "complete"
    && Boolean(currentFingerprint);
  const sources = normalizeSources(watch?.sources);

  if (!isComplete) {
    return {
      state: "unavailable",
      isVisible: false,
      shouldEstablishBaseline: false,
      shouldAlert: false,
      currentFingerprint: "",
      acknowledgedFingerprint: acknowledged,
      sources,
      alert: null,
    };
  }

  if (!acknowledged) {
    return {
      state: "baseline-required",
      isVisible: false,
      shouldEstablishBaseline: true,
      shouldAlert: false,
      currentFingerprint,
      acknowledgedFingerprint: "",
      sources,
      alert: null,
    };
  }

  if (acknowledged === currentFingerprint) {
    return {
      state: "current",
      isVisible: false,
      shouldEstablishBaseline: false,
      shouldAlert: false,
      currentFingerprint,
      acknowledgedFingerprint: acknowledged,
      sources,
      alert: null,
    };
  }

  return {
    state: "changed",
    isVisible: true,
    shouldEstablishBaseline: false,
    shouldAlert: true,
    currentFingerprint,
    acknowledgedFingerprint: acknowledged,
    sources,
    alert: {
      severity: "warning",
      title: "Ohio beverage compliance sources changed",
      message: "An official Ohio hemp-law or drinkable-cannabinoid source changed since it was last reviewed.",
      actionLabel: "Review official sources",
    },
  };
}

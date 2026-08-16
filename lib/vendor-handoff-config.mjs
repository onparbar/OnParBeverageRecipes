const VENDOR_HANDOFF_CONFIG = Object.freeze({
  bonbright: Object.freeze({
    key: "bonbright",
    vendor: "Bonbright",
    actionLabel: null,
    externalUrl: null,
  }),
  heidelberg: Object.freeze({
    key: "heidelberg",
    vendor: "Heidelberg",
    actionLabel: "Open BEES",
    externalUrl: "https://mybeesapp.com/customer/account",
  }),
  proof: Object.freeze({
    key: "proof",
    vendor: "Proof",
    actionLabel: "Open Proof",
    externalUrl: "https://shop.sgproof.com/auth/login",
  }),
  ohlq: Object.freeze({
    key: "ohlq",
    vendor: "OHLQ",
    actionLabel: "Open OHLQ",
    externalUrl: "https://portal.ohlq.com/eCommerce-Login?returnurl=%2f",
  }),
});

const VENDOR_ALIASES = Object.freeze({
  bees: "heidelberg",
  bonbright: "bonbright",
  heidelberg: "heidelberg",
  ohlq: "ohlq",
  proof: "proof",
});

export function normalizeVendorKey(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return VENDOR_ALIASES[key] || null;
}

export function getVendorHandoffConfig(value) {
  const key = normalizeVendorKey(value);
  return key ? VENDOR_HANDOFF_CONFIG[key] : null;
}

export function getVendorHandoffPath(value) {
  const config = getVendorHandoffConfig(value);
  return config?.externalUrl
    ? `/api/vendor-handoff?vendor=${encodeURIComponent(config.key)}`
    : null;
}

export function listVendorHandoffConfigs() {
  return Object.values(VENDOR_HANDOFF_CONFIG);
}

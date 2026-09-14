import { getActiveComingSoonItems } from "../public/coming-soon-items.mjs";
import { recordDashboardActivity } from "./dashboard-activity-log.mjs";
import { createSharedDashboardStore } from "./shared-dashboard-store.mjs";
import { createSharedKegParAgentStore } from "./keg-par-agent-shared-store.mjs";
import { parsePmbProductEditForm } from "./pmb-price-update.mjs";
import {
  getConfig,
  getAuthtoken,
  getProductList,
  openProductEditForm,
  saveProductEditForm,
} from "./pmb-product-management.mjs";

const clean = (value) => String(value ?? "").trim();
const identityName = (value) => clean(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const validPlu = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function activationError(code, message) {
  return Object.assign(new Error(message), { code, status: 503 });
}

export function getQueuedPmbActivationTargets(dashboard, kegs) {
  if (!dashboard?.initialized || !kegs?.initialized) {
    throw activationError("PMB_ACTIVATION_STATE_UNAVAILABLE", "Shared product lists are unavailable; automatic PMB activation cannot safely proceed.");
  }
  const comingSoon = dashboard.data?.products?.comingSoonItems;
  const onDeck = kegs.data?.onDeckOverrides;
  if (!Array.isArray(comingSoon) || !onDeck || typeof onDeck !== "object" || Array.isArray(onDeck)) {
    throw activationError("PMB_ACTIVATION_STATE_UNAVAILABLE", "Shared On Deck or Coming Soon products could not be read.");
  }
  const targets = getActiveComingSoonItems(comingSoon).map((item) => ({
    name: clean(item.pmbProductName || item.name), plu: validPlu(item.plu), source: "Coming Soon",
  }));
  for (const item of Object.values(onDeck)) {
    if (!item || typeof item !== "object" || !clean(item.name)) continue;
    const saved = comingSoon.find((entry) => entry?.id === item.comingSoonId);
    // A referenced Coming Soon identity supplements, but never replaces, a saved On Deck PLU.
    const sameProduct = saved && (
      (validPlu(item.plu) && validPlu(item.plu) === validPlu(saved.plu))
      || identityName(item.name) === identityName(saved.name)
    );
    targets.push({
      name: clean(item.pmbProductName || (sameProduct && saved.pmbProductName) || item.name),
      plu: validPlu(item.plu) || (sameProduct ? validPlu(saved.plu) : 0),
      source: "On Deck",
    });
  }
  return targets;
}

export function resolvePmbActivationTargets(targets, products) {
  if (!Array.isArray(products)) throw activationError("PMB_ACTIVATION_CATALOG_UNAVAILABLE", "PMB's product list is unavailable.");
  const resolved = new Map();
  for (const target of targets) {
    const matches = products.filter((product) => target.plu
      ? validPlu(product?.plu) === target.plu
      : identityName(product?.name) === identityName(target.name));
    if (matches.length !== 1 || !validPlu(matches[0]?.plu)
      || !identityName(target.name) || identityName(matches[0]?.name) !== identityName(target.name)) {
      throw activationError("PMB_ACTIVATION_IDENTITY_UNVERIFIED", `Cannot safely match ${target.source} product ${target.name} in PMB. Repair was not sent.`);
    }
    const product = matches[0];
    resolved.set(validPlu(product.plu), { plu: validPlu(product.plu), name: clean(product.name) });
  }
  return [...resolved.values()];
}

function singleEntry(entries, name) {
  const values = entries.filter(([key]) => key === name).map(([, value]) => value);
  if (values.length !== 1) throw activationError("PMB_ACTIVATION_FORM_INVALID", `PMB did not return one ${name} field.`);
  return values[0];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

export function inspectPmbActivationForm(html, target) {
  const entries = parsePmbProductEditForm(html);
  if (validPlu(singleEntry(entries, "fd_plu")) !== target.plu
    || identityName(singleEntry(entries, "fd_name")) !== identityName(target.name)) {
    throw activationError("PMB_ACTIVATION_FORM_IDENTITY_MISMATCH", "PMB opened a different product. No activation was attempted for that form.");
  }
  const forms = (String(html || "").match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [])
    .filter((form) => /name\s*=\s*["']submit_saveedit_product["']/i.test(form));
  const controls = (forms[0]?.match(/<input\b[^>]*>/gi) || [])
    .filter((tag) => attribute(tag, "name") === "fd_is_active");
  if (forms.length !== 1 || controls.length !== 1 || attribute(controls[0], "type")?.toLowerCase() !== "checkbox"
    || /\sdisabled(?:\s|=|\/?>)/i.test(controls[0])) {
    throw activationError("PMB_ACTIVATION_FORM_INVALID", "PMB's Active checkbox is unavailable; the product was not changed.");
  }
  const activeEntries = entries.filter(([key]) => key === "fd_is_active");
  if (activeEntries.length > 1) throw activationError("PMB_ACTIVATION_FORM_INVALID", "PMB returned conflicting Active fields.");
  return { entries, active: activeEntries.length === 1, activeValue: attribute(controls[0], "value") ?? "on" };
}

function preservedProductFields(entries) {
  return JSON.stringify(entries.filter(([key]) => key.startsWith("fd_") && key !== "fd_is_active")
    .map((entry) => [...entry]).sort(([a, av], [b, bv]) => a.localeCompare(b) || String(av).localeCompare(String(bv))));
}

function createClient(env) {
  const config = getConfig(env);
  return {
    list: async () => getProductList(config, await getAuthtoken(config)),
    open: (plu) => openProductEditForm(config, plu),
    save: (entries, cookieJar, beforeWrite) => saveProductEditForm(config, entries, cookieJar, { beforeWrite }),
  };
}

// No public mutation endpoint: only the claimed on-site morning repair invokes this preflight.
export async function activateQueuedPmbProducts({
  env = process.env,
  beforeWrite,
  readDashboard = () => createSharedDashboardStore({ env }).read(),
  readKegs = () => createSharedKegParAgentStore({ env }).read({ rolloverWeek: false }),
  client,
  recordActivity = (entry) => recordDashboardActivity(entry, { env }),
} = {}) {
  if (typeof beforeWrite !== "function") throw activationError("PMB_ACTIVATION_GUARD_REQUIRED", "Scheduled PMB activation requires a safe repair-window guard.");
  const summary = { checked: 0, alreadyActive: 0, activated: [], verified: false };
  let pending = null;
  try {
    const dashboard = await readDashboard();
    const kegs = await readKegs();
    const targets = getQueuedPmbActivationTargets(dashboard, kegs);
    if (targets.length) {
      const pmb = client || createClient(env);
      // Resolve every saved identity first. Never create a new product or guess a similar name.
      const products = resolvePmbActivationTargets(targets, await pmb.list());
      for (const product of products) {
        await beforeWrite();
        const form = await pmb.open(product.plu);
        const current = inspectPmbActivationForm(form.html, product);
        if (current.active) {
          summary.alreadyActive += 1;
          summary.checked += 1;
          continue;
        }
        // Preserve all original form values, including pricing, portions and image references.
        const entries = [...current.entries, ["fd_is_active", current.activeValue], ["submit_saveedit_product", "save"]];
        pending = product;
        await pmb.save(entries, form.cookieJar, beforeWrite);
        const saved = inspectPmbActivationForm((await pmb.open(product.plu)).html, product);
        if (!saved.active || preservedProductFields(saved.entries) !== preservedProductFields(current.entries)) {
          throw activationError("PMB_ACTIVATION_READBACK_FAILED", `PMB activation for ${product.name} could not be verified without other product changes. Repair was not sent.`);
        }
        summary.activated.push(product);
        summary.checked += 1;
        pending = null;
      }
    }
    await beforeWrite();
    summary.verified = true;
    await recordActivity({
      area: "PMB", action: "checked queued product activation", role: "system",
      summary: `${summary.checked} On Deck/Coming Soon products verified active; ${summary.activated.length} activated before scheduled repair.`,
    }).catch(() => {});
    return summary;
  } catch (error) {
    summary.unverifiedProduct = pending;
    error.productActivation = summary;
    await recordActivity({
      area: "PMB", action: "queued product activation needs attention", role: "system",
      summary: `${error.code || "PMB_ACTIVATION_FAILED"}: ${clean(error.message)}${pending ? ` Unverified save: ${pending.name}.` : ""} Verified activations: ${summary.activated.length}. Repair not sent.`,
    }).catch(() => {});
    throw error;
  }
}

import { getConfig, getAuthtoken, getProductList } from "./pmb-product-management.mjs";
import { readLatestPmbDataBackup, savePmbDataBackup } from "./pmb-data-backup-store.mjs";

export const PMB_PRODUCT_CATALOG_SOURCE = "pmb-product-catalog";
export async function savePmbProductCatalog(products, { env = process.env } = {}) {
  if (!Array.isArray(products) || !products.length || products.some(p => !p || typeof p !== "object" || !Number.isSafeInteger(Number(p.plu)) || Number(p.plu) <= 0)) {
    throw new Error("PMB returned an incomplete product catalog. The saved catalog was kept.");
  }
  if (new Set(products.map(p => Number(p.plu))).size !== products.length) throw new Error("PMB returned duplicate product identities. The saved catalog was kept.");
  // Keep the complete product records, including inactive products and all
  // vendor-provided fields. Authentication responses are never stored here.
  const data = { schemaVersion: 1, updatedAt: new Date().toISOString(), products };
  await savePmbDataBackup(PMB_PRODUCT_CATALOG_SOURCE, data, { env });
  return data;
}
export async function refreshPmbProductCatalog({ env = process.env } = {}) {
  const config = getConfig(env);
  const token = await getAuthtoken(config);
  return savePmbProductCatalog(await getProductList(config, token), { env });
}
export async function readPmbProductCatalog({ refresh = false, env = process.env } = {}) {
  const previous = await readLatestPmbDataBackup(PMB_PRODUCT_CATALOG_SOURCE, { env });
  if (!refresh && previous?.data?.products?.length) return { ...previous.data, fromBackup: true };
  try { return { ...(await refreshPmbProductCatalog({ env })), fromBackup: false }; }
  catch (error) {
    if (!previous?.data?.products?.length) throw error;
    return { ...previous.data, fromBackup: true, stale: true, warning: "PMB is unavailable. Showing the last saved product catalog." };
  }
}

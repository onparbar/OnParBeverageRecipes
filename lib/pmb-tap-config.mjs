import { readPmbOperationalPage } from "./pmb-item-management.mjs";
import { parsePmbKegTimestamps } from "./pmb-keg-timestamps.mjs";
import { buildVerifiedKegSlotMap } from "./pmb-keg-safety.mjs";

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function decodeHtml(value) {
  return clean(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " "));
}

export function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

export function parseTapConfigRows(html) {
  const rows = [];
  const rowPattern = /<tr id="dev(\d+)(?:_r(\d+))?">([\s\S]*?)(?=<tr id="dev|<\/tbody>)/g;
  let match;

  while ((match = rowPattern.exec(html))) {
    const deviceId = Number(match[1] || 0);
    const body = match[3] || "";
    const pluCell = body.match(/<td class="plunum">([\s\S]*?)<\/td>/);
    if (!deviceId || !pluCell) continue;

    const pluText = stripHtml(pluCell[1]);
    const lineNum = Number(pluText.match(/^(\d+):/)?.[1] || match[2] || 0);
    const plu = Number(pluText.match(/PLU#(\d+)/)?.[1] || 0);
    const product = clean(stripHtml(pluText.replace(/^\d+:\s*/, "").replace(/^PLU#\d+\s*/, "")));
    const lineName = decodeHtml(body.match(/<input type="text" name="fd_line_name"[^>]*value="([^"]*)"/)?.[1] || "");
    const tapNumber = Number(lineName || 0) || null;

    rows.push({
      tapNumber,
      deviceId,
      lineNum,
      plu: plu || null,
      product,
      unused: /unused/i.test(pluText),
    });
  }

  return rows;
}

export async function getTapConfigRows(config, { timeoutMs = 15000, cookieJar = new Map() } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const html = await readPmbOperationalPage(config, "/pages/tapconfig", { cookieJar, timeoutMs });
    const rows = parseTapConfigRows(html);
    try {
      buildVerifiedKegSlotMap(rows);
      return rows;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

export async function getKegTappedOnRows(config, { timeoutMs = 5000, cookieJar = new Map() } = {}) {
  const html = await readPmbOperationalPage(config, "/pages/keglevel", { timeoutMs, cookieJar });
  const rows = parsePmbKegTimestamps(html);
  if (!rows.length) throw new Error("PMB keg history did not contain readable timestamps.");
  return rows;
}

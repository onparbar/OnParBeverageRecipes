import { NextResponse } from "next/server";
import {
  readPmbLevelSnapshot,
  savePmbLevelSnapshot,
} from "../../../lib/pmb-level-snapshot-store.mjs";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import {
  buildVerifiedKegSlotMap,
  PmbKegSafetyError,
  requireSuccessfulKegLevelResponse,
} from "../../../lib/pmb-keg-safety.mjs";

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const safe = [];
    let inString = false;
    let escaping = false;
    for (const char of String(text || "")) {
      if (!inString) {
        if (char === '"') inString = true;
        safe.push(char);
        continue;
      }
      if (escaping) {
        safe.push(char);
        escaping = false;
        continue;
      }
      if (char === "\\") {
        safe.push(char);
        escaping = true;
        continue;
      }
      if (char === '"') {
        safe.push(char);
        inString = false;
        continue;
      }
      if (char === "\n") {
        safe.push("\\n");
        continue;
      }
      if (char === "\r") {
        safe.push("\\r");
        continue;
      }
      safe.push(char);
    }

    try {
      return JSON.parse(safe.join(""));
    } catch {
      return null;
    }
  }
}

async function postJson(baseUrl, path, body, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  return {
    status: response.status,
    json: parseJsonLoose(raw),
    raw,
  };
}

function getConfig() {
  const baseUrl = (process.env.PMB_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Missing PMB_API_BASE_URL in .env.local");
  }
  const username = (process.env.PMB_API_USERNAME || "").trim();
  const password = (process.env.PMB_API_PASSWORD || "").trim();
  if (!username || !password) throw new Error("Missing PMB_API_USERNAME or PMB_API_PASSWORD in .env.local");

  return {
    baseUrl,
    username,
    password,
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: (process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
  };
}

async function getAuthtoken(config) {
  const auth = await postJson(config.baseUrl, "/api/authtoken", {
    username: config.username,
    password: config.password,
    id: config.clientId,
    name: config.clientName,
    type: "json-server-control",
    version: 1,
  });

  if (auth.status !== 200 || !auth.json?.authtoken) {
    throw new PmbKegSafetyError(`PMB authtoken failed (${auth.status})`, {
      code: "PMB_AUTH_UNAVAILABLE",
      status: 503,
    });
  }

  return String(auth.json.authtoken);
}

function normalizeProductName(name) {
  return String(name || "")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  try {
    const config = getConfig();
    const token = await getAuthtoken(config);

    const [products, tapConfigRows] = await Promise.all([
      postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token),
      getTapConfigRows(config).catch((error) => {
        throw new PmbKegSafetyError(
          `Live PMB tap configuration could not be verified: ${error.message || "tap configuration unavailable"}`,
          {
            code: "PMB_TAP_CONFIG_UNAVAILABLE",
            status: 503,
          },
        );
      }),
    ]);

    if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
      throw new PmbKegSafetyError(`PMB productlist failed (${products.status})`, {
        code: "PMB_PRODUCT_LIST_UNAVAILABLE",
        status: 503,
      });
    }

    const verifiedSlots = [...buildVerifiedKegSlotMap(tapConfigRows).values()];

    const levelBySlot = new Map();
    for (const slot of verifiedSlots) {
      const response = await postJson(
        config.baseUrl,
        "/api/getkeglevels",
        { device_id: slot.deviceId, line_num: slot.lineNum },
        token,
      );
      // The dashboard can safely display a verified percentage even when a
      // controller has not been configured with keg-size metadata. Keg writes
      // keep the helper's stricter default and still require the complete
      // response before calculating or sending an adjustment.
      const levelJson = requireSuccessfulKegLevelResponse(response, slot, {
        requireKegSize: false,
      });

      const rawPercent = Number(levelJson.fill_level_perc);
      const rawKegSize = Number(levelJson.fill_level_keg_size);
      const rawKegSizeDp = Number(levelJson.fill_level_keg_size_dp);
      levelBySlot.set(`${slot.deviceId}:${slot.lineNum}`, {
        fillLevelPercent: Number.isFinite(rawPercent) ? Math.round((rawPercent / 100) * 10) / 10 : null,
        rawPercent,
        rawKegSize: Number.isFinite(rawKegSize) ? rawKegSize : null,
        rawKegSizeDp: Number.isFinite(rawKegSizeDp) ? rawKegSizeDp : null,
      });
    }

    const deviceLevels = {};
    verifiedSlots.forEach((slot) => {
      const key = String(slot.deviceId);
      if (!deviceLevels[key]) deviceLevels[key] = [];
      const level = levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`) || {};
      deviceLevels[key].push({
        lineNum: slot.lineNum,
        fillLevelPercent: level.fillLevelPercent ?? null,
        rawPercent: level.rawPercent ?? null,
        rawKegSize: level.rawKegSize ?? null,
        rawKegSizeDp: level.rawKegSizeDp ?? null,
      });
    });

    Object.values(deviceLevels).forEach((levels) => {
      levels.sort((a, b) => a.lineNum - b.lineNum);
    });

    const productByPlu = new Map(
      products.json.productlist
        .map((product) => [Number(product.plu || 0), product])
        .filter(([plu]) => plu),
    );
    const items = verifiedSlots.map((slot) => {
      const product = productByPlu.get(slot.plu) || {};
      const level = levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`) || {};
      return {
        slotKey: slot.slotKey,
        plu: slot.plu,
        name: normalizeProductName(product.name || slot.product || `PLU ${slot.plu}`),
        fillLevelPercent: level.fillLevelPercent ?? null,
        deviceId: slot.deviceId,
        lineNum: slot.lineNum,
        tapNumber: slot.tapNumber || null,
        tapProduct: normalizeProductName(slot.product),
        volumeUnit: String(product.volume_unit || ""),
        volumeUnitDp: Number(product.volume_unit_dp || 0),
        rawPercent: level.rawPercent ?? null,
        rawKegSize: level.rawKegSize ?? null,
        rawKegSizeDp: level.rawKegSizeDp ?? null,
      };
    });

    const snapshot = {
      updatedAt: new Date().toISOString(),
      items,
      deviceLevels,
    };
    let sharedSnapshotSaved = true;
    try {
      await savePmbLevelSnapshot(snapshot);
    } catch {
      sharedSnapshotSaved = false;
    }

    return NextResponse.json({ ...snapshot, stale: false, sharedSnapshotSaved });
  } catch (error) {
    try {
      const snapshot = await readPmbLevelSnapshot();
      if (snapshot) {
        return NextResponse.json({
          ...snapshot,
          stale: true,
          degraded: true,
          liveError: error.message || "Could not load live keg levels.",
        });
      }
    } catch {
      // The browser retains its local fallback when shared storage is unavailable.
    }
    const status = Number(error?.status)
      || (/^Missing PMB_API_BASE_URL/.test(error?.message || "") ? 500 : 503);
    return NextResponse.json(
      {
        error: error.message || "Could not load keg levels.",
        code: error?.code || "PMB_KEG_LEVELS_UNAVAILABLE",
        degraded: status === 503,
        items: [],
        deviceLevels: {},
      },
      { status },
    );
  }
}

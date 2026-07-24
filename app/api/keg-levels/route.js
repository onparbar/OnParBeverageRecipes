import { NextResponse } from "next/server";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";

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

  return {
    baseUrl,
    username: (process.env.PMB_API_USERNAME || "admin").trim(),
    password: (process.env.PMB_API_PASSWORD || "admin").trim(),
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: (process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
    fallbackDeviceId: Number(process.env.PMB_KEG_DEVICE_ID || "66952915841408") || 0,
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
    throw new Error(`PMB authtoken failed (${auth.status})`);
  }

  return String(auth.json.authtoken);
}

function getDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 60);

  const format = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return {
    start_time: `${format(start)}T00:00:00-05:00`,
    end_time: `${format(new Date(end.getTime() + 24 * 60 * 60 * 1000))}T00:00:00-05:00`,
  };
}

function normalizeProductName(name) {
  return String(name || "")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSlotMapFromTapConfig(rows) {
  const slotByPlu = new Map();
  rows.forEach((row) => {
    const plu = Number(row.plu || 0);
    const tapNumber = Number(row.tapNumber || 0);
    const deviceId = Number(row.deviceId || 0);
    const lineNum = Number(row.lineNum || 0);
    if (!plu || !deviceId || !lineNum || row.unused) return;
    slotByPlu.set(plu, {
      deviceId,
      lineNum,
      tapNumber: tapNumber || null,
      tapProduct: normalizeProductName(row.product),
    });
  });
  return slotByPlu;
}

export async function GET() {
  try {
    const config = getConfig();
    const token = await getAuthtoken(config);

    const [products, transactions, tapConfigRows] = await Promise.all([
      postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token),
      postJson(config.baseUrl, "/api/transactions", { id: config.clientId, ...getDateRange() }, token),
      getTapConfigRows(config).catch(() => []),
    ]);

    if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
      throw new Error(`PMB productlist failed (${products.status})`);
    }

    if (transactions.status !== 200 || !Array.isArray(transactions.json?.taptransactions)) {
      throw new Error(`PMB transactions failed (${transactions.status})`);
    }

    let slotByPlu = buildSlotMapFromTapConfig(tapConfigRows);
    if (!slotByPlu.size) {
      const latestDeviceByPlu = new Map();
      transactions.json.taptransactions.forEach((transaction) => {
        const plu = Number(transaction.plu || 0);
        const deviceId = Number(transaction.device_id || 0);
        const started = Number(transaction.tst_start || 0);
        if (!plu || !deviceId) return;

        const existing = latestDeviceByPlu.get(plu);
        if (!existing || started >= existing.started) {
          latestDeviceByPlu.set(plu, { deviceId, started });
        }
      });

      const plusByDevice = new Map();
      products.json.productlist.forEach((product) => {
        const plu = Number(product.plu || 0);
        if (!plu) return;
        const mappedDevice = latestDeviceByPlu.get(plu)?.deviceId || config.fallbackDeviceId;
        if (!mappedDevice) return;

        if (!plusByDevice.has(mappedDevice)) {
          plusByDevice.set(mappedDevice, []);
        }
        plusByDevice.get(mappedDevice).push(plu);
      });

      slotByPlu = new Map();
      plusByDevice.forEach((plus, deviceId) => {
        plus
          .sort((a, b) => b - a)
          .forEach((plu, index) => {
            slotByPlu.set(plu, { deviceId, lineNum: index + 1, tapNumber: null, tapProduct: "" });
          });
      });
    }

    const uniqueSlots = [...new Map(
      [...slotByPlu.values()].map((slot) => [`${slot.deviceId}:${slot.lineNum}`, slot]),
    ).values()];

    const levelBySlot = new Map();
    for (const slot of uniqueSlots) {
      const response = await postJson(
        config.baseUrl,
        "/api/getkeglevels",
        { device_id: slot.deviceId, line_num: slot.lineNum },
        token,
      );

      const rawPercent = Number(response.json?.fill_level_perc);
      const rawKegSize = Number(response.json?.fill_level_keg_size);
      const rawKegSizeDp = Number(response.json?.fill_level_keg_size_dp);
      levelBySlot.set(`${slot.deviceId}:${slot.lineNum}`, {
        fillLevelPercent: Number.isFinite(rawPercent) ? Math.round((rawPercent / 100) * 10) / 10 : null,
        rawPercent,
        rawKegSize,
        rawKegSizeDp,
      });
    }

    const deviceLevels = {};
    uniqueSlots.forEach((slot) => {
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

    const items = products.json.productlist
      .map((product) => {
        const plu = Number(product.plu || 0);
        if (!plu || !slotByPlu.has(plu)) return null;
        const slot = slotByPlu.get(plu);

        return {
          plu,
          name: normalizeProductName(product.name),
          fillLevelPercent: levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`)?.fillLevelPercent ?? null,
          deviceId: slot.deviceId,
          lineNum: slot.lineNum,
          tapNumber: slot.tapNumber || null,
          tapProduct: slot.tapProduct || "",
          volumeUnit: String(product.volume_unit || ""),
          volumeUnitDp: Number(product.volume_unit_dp || 0),
          rawPercent: levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`)?.rawPercent ?? null,
          rawKegSize: levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`)?.rawKegSize ?? null,
          rawKegSizeDp: levelBySlot.get(`${slot.deviceId}:${slot.lineNum}`)?.rawKegSizeDp ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      items,
      deviceLevels,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not load keg levels." },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const safe = [];
    let inString = false;
    let escaping = false;

    for (const char of String(text || "")) {
      if (!inString) {
        if (char === "\"") inString = true;
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
      if (char === "\"") {
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
      return JSON.parse(safe.join("").replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

async function postJson(baseUrl, path, body, token = "") {
  try {
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
      path,
      status: response.status,
      json: parseJsonLoose(raw),
      raw,
    };
  } catch (error) {
    return {
      path,
      status: 0,
      json: null,
      raw: error.message || "PMB request failed.",
    };
  }
}

function getConfig() {
  const baseUrl = (process.env.PMB_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("Missing PMB_API_BASE_URL in .env.local");

  return {
    baseUrl,
    username: (process.env.PMB_API_USERNAME || "admin").trim(),
    password: (process.env.PMB_API_PASSWORD || "admin").trim(),
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: (process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
    fallbackDeviceId: Number(process.env.PMB_KEG_DEVICE_ID || "66952915841408") || 0,
    staticAuthtoken: (process.env.PMB_AUTHTOKEN || "").trim(),
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

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

async function resolveSlot(config, token, requestedPlu, requestedDeviceId, requestedLineNum) {
  if (requestedDeviceId && requestedLineNum) {
    return {
      product: null,
      slot: {
        deviceId: requestedDeviceId,
        lineNum: requestedLineNum,
      },
    };
  }

  const plu = Number(requestedPlu || 0);
  if (!plu) throw new Error("A PMB PLU is required to adjust a keg level.");

  const [products, transactions] = await Promise.all([
    postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token),
    postJson(config.baseUrl, "/api/transactions", { id: config.clientId, ...getDateRange() }, token),
  ]);

  if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
    throw new Error(`PMB productlist failed (${products.status})`);
  }
  if (transactions.status !== 200 || !Array.isArray(transactions.json?.taptransactions)) {
    throw new Error(`PMB transactions failed (${transactions.status})`);
  }

  const latestDeviceByPlu = new Map();
  transactions.json.taptransactions.forEach((transaction) => {
    const transactionPlu = Number(transaction.plu || 0);
    const deviceId = Number(transaction.device_id || 0);
    const started = Number(transaction.tst_start || 0);
    if (!transactionPlu || !deviceId) return;

    const existing = latestDeviceByPlu.get(transactionPlu);
    if (!existing || started >= existing.started) {
      latestDeviceByPlu.set(transactionPlu, { deviceId, started });
    }
  });

  const plusByDevice = new Map();
  products.json.productlist.forEach((product) => {
    const productPlu = Number(product.plu || 0);
    if (!productPlu) return;
    const mappedDevice = latestDeviceByPlu.get(productPlu)?.deviceId || config.fallbackDeviceId;
    if (!mappedDevice) return;
    if (!plusByDevice.has(mappedDevice)) plusByDevice.set(mappedDevice, []);
    plusByDevice.get(mappedDevice).push(productPlu);
  });

  const slotByPlu = new Map();
  plusByDevice.forEach((plus, deviceId) => {
    plus
      .sort((a, b) => b - a)
      .forEach((productPlu, index) => {
        slotByPlu.set(productPlu, { deviceId, lineNum: index + 1 });
      });
  });

  const product = products.json.productlist.find((entry) => Number(entry.plu || 0) === plu) || null;
  const slot = slotByPlu.get(plu);
  if (!product) throw new Error(`PMB product ${plu} was not found in productlist.`);
  if (!slot) throw new Error(`PMB slot was not found for ${product.name || plu}.`);

  return { product, slot };
}

function getFullOunces(level) {
  const rawKegSize = toNumber(level?.fill_level_keg_size);
  if (!rawKegSize) return 0;
  const decimalPlaces = Math.max(0, Math.round(toNumber(level?.fill_level_keg_size_dp)));
  return decimalPlaces ? rawKegSize / (10 ** decimalPlaces) : rawKegSize;
}

function getCurrentOunces(level, fullOunces) {
  const rawPercent = toNumber(level?.fill_level_perc);
  if (!rawPercent || !fullOunces) return 0;
  return (rawPercent / 10000) * fullOunces;
}

function buildAdjustment(input, level) {
  const fullOunces = getFullOunces(level);
  if (!fullOunces) throw new Error("PMB did not return a keg size for that tap.");

  const currentOunces = getCurrentOunces(level, fullOunces);
  const targetPercentInput = toNumber(input.targetPercent);
  const targetOuncesInput = toNumber(input.targetOunces);
  const deltaOunces = toNumber(input.deltaOunces);

  let targetOunces = currentOunces;
  if (targetPercentInput > 0 || String(input.targetPercent ?? "").trim() === "0") {
    targetOunces = (clamp(targetPercentInput, 0, 100) / 100) * fullOunces;
  } else if (targetOuncesInput > 0 || String(input.targetOunces ?? "").trim() === "0") {
    targetOunces = clamp(targetOuncesInput, 0, fullOunces);
  } else if (deltaOunces) {
    targetOunces = clamp(currentOunces + deltaOunces, 0, fullOunces);
  } else {
    throw new Error("Enter ounces to add/remove or a target percent.");
  }

  const targetRawPercent = Math.round((targetOunces / fullOunces) * 10000);
  const targetPercent = Math.round((targetRawPercent / 100) * 10) / 10;

  return {
    fullOunces,
    currentOunces,
    currentPercent: Math.round((toNumber(level?.fill_level_perc) / 100) * 10) / 10,
    targetOunces,
    targetRawPercent,
    targetPercent,
    deltaOunces: targetOunces - currentOunces,
  };
}

async function setKegLevel(config, token, slot, level, adjustment) {
  const payload = {
    device_id: Number(slot.deviceId),
    line_num: Number(slot.lineNum),
    fill_level_perc: adjustment.targetRawPercent,
    fill_level_keg_size: Number(level.fill_level_keg_size || 0),
    fill_level_keg_size_dp: Number(level.fill_level_keg_size_dp || 0),
  };

  const attempts = [];
  const tokenAttempts = [
    { label: "generated authtoken", value: token },
    ...(config.staticAuthtoken && config.staticAuthtoken !== token ? [{ label: "PMB_AUTHTOKEN", value: config.staticAuthtoken }] : []),
  ];

  for (const tokenAttempt of tokenAttempts) {
    for (const path of ["/api/setkeglevels", "/m2m/api/setkeglevels"]) {
      const result = await postJson(config.baseUrl, path, payload, tokenAttempt.value);
      attempts.push({
        path,
        token: tokenAttempt.label,
        status: result.status,
        response: String(result.raw || "").slice(0, 300),
      });
      if (result.status === 200) return { path, payload, attempts, token: tokenAttempt.value };
    }
  }

  for (const tokenAttempt of tokenAttempts) {
    const result = await postJson(config.baseUrl, "/api/setkeglevels", {
      authtoken: tokenAttempt.value,
      ...payload,
    });
    attempts.push({
      path: "/api/setkeglevels",
      token: `${tokenAttempt.label} in body`,
      status: result.status,
      response: String(result.raw || "").slice(0, 300),
    });
    if (result.status === 200) return { path: "/api/setkeglevels", payload, attempts, token: tokenAttempt.value };
  }

  const meaningful = attempts.find((attempt) => attempt.status > 0) || attempts[attempts.length - 1];
  const authHint = meaningful?.status === 401
    ? " TTG accepted keg-level reads, but rejected the keg-level write endpoint for this API token/client."
    : "";
  const error = new Error(`PMB keg level update failed (${meaningful?.status || 0}).${authHint}`);
  error.attempts = attempts;
  throw error;
}

async function sendTargetedConfigUpdate(config, token, slot) {
  const payload = {
    id: String(config.clientId),
    device_id: Number(slot.deviceId),
  };
  const attempts = [];

  for (const path of ["/api/configupdate", "/m2m/api/configupdate"]) {
    const result = await postJson(config.baseUrl, path, payload, token);
    attempts.push({
      path,
      status: result.status,
      response: String(result.raw || "").slice(0, 300),
    });
    if (result.status === 200) return { path, payload, attempts };
  }

  const last = attempts[attempts.length - 1];
  const error = new Error(`Targeted PMB config update failed (${last?.status || 0}).`);
  error.attempts = attempts;
  throw error;
}

export async function POST(request) {
  try {
    const input = await request.json();
    const config = getConfig();
    const token = await getAuthtoken(config);
    const requestedDeviceId = Number(input.deviceId || input.device_id || 0);
    const requestedLineNum = Number(input.lineNum || input.line_num || 0);
    const requestedPlu = Number(input.plu || 0);
    const { product, slot } = await resolveSlot(config, token, requestedPlu, requestedDeviceId, requestedLineNum);

    const levelResult = await postJson(
      config.baseUrl,
      "/api/getkeglevels",
      { device_id: Number(slot.deviceId), line_num: Number(slot.lineNum) },
      token,
    );
    if (levelResult.status !== 200 || !levelResult.json) {
      throw new Error(`PMB getkeglevels failed (${levelResult.status})`);
    }

    const adjustment = buildAdjustment(input, levelResult.json);
    const setResult = await setKegLevel(config, token, slot, levelResult.json, adjustment);
    const configUpdateResult = input.sendConfigUpdate === false
      ? null
      : await sendTargetedConfigUpdate(config, setResult.token || token, slot);

    return NextResponse.json({
      ok: true,
      message: `${product?.name || "Tap"} adjusted to ${adjustment.targetPercent}% (${Math.round(adjustment.targetOunces * 10) / 10} oz).`,
      product: product ? { plu: Number(product.plu || requestedPlu), name: product.name || "" } : null,
      slot,
      before: {
        percent: adjustment.currentPercent,
        ounces: Math.round(adjustment.currentOunces * 10) / 10,
      },
      after: {
        percent: adjustment.targetPercent,
        rawPercent: adjustment.targetRawPercent,
        ounces: Math.round(adjustment.targetOunces * 10) / 10,
        deltaOunces: Math.round(adjustment.deltaOunces * 10) / 10,
      },
      setPath: setResult.path,
      configUpdatePath: configUpdateResult?.path || "",
      configUpdateSent: Boolean(configUpdateResult),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Could not adjust keg level.",
        attempts: error.attempts || [],
      },
      { status: 500 },
    );
  }
}

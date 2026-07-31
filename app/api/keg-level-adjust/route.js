import { NextResponse } from "next/server";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import {
  PmbKegSafetyError,
  requireKegTargetIdentity,
  requireSuccessfulKegLevelResponse,
  verifyExactKegTarget,
} from "../../../lib/pmb-keg-safety.mjs";

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
    throw new PmbKegSafetyError(`PMB authtoken failed (${auth.status})`, {
      code: "PMB_AUTH_UNAVAILABLE",
      status: 503,
    });
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

function parseAdjustmentInput(value, label, { minimum, maximum } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return { present: false, value: 0 };

  const parsed = Number(text.replace(/[$,%]/g, "").replace(/,/g, ""));
  if (
    !Number.isFinite(parsed)
    || (minimum != null && parsed < minimum)
    || (maximum != null && parsed > maximum)
  ) {
    throw new PmbKegSafetyError(
      `${label} must be a number${minimum != null && maximum != null ? ` from ${minimum} to ${maximum}` : ""}.`,
      {
        code: "PMB_KEG_ADJUSTMENT_INVALID",
        status: 400,
      },
    );
  }

  return { present: true, value: parsed };
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
  if (!fullOunces) {
    throw new PmbKegSafetyError("PMB did not return a valid keg size for that tap.", {
      code: "PMB_KEG_LEVEL_READ_FAILED",
      status: 503,
    });
  }

  const currentOunces = getCurrentOunces(level, fullOunces);
  const targetPercentInput = parseAdjustmentInput(input.targetPercent, "Target percent", {
    minimum: 0,
    maximum: 100,
  });
  const targetOuncesInput = parseAdjustmentInput(input.targetOunces, "Target ounces", {
    minimum: 0,
    maximum: fullOunces,
  });
  const deltaOuncesInput = parseAdjustmentInput(input.deltaOunces, "Ounce adjustment", {
    minimum: -fullOunces,
    maximum: fullOunces,
  });

  let targetOunces = currentOunces;
  if (targetPercentInput.present) {
    targetOunces = (targetPercentInput.value / 100) * fullOunces;
  } else if (targetOuncesInput.present) {
    targetOunces = targetOuncesInput.value;
  } else if (deltaOuncesInput.present && deltaOuncesInput.value !== 0) {
    targetOunces = clamp(currentOunces + deltaOuncesInput.value, 0, fullOunces);
  } else {
    throw new PmbKegSafetyError("Enter ounces to add/remove or a target percent.", {
      code: "PMB_KEG_ADJUSTMENT_REQUIRED",
      status: 400,
    });
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
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new PmbKegSafetyError("A JSON object is required to adjust a keg level.", {
        code: "PMB_TAP_TARGET_REQUIRED",
        status: 400,
      });
    }
    const requestedTarget = requireKegTargetIdentity({
      plu: input.plu,
      deviceId: input.deviceId || input.device_id,
      lineNum: input.lineNum || input.line_num,
    });
    const config = getConfig();
    const token = await getAuthtoken(config);

    const levelResult = await postJson(
      config.baseUrl,
      "/api/getkeglevels",
      {
        device_id: requestedTarget.deviceId,
        line_num: requestedTarget.lineNum,
      },
      token,
    );
    const level = requireSuccessfulKegLevelResponse(levelResult, requestedTarget);

    // This management-page read is deliberately performed after the level read
    // and directly before setkeglevels. A stale browser target must never be
    // allowed to select a different product or physical line.
    const tapConfigRows = await getTapConfigRows(config).catch((error) => {
      throw new PmbKegSafetyError(
        `Live PMB tap configuration could not be verified: ${error.message || "tap configuration unavailable"}`,
        {
          code: "PMB_TAP_CONFIG_UNAVAILABLE",
          status: 503,
        },
      );
    });
    const slot = verifyExactKegTarget(tapConfigRows, requestedTarget);
    const product = {
      plu: requestedTarget.plu,
      name: slot.product || "",
    };

    const adjustment = buildAdjustment(input, level);
    const setResult = await setKegLevel(config, token, slot, level, adjustment);
    const configUpdateResult = input.sendConfigUpdate === false
      ? null
      : await sendTargetedConfigUpdate(config, setResult.token || token, slot);

    return NextResponse.json({
      ok: true,
      message: `${product.name || "Tap"} adjusted to ${adjustment.targetPercent}% (${Math.round(adjustment.targetOunces * 10) / 10} oz).`,
      product,
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
    const status = Number(error?.status)
      || (error instanceof SyntaxError ? 400 : 500);
    return NextResponse.json(
      {
        error: error.message || "Could not adjust keg level.",
        code: error?.code || "PMB_KEG_LEVEL_ADJUST_FAILED",
        attempts: error.attempts || [],
      },
      { status },
    );
  }
}

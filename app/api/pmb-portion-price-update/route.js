import { NextResponse } from "next/server";

import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import {
  buildTargetedPmbConfigUpdatePayload,
  isSuccessfulPmbConfigUpdateStatus,
} from "../../../lib/pmb-config-update.mjs";
import {
  preparePmbPortionManagementEdits,
  savePmbPortionManagementEdit,
} from "../../../lib/pmb-item-management.mjs";
import { parsePmbJson } from "../../../lib/pmb-json.mjs";
import {
  validatePmbPortionPriceUpdateInput,
  verifyPmbPortionItems,
  verifyPmbPortionReadback,
  verifyPmbPortionTarget,
} from "../../../lib/pmb-portion-price-update.mjs";
import { resolvePmbPortionSchema } from "../../../lib/pmb-portion-schema.mjs";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const REQUEST_TIMEOUT_MS = 15_000;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getConfig() {
  const baseUrl = clean(process.env.PMB_API_BASE_URL).replace(/\/$/, "");
  const username = clean(process.env.PMB_API_USERNAME);
  const password = clean(process.env.PMB_API_PASSWORD);
  if (!baseUrl) throw Object.assign(new Error("Missing PMB_API_BASE_URL in .env.local"), { status: 500 });
  if (!username || !password) {
    throw Object.assign(new Error("Missing PMB_API_USERNAME or PMB_API_PASSWORD in .env.local"), { status: 500 });
  }
  return {
    baseUrl,
    username,
    password,
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: clean(process.env.PMB_API_CLIENT_NAME || "PourMyBeer API"),
  };
}

async function postJson(config, path, body, token = "") {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  return { status: response.status, json: parsePmbJson(raw), raw };
}

async function getAuthtoken(config) {
  const result = await postJson(config, "/api/authtoken", {
    username: config.username,
    password: config.password,
    id: config.clientId,
    name: config.clientName,
    type: "json-server-control",
    version: 1,
  });
  if (result.status !== 200 || !result.json?.authtoken) {
    throw Object.assign(new Error(`PMB authtoken failed (${result.status || 0})`), { status: 503 });
  }
  return String(result.json.authtoken);
}

async function getItemList(config, token) {
  const result = await postJson(config, "/api/itemlist", { id: String(config.clientId) }, token);
  if (result.status !== 200 || !Array.isArray(result.json?.itemlist)) {
    throw Object.assign(new Error(`PMB itemlist failed (${result.status || 0})`), { status: 503 });
  }
  return result.json.itemlist;
}

async function refreshDevice(config, token, deviceId) {
  const attempts = [];
  const payload = buildTargetedPmbConfigUpdatePayload(config.clientId, deviceId);
  for (const path of ["/api/configupdate", "/m2m/api/configupdate"]) {
    try {
      const result = await postJson(config, path, payload, token);
      attempts.push({ path, status: result.status });
      if (isSuccessfulPmbConfigUpdateStatus(result.status)) {
        return { deviceId, ok: true, path, status: result.status, attempts };
      }
    } catch {
      attempts.push({ path, status: 0 });
    }
  }
  const last = attempts[attempts.length - 1];
  return { deviceId, ok: false, path: last?.path || "", status: last?.status || 0, attempts };
}

async function rollbackSavedEdits(config, saved) {
  const results = [];
  for (const descriptor of [...saved].reverse()) {
    try {
      await savePmbPortionManagementEdit(config, descriptor, { rollback: true });
      results.push({ itemId: descriptor.target.itemId, ok: true });
    } catch (error) {
      results.push({ itemId: descriptor.target.itemId, ok: false, code: error.code || "PMB_PORTION_ROLLBACK_FAILED" });
    }
  }
  return results;
}

function dollars(raw, dp) {
  return `$${(Number(raw) / (10 ** Number(dp))).toFixed(2)}`;
}

export async function POST(request) {
  let role;
  try {
    role = await requireDashboardRequestRole(request, { owner: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Owner login required.", code: error?.code || "OWNER_REQUIRED" },
      { status: error?.status || 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const priceRequest = validatePmbPortionPriceUpdateInput(await request.json());
    const config = getConfig();
    const token = await getAuthtoken(config);
    const [tapRows, itemRows] = await Promise.all([
      getTapConfigRows(config),
      getItemList(config, token),
    ]);
    const schemaState = resolvePmbPortionSchema(itemRows);
    if (!schemaState.ok) {
      throw Object.assign(new Error(schemaState.message), { code: schemaState.code, status: 503 });
    }

    const { affectedAssignments } = verifyPmbPortionTarget(tapRows, priceRequest);
    verifyPmbPortionItems(itemRows, priceRequest, schemaState.schema);
    const descriptors = await preparePmbPortionManagementEdits(
      config,
      itemRows,
      priceRequest,
      schemaState.schema,
    );
    const changedIds = new Set(priceRequest.portions
      .filter((portion) => portion.newPriceRaw !== portion.expectedPriceRaw)
      .map((portion) => portion.itemId));
    const changedDescriptors = descriptors.filter((descriptor) => changedIds.has(descriptor.target.itemId));
    const saved = [];
    try {
      for (const descriptor of changedDescriptors) {
        await savePmbPortionManagementEdit(config, descriptor);
        saved.push(descriptor);
      }
      verifyPmbPortionReadback(await getItemList(config, token), priceRequest, schemaState.schema);
    } catch (error) {
      const rollback = await rollbackSavedEdits(config, saved);
      const rollbackComplete = rollback.every((result) => result.ok);
      throw Object.assign(new Error(
        rollbackComplete
          ? `${error.message || "PMB could not verify both shot prices."} The attempted changes were rolled back.`
          : `${error.message || "PMB could not verify both shot prices."} Automatic rollback needs manager attention.`,
      ), {
        code: rollbackComplete ? (error.code || "PMB_PORTION_SAVE_FAILED") : "PMB_PORTION_ROLLBACK_FAILED",
        status: 502,
        details: { rollbackComplete, rollback },
      });
    }

    const deviceIds = [...new Set(affectedAssignments.map((assignment) => assignment.deviceId))];
    const configRefreshes = await Promise.all(deviceIds.map((deviceId) => refreshDevice(config, token, deviceId)));
    const failedRefreshes = configRefreshes.filter((result) => !result.ok);
    const changed = priceRequest.portions.filter((portion) => portion.newPriceRaw !== portion.expectedPriceRaw);
    const tapNumbers = affectedAssignments.map((assignment) => assignment.tapNumber).filter(Boolean);
    recordDashboardActivity({
      area: "Pricing",
      action: "updated PMB shot prices",
      role,
      revision: 0,
      summary: `${priceRequest.identity.name}; ${changed.map((portion) => `${portion.name} ${dollars(portion.expectedPriceRaw, portion.priceDp)}→${dollars(portion.newPriceRaw, portion.priceDp)}`).join(", ")}; tap${tapNumbers.length === 1 ? "" : "s"} ${tapNumbers.join(", ")}.`,
    }).catch(() => {});

    const warning = failedRefreshes.length
      ? `Both shot prices were verified in PMB, but wall refresh failed for device${failedRefreshes.length === 1 ? "" : "s"} ${failedRefreshes.map((item) => item.deviceId).join(", ")}.`
      : "";
    return NextResponse.json({
      ok: true,
      message: `${priceRequest.identity.name} shot prices were verified in Pour My Beer.`,
      product: {
        plu: priceRequest.identity.plu,
        name: priceRequest.identity.name,
        portions: priceRequest.portions.map((portion) => ({
          itemId: portion.itemId,
          name: portion.name,
          quantityOz: portion.quantityOz,
          previousPrice: portion.expectedPriceRaw / (10 ** portion.priceDp),
          price: portion.newPriceRaw / (10 ** portion.priceDp),
        })),
      },
      affectedAssignments,
      configRefreshes,
      configUpdateComplete: failedRefreshes.length === 0,
      warning,
      warnings: warning ? [warning] : [],
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({
      error: error?.message || "Could not update the PMB shot prices. No unverified price was left in place.",
      code: error?.code || "PMB_PORTION_PRICE_UPDATE_FAILED",
      ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
    }, { status: Number(error?.status) || 502, headers: NO_STORE_HEADERS });
  }
}

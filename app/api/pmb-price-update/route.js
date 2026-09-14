import {
  getConfig,
  postJson,
  getAuthtoken,
  getProductList,
  digestRequest,
  urlEncodedBody,
  openProductEditForm,
  saveProductEditForm,
} from "../../../lib/pmb-product-management.mjs";
import { NextResponse } from "next/server";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import {
  buildTargetedPmbConfigUpdatePayload,
  isSuccessfulPmbConfigUpdateStatus,
} from "../../../lib/pmb-config-update.mjs";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import {
  buildPmbPriceOnlyEditEntries,
  getUniquePmbProduct,
  validatePmbPriceUpdateInput,
  verifyPmbPriceReadback,
  verifyPmbPriceTarget,
} from "../../../lib/pmb-price-update.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function refreshDevice(config, token, deviceId) {
  const attempts = [];
  const request = urlEncodedBody([
    ["fd_device_id", String(deviceId)],
    ["fd_do_sendconfigupdate", "config update"],
  ]);
  try {
    const result = await digestRequest(config, "POST", "/pages/tapconfig", request.body, request.headers);
    attempts.push({ path: "/pages/tapconfig", status: result.status });
    if (isSuccessfulPmbConfigUpdateStatus(result.status)) {
      return { deviceId, ok: true, path: "/pages/tapconfig", status: result.status, attempts };
    }
  } catch {
    attempts.push({ path: "/pages/tapconfig", status: 0 });
  }

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

function dollars(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export async function POST(request) {
  let role;
  try {
    // Authentication deliberately happens before JSON parsing or any PMB access.
    role = await requireDashboardRequestRole(request, { owner: true });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Owner login required.", code: error.code || "OWNER_REQUIRED" },
      { status: error.status || 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const input = await request.json();
    const priceRequest = validatePmbPriceUpdateInput(input);
    const config = getConfig();
    const token = await getAuthtoken(config);
    const [tapRows, products] = await Promise.all([
      getTapConfigRows(config),
      getProductList(config, token),
    ]);
    const { affectedAssignments } = verifyPmbPriceTarget(tapRows, priceRequest);
    const currentProduct = getUniquePmbProduct(products, priceRequest);

    const editForm = await openProductEditForm(config, priceRequest.identity.plu);
    const editEntries = buildPmbPriceOnlyEditEntries(editForm.html, {
      plu: priceRequest.identity.plu,
      currentPriceCents: priceRequest.expectedCurrentPriceCents,
      newPriceCents: priceRequest.newPriceCents,
    });
    await saveProductEditForm(config, editEntries, editForm.cookieJar);

    const savedProduct = verifyPmbPriceReadback(await getProductList(config, token), {
      plu: priceRequest.identity.plu,
      newPriceCents: priceRequest.newPriceCents,
    });

    const deviceIds = [...new Set(affectedAssignments.map((assignment) => assignment.deviceId))];
    const refreshResults = await Promise.all(deviceIds.map(async (deviceId) => {
      try {
        return await refreshDevice(config, token, deviceId);
      } catch {
        return { deviceId, ok: false, status: 0 };
      }
    }));
    const failedRefreshes = refreshResults.filter((result) => !result.ok);
    const warnings = [];
    if (affectedAssignments.length > 1) {
      warnings.push(`PMB PLU ${priceRequest.identity.plu} is shared; the verified price applies to ${affectedAssignments.length} live taps.`);
    }
    if (failedRefreshes.length) {
      warnings.push(`The price was verified in PMB, but wall refresh failed for device${failedRefreshes.length === 1 ? "" : "s"} ${failedRefreshes.map((item) => item.deviceId).join(", ")}.`);
    }

    const affectedTaps = affectedAssignments.map((assignment) => assignment.tapNumber).filter(Boolean);
    recordDashboardActivity({
      area: "Pricing",
      action: "updated PMB price",
      role,
      revision: 0,
      summary: `${clean(savedProduct.name || currentProduct.name)} ${dollars(priceRequest.expectedCurrentPriceCents)}→${dollars(priceRequest.newPriceCents)}/oz; tap${affectedTaps.length === 1 ? "" : "s"} ${affectedTaps.join(", ")}.`,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      message: `${clean(savedProduct.name || currentProduct.name)} was verified at ${dollars(priceRequest.newPriceCents)} per ounce in Pour My Beer.`,
      product: {
        plu: priceRequest.identity.plu,
        name: clean(savedProduct.name || currentProduct.name),
        kind: priceRequest.kind,
        previousPricePerOz: priceRequest.expectedCurrentPriceCents / 100,
        pricePerOz: priceRequest.newPriceCents / 100,
      },
      affectedAssignments,
      configRefreshes: refreshResults,
      configUpdateComplete: failedRefreshes.length === 0,
      warning: warnings.join(" "),
      warnings,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({
      error: error.message || "Could not update the PMB price.",
      code: error.code || "PMB_PRICE_UPDATE_FAILED",
      ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
    }, { status: Number(error.status) || 502, headers: NO_STORE_HEADERS });
  }
}

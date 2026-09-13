import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import { buildVerifiedKegSlotMap } from "../../../lib/pmb-keg-safety.mjs";
import { parsePmbJson } from "../../../lib/pmb-json.mjs";
import { findFirstPourInRange, findFirstPoursForTaps, getFirstPourWindow } from "../../../lib/pmb-first-pour-report.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store" };
let runningReports = 0;

export async function GET(request) {
  let claimed = false;
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const params = new URL(request.url).searchParams;
    const allTaps = params.get("tap") === "all";
    const tapNumber = Number(params.get("tap"));
    const startDate = params.get("startDate");
    const endDate = params.get("endDate");
    if (!allTaps && (!Number.isSafeInteger(tapNumber) || tapNumber < 1 || tapNumber > 250)) {
      throw Object.assign(new Error("Choose a valid tap number."), { status: 422 });
    }
    getFirstPourWindow(startDate, endDate);
    if (runningReports >= 2) {
      throw Object.assign(new Error("PMB history searches are busy. Try again shortly."), { status: 429 });
    }
    runningReports += 1;
    claimed = true;
    const config = {
      baseUrl: String(process.env.PMB_API_BASE_URL || "").trim().replace(/\/$/, ""),
      username: String(process.env.PMB_API_USERNAME || "").trim(),
      password: String(process.env.PMB_API_PASSWORD || "").trim(),
      clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
      clientName: String(process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
    };
    if (!config.baseUrl || !config.username || !config.password) {
      throw Object.assign(new Error("The PMB report connection is not configured."), { status: 503 });
    }
    const deadline = AbortSignal.timeout(75000);
    async function post(path, body, token = "") {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.any([deadline, request.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw Object.assign(new Error(`PMB report read failed (${response.status}).`), { status: 502 });
      const result = parsePmbJson(await response.text());
      if (!result) throw Object.assign(new Error("PMB returned an unreadable report."), { status: 502 });
      return result;
    }
    const auth = await post("/api/authtoken", {
      username: config.username, password: config.password, id: config.clientId,
      name: config.clientName, type: "json-server-control", version: 1,
    });
    if (!auth.authtoken) throw Object.assign(new Error("PMB report authentication failed."), { status: 502 });
    const taps = [...buildVerifiedKegSlotMap(await getTapConfigRows(config, { timeoutMs: 5000 })).values()];
    const target = taps.find((tap) => Number(tap.tapNumber) === tapNumber);
    if (!allTaps && !target) throw Object.assign(new Error("PMB did not return that tap's current product assignment."), { status: 404 });
    const findReport = allTaps ? findFirstPoursForTaps : findFirstPourInRange;
    const result = await findReport({
      target, targets: taps, startDate, endDate,
      readTransactions: async (range) => {
        const report = await post("/api/transactions", { id: config.clientId, ...range }, auth.authtoken);
        return report.taptransactions;
      },
    });
    return NextResponse.json({ ...result, capturedAt: new Date().toISOString() }, { headers: responseHeaders });
  } catch (error) {
    const status = Number(error.status) || 502;
    return NextResponse.json({ error: error.name === "TimeoutError" || error.name === "AbortError"
      ? "PMB history search timed out. Try a shorter date range."
      : error.message || "The PMB first-pour report could not be read." }, { status, headers: responseHeaders });
  } finally {
    if (claimed) runningReports -= 1;
  }
}

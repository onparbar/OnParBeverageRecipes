import { NextResponse } from "next/server";

import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { validatePmbPortionPriceUpdateInput } from "../../../lib/pmb-portion-price-update.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function POST(request) {
  try {
    // Authentication deliberately happens before request parsing and before
    // any future PMB access is added to this endpoint.
    await requireDashboardRequestRole(request, { owner: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Owner login required.", code: error?.code || "OWNER_REQUIRED" },
      { status: error?.status || 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    validatePmbPortionPriceUpdateInput(await request.json());
    return NextResponse.json({
      error: "Live shot-price saves are locked until the on-site PMB item form and its two stable portion controls are verified. No price was changed.",
      code: "PMB_PORTION_FORM_UNVERIFIED",
    }, { status: 503, headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({
      error: error?.message || "The shot-price request was invalid. No price was changed.",
      code: error?.code || "PMB_PORTION_PRICE_INVALID",
      ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
    }, { status: Number(error?.status) || 400, headers: NO_STORE_HEADERS });
  }
}

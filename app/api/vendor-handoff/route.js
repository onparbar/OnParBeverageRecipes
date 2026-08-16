import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { getVendorHandoffConfig } from "../../../lib/vendor-handoff-config.mjs";

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Owner access required." },
      { status: Number(error?.status) || 401 },
    );
  }

  const vendor = new URL(request.url).searchParams.get("vendor");
  const config = getVendorHandoffConfig(vendor);

  if (!config?.externalUrl) {
    return NextResponse.json(
      { error: "That vendor handoff is not available." },
      { status: 400 },
    );
  }

  return NextResponse.redirect(config.externalUrl, 307);
}

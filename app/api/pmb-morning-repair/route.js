import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readPmbMorningRepairStatus } from "../../../lib/pmb-morning-repair.mjs";

export const runtime = "nodejs";

// Status only: there is deliberately no HTTP action to run the scheduled repair.
export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    return NextResponse.json(await readPmbMorningRepairStatus(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Morning repair status unavailable." }, {
      status: Number(error.status) || 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

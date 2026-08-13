import { NextResponse } from "next/server";
import { getDashboardBuildInfo } from "../../../lib/dashboard-build-info.mjs";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getDashboardBuildInfo(), {
    headers: { "Cache-Control": "no-store" },
  });
}

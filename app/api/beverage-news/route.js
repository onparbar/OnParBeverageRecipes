import { NextResponse } from "next/server";

import {
  createBeverageNewsService,
  loadBeverageNews,
} from "../../../lib/beverage-news.mjs";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const beverageNewsService = createBeverageNewsService({ loader: loadBeverageNews });
const ohioComplianceService = createBeverageNewsService({
  loader: ({ now }) => loadBeverageNews({ now, officialOnly: true }),
});

export async function GET(request) {
  try {
    // Authenticate before reading the cache or making any outbound request.
    await requireDashboardRequestRole(request, { owner: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error?.message || "Owner login required.",
        code: error?.code || "OWNER_REQUIRED",
      },
      { status: error?.status || 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const requestUrl = new URL(request.url);
  const force = requestUrl.searchParams.get("refresh") === "1";
  const service = requestUrl.searchParams.get("scope") === "compliance"
    ? ohioComplianceService
    : beverageNewsService;
  const payload = await service.get({ force });
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}

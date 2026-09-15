import { NextResponse } from "next/server";
import { requireDashboardRequestIdentity } from "../../../lib/dashboard-auth.mjs";
import { addWeeklyPrepCocktail, readWeeklyPrepChoices, subtractWeeklyPrepCocktail } from "../../../lib/weekly-prep-additions.mjs";

export const runtime = "nodejs";

const respond = (body, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
});

async function requireOwner(request) {
  const identity = await requireDashboardRequestIdentity(request);
  if (identity.role !== "owner") {
    const error = new Error("A manager must add cocktails to the prep plan.");
    error.status = 403;
    throw error;
  }
  return identity;
}

export async function GET(request) {
  try {
    await requireOwner(request);
    return respond(await readWeeklyPrepChoices());
  } catch (error) {
    return respond({ error: error.message || "The cocktail list could not be loaded." }, error.status || 500);
  }
}

export async function POST(request) {
  try {
    const identity = await requireOwner(request);
    if (request.headers.get("sec-fetch-site") === "cross-site") return respond({ error: "Open the dashboard to add prep." }, 403);
    let body;
    try { body = await request.json(); } catch { return respond({ error: "The prep details are invalid." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "The prep details are invalid." }, 400);
    return respond(await (body.action === "subtract" ? subtractWeeklyPrepCocktail(body, identity) : addWeeklyPrepCocktail(body, identity)));
  } catch (error) {
    return respond({ error: error.message || "The cocktail could not be added." }, error.status || 500);
  }
}

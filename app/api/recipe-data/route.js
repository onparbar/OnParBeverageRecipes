import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { sanitizeEmployeeRecipeCsv } from "../../../lib/employee-recipe-data.mjs";
import {
  projectSharedDashboardStateForRole,
  readSharedDashboardState,
} from "../../../lib/shared-dashboard-store.mjs";

export const runtime = "nodejs";

const FILES = Object.freeze({
  active: "cocktail-recipes.csv",
  new: "new-cocktails.csv",
});

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Login required." },
      { status: error?.status || 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return NextResponse.json(
      { error: "Recipe data request is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const set = requestUrl.searchParams.get("set") || "";
  if (set === "shared") {
    try {
      const projected = projectSharedDashboardStateForRole(
        await readSharedDashboardState(),
        "employee",
      );
      return NextResponse.json(
        {
          initialized: projected.initialized,
          updatedAt: projected.updatedAt,
          recipes: projected.data.recipes,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            Vary: "Cookie",
          },
        },
      );
    } catch {
      return NextResponse.json(
        { error: "Shared recipe updates are unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const filename = FILES[set];
  if (!filename) {
    return NextResponse.json(
      { error: "Recipe data set must be active or new." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const source = await readFile(path.join(process.cwd(), "public", "data", filename), "utf8");
    return new NextResponse(sanitizeEmployeeRecipeCsv(source), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "text/csv; charset=utf-8",
        Vary: "Cookie",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Recipe data is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

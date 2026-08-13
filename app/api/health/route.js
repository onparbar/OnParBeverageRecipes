import { NextResponse } from "next/server";
import { buildDashboardHealth } from "../../../lib/dashboard-health.mjs";

export const runtime = "nodejs";

const DEEP_HEALTH_CACHE_MS = 30_000;
const healthCheckCache = new Map();

function wantsDeepCheck(request) {
  const value = new URL(request.url).searchParams.get("deep");
  return value === "1" || value === "true";
}

function wantsStorageCheck(request) {
  const value = new URL(request.url).searchParams.get("storage");
  return value === "1" || value === "true";
}

export async function GET(request) {
  const deep = wantsDeepCheck(request);
  const storage = wantsStorageCheck(request);
  const cacheKey = `${deep ? "deep" : "shallow"}:${storage || deep ? "storage" : "config"}`;
  let health;

  const cached = healthCheckCache.get(cacheKey);
  if ((deep || storage) && cached?.expiresAt > Date.now()) {
    health = cached.health;
  } else {
    health = await buildDashboardHealth({ deep, storage });
    if (deep || storage) {
      healthCheckCache.set(cacheKey, {
        expiresAt: Date.now() + DEEP_HEALTH_CACHE_MS,
        health,
      });
    }
  }

  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

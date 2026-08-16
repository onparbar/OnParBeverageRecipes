import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readParAgentState } from "../../../lib/par-agent.mjs";
import { readPmbLevelSnapshot } from "../../../lib/pmb-level-snapshot-store.mjs";
import {
  getCanonicalTapKey,
  isRetiredProduct,
  resolveCanonicalTap,
} from "../../../public/canonical-tap-resolution.mjs";

export const runtime = "nodejs";

const WALLS = [
  { key: "main", label: "Main", firstTap: 21, lastTap: 72 },
  { key: "patio", label: "Patio", firstTap: 1, lastTap: 20 },
  { key: "karaoke", label: "Karaoke", firstTap: 73, lastTap: 102 },
];

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
}

function clean(value) {
  return String(value || "").trim();
}

function getWall(tapNumber) {
  return WALLS.find((wall) => tapNumber >= wall.firstTap && tapNumber <= wall.lastTap);
}

function getOnDeck(overrides, recommendations, wall, tapNumber) {
  const prefix = `${getCanonicalTapKey(wall.key, tapNumber)}-`;
  const override = Object.entries(overrides || {}).find(([key]) => clean(key).toLowerCase().startsWith(prefix))?.[1];
  if (override) {
    const name = clean(override.name || override.product || override.comingSoonName);
    return isRetiredProduct({ name }) ? "" : name;
  }
  const recommendation = recommendations.find((item) => Number(item?.tapNumber) === tapNumber);
  const name = clean(recommendation?.onDeckProduct || recommendation?.onDeckName || recommendation?.replacementProduct);
  return isRetiredProduct({ name }) ? "" : name;
}

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request);
    const [snapshotResult, stateResult] = await Promise.allSettled([
      readPmbLevelSnapshot(),
      readParAgentState(),
    ]);
    if (snapshotResult.status !== "fulfilled" || !snapshotResult.value?.items?.length) {
      return jsonResponse({ available: false, updatedAt: "", walls: [], message: "Tap sheets are unavailable until tap levels sync." });
    }

    const snapshot = snapshotResult.value;
    const state = stateResult.status === "fulfilled" ? stateResult.value : null;
    const recommendations = Array.isArray(state?.recommendations?.items) ? state.recommendations.items : [];
    const rows = snapshot.items.map((item) => {
      const tapNumber = Number(item?.tapNumber);
      const wall = getWall(tapNumber);
      if (!wall) return null;
      const resolved = resolveCanonicalTap({
        physicalTapId: getCanonicalTapKey(wall.key, tapNumber),
        wall: wall.key,
        tapNumber,
        snapshot: {
          verified: true,
          productName: item?.name || item?.tapProduct || item?.product,
          internalProductId: item?.productId || item?.plu,
          updatedAt: snapshot.updatedAt,
          level: item?.fillLevelPercent,
        },
      });
      return {
        tapNumber,
        wall: wall.key,
        product: clean(resolved.product?.name) || "Unassigned",
        onDeck: state ? getOnDeck(state.onDeckOverrides, recommendations, wall, tapNumber) : null,
        source: resolved.source,
        sourceTimestamp: resolved.sourceTimestamp,
        confidence: resolved.confidence,
        blockingIssue: resolved.blockingIssue,
      };
    }).filter(Boolean);

    return jsonResponse({
      available: true,
      updatedAt: clean(snapshot.updatedAt),
      onDeckAvailable: Boolean(state),
      walls: WALLS.map((wall) => ({
        key: wall.key,
        label: wall.label,
        items: rows.filter((item) => item.wall === wall.key).sort((a, b) => a.tapNumber - b.tapNumber),
      })),
      message: "",
    });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Tap sheets could not be loaded." }, error?.status || 500);
  }
}

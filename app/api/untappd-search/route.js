import { NextResponse } from "next/server";
import {
  buildUntappdSearchResults,
  normalizeUntappdItem,
} from "../../../lib/untappd-search.mjs";

export const runtime = "nodejs";

const UNTAPPD_API_BASE_URL = "https://business.untappd.com/api/v1";
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

let catalogCache = {
  cacheKey: "",
  expiresAt: 0,
  items: [],
};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getUntappdConfig() {
  const email = clean(process.env.UNTAPPD_BUSINESS_EMAIL);
  const token = clean(process.env.UNTAPPD_BUSINESS_API_TOKEN);
  if (!email || !token) {
    throw new Error("Untappd Business credentials are not configured.");
  }
  return { email, token };
}

async function fetchUntappd(path, config) {
  const response = await fetch(`${UNTAPPD_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`,
      Accept: "application/json",
      "User-Agent": "OnParBeverageDashboard/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = clean(payload?.error?.detail || payload?.error?.title || payload?.error || text);
    throw new Error(`Untappd request failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  return payload;
}

async function fetchSectionItems(section, menu, config) {
  const payload = await fetchUntappd(`/sections/${section.id}/items`, config);
  return (payload.items || []).map((item) => normalizeUntappdItem(item, {
    carried: true,
    menuName: menu.name,
    sectionName: section.name,
  }));
}

async function fetchMenuItems(menu, config) {
  const payload = await fetchUntappd(`/menus/${menu.id}/sections?include_on_deck_section=true`, config);
  const sections = payload.sections || [];
  return (await Promise.all(
    sections.map((section) => fetchSectionItems(section, menu, config)),
  )).flat();
}

async function getAccountCatalog(config) {
  const cacheKey = config.email.toLowerCase();
  if (
    catalogCache.cacheKey === cacheKey
    && catalogCache.expiresAt > Date.now()
    && catalogCache.items.length
  ) {
    return catalogCache.items;
  }

  const locationPayload = await fetchUntappd("/locations", config);
  const locations = locationPayload.locations || [];
  const menuGroups = await Promise.all(
    locations.map(async (location) => {
      const menuPayload = await fetchUntappd(`/locations/${location.id}/menus`, config);
      return menuPayload.menus || [];
    }),
  );
  const items = (await Promise.all(
    menuGroups.flat().map((menu) => fetchMenuItems(menu, config)),
  )).flat();

  catalogCache = {
    cacheKey,
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
    items,
  };
  return items;
}

async function searchGlobalBeerCatalog(query, config) {
  const payload = await fetchUntappd(`/items/search?q=${encodeURIComponent(query)}`, config);
  return payload.items || [];
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = clean(searchParams.get("q"));
    const kind = clean(searchParams.get("kind")).toLowerCase();

    if (query.length < 2) {
      return NextResponse.json({ error: "Enter at least two characters to search Untappd." }, { status: 400 });
    }
    if (!["beer", "liquor"].includes(kind)) {
      return NextResponse.json({ error: "Search kind must be beer or liquor." }, { status: 400 });
    }

    const config = getUntappdConfig();
    const [globalItems, catalogItems] = await Promise.all([
      kind === "beer" ? searchGlobalBeerCatalog(query, config) : Promise.resolve([]),
      kind === "liquor" ? getAccountCatalog(config) : Promise.resolve([]),
    ]);
    const items = buildUntappdSearchResults({
      globalItems,
      catalogItems,
      query,
      kind,
      limit: 10,
    });

    return NextResponse.json({
      query,
      kind,
      source: kind === "beer" ? "Untappd beer database" : "On Par Untappd menus",
      items,
    });
  } catch (error) {
    const message = error.message || "Untappd search failed.";
    const status = /credentials are not configured/i.test(message) ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

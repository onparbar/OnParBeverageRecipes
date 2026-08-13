import { NextResponse } from "next/server";
import sharp from "sharp";
import { fetchRemoteBuffer } from "../../../lib/safe-remote-fetch.mjs";

const IMAGE_WIDTH = 676;
const IMAGE_HEIGHT = 540;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const REMOTE_TEXT_MAX_BYTES = 2 * 1024 * 1024;
const SAFE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/apng"];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  let decoded = clean(value);
  for (let index = 0; index < 3; index += 1) {
    const next = decoded
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#0?39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&rsquo;/gi, "'")
      .replace(/&lsquo;/gi, "'")
      .replace(/&rdquo;/gi, "\"")
      .replace(/&ldquo;/gi, "\"")
      .replace(/&trade;/gi, "™")
      .replace(/&reg;/gi, "®")
      .replace(/&copy;/gi, "©")
      .replace(/&ndash;/gi, "-")
      .replace(/&mdash;/gi, "-")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
    if (next === decoded) break;
    decoded = next;
  }
  return clean(decoded);
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

async function fetchText(url) {
  const response = await fetchRemoteBuffer(url, {
    acceptedContentTypes: ["text/html", "application/xhtml+xml"],
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OnParBeverageDashboard/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
    maxBytes: REMOTE_TEXT_MAX_BYTES,
    timeoutMs: 10_000,
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
  return response.text();
}

async function fetchImageBuffer(url) {
  const response = await fetchRemoteBuffer(url, {
    acceptedContentTypes: SAFE_IMAGE_TYPES,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 OnParBeverageDashboard/1.0",
      Accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif",
    },
    maxBytes: IMAGE_SOURCE_MAX_BYTES,
    timeoutMs: 10_000,
  });
  if (!response.ok) throw new Error(`Image fetch failed ${response.status}`);
  return response.buffer;
}

function extractDuckDuckGoResults(html) {
  const results = [];
  const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) && results.length < 10) {
    const rawUrl = decodeHtml(match[1]);
    const url = normalizeDuckDuckGoUrl(rawUrl);
    if (!url || results.some((item) => item.url === url)) continue;
    results.push({
      url,
      title: stripTags(match[2]),
      snippet: stripTags(match[3]),
    });
  }

  return results;
}

function normalizeDuckDuckGoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    const url = uddg ? new URL(uddg) : parsed;
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function getMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1]);
    }
  }
  return "";
}

function getTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function toAbsoluteUrl(url, baseUrl) {
  try {
    return new URL(decodeHtml(url), baseUrl).toString();
  } catch {
    return "";
  }
}

function simplifyDescription(description, fallback = "") {
  const text = decodeHtml(description || fallback)
    .replace(/\s*\|\s*[^|]+$/g, "")
    .replace(/\s+-\s+[^-]+$/g, "");
  if (text.length <= 360) return text;
  return `${text.slice(0, 357).replace(/\s+\S*$/, "")}...`;
}

async function normalizeImage(rawImageUrl, baseUrl) {
  const imageUrl = toAbsoluteUrl(rawImageUrl, baseUrl);
  if (!imageUrl) return null;

  try {
    const input = await fetchImageBuffer(imageUrl);
    for (const quality of [86, 78, 70, 62, 54]) {
      const output = await sharp(input, { animated: false, limitInputPixels: 40_000_000 })
        .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: "cover", position: "center" })
        .withMetadata({ density: 72 })
        .jpeg({ quality, progressive: true })
        .toBuffer();
      if (output.byteLength <= IMAGE_MAX_BYTES) {
        return {
          originalImageUrl: imageUrl,
          imageUrl: `data:image/jpeg;base64,${output.toString("base64")}`,
          imageWidth: IMAGE_WIDTH,
          imageHeight: IMAGE_HEIGHT,
          imageBytes: output.byteLength,
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function isBadDescription(value) {
  const text = clean(value).toLowerCase();
  return (
    !text ||
    text.length < 35 ||
    /^products archive$/i.test(text) ||
    /copyright|©|all rights reserved|enable cookies|attention required|access denied|shopping cart|add to cart|window\.performance|shopify|content_for_header/i.test(text)
  );
}

function extractBodyDescription(html, query) {
  const candidates = [];
  const paragraphPattern = /<(?:p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/(?:p|h1|h2|h3|li)>/gi;
  let match;
  while ((match = paragraphPattern.exec(html))) {
    const text = simplifyDescription(stripTags(match[1]));
    if (isBadDescription(text)) continue;
    candidates.push(text);
  }

  const queryWords = clean(query).toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  return candidates
    .map((description) => ({
      description,
      score: scoreDescription(description, queryWords),
    }))
    .sort((a, b) => b.score - a.score)[0]?.description || "";
}

function scoreDescription(description, queryWords) {
  const text = description.toLowerCase();
  const wordScore = queryWords.reduce((score, word) => score + (text.includes(word) ? 3 : 0), 0);
  const beerScore = /\bbeer|lager|ale|ipa|pilsner|stout|porter|cider|seltzer|malt|hop|brew|abv\b/i.test(description) ? 4 : 0;
  const lengthScore = description.length >= 90 && description.length <= 280 ? 3 : 0;
  return wordScore + beerScore + lengthScore;
}

function getSourceName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function scoreItem(item, query) {
  const haystack = `${item.title} ${item.description} ${item.sourceName}`.toLowerCase();
  const queryWords = clean(query).toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const wordScore = queryWords.reduce((score, word) => score + (haystack.includes(word) ? 2 : 0), 0);
  const imageScore = item.imageUrl ? 5 : 0;
  const descriptionScore = item.description ? 4 : 0;
  const sourceScore = /official|brew|beer|garage|founders|modelo|stella|yuengling|kona|pabst/i.test(item.sourceName) ? 2 : 0;
  const penalty = /facebook|instagram|x\.com|twitter|pinterest|youtube|amazon|walmart|instacart|doordash/i.test(item.sourceName) ? -12 : 0;
  return wordScore + imageScore + descriptionScore + sourceScore + penalty;
}

async function enrichResult(result, query) {
  try {
    const html = await fetchText(result.url);
    const title = getMeta(html, ["og:title", "twitter:title"]) || getTitle(html) || result.title;
    const metaDescription = getMeta(html, ["og:description", "twitter:description", "description"]);
    const bodyDescription = extractBodyDescription(html, query);
    const description = isBadDescription(bodyDescription) ? metaDescription || result.snippet : bodyDescription;
    const rawImage = getMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    const image = await normalizeImage(rawImage, result.url);
    return {
      title: clean(title),
      description: simplifyDescription(description, result.snippet),
      imageUrl: image?.imageUrl || "",
      originalImageUrl: image?.originalImageUrl || toAbsoluteUrl(rawImage, result.url),
      imageWidth: image?.imageWidth || null,
      imageHeight: image?.imageHeight || null,
      imageBytes: image?.imageBytes || null,
      sourceUrl: result.url,
      sourceName: getSourceName(result.url),
    };
  } catch {
    return {
      title: result.title,
      description: simplifyDescription(result.snippet),
      imageUrl: "",
      sourceUrl: result.url,
      sourceName: getSourceName(result.url),
    };
  }
}

export async function GET(request) {
  try {
    const query = clean(new URL(request.url).searchParams.get("q"));
    if (!query) {
      return NextResponse.json({ error: "Missing beer name." }, { status: 400 });
    }
    if (query.length > 120) {
      return NextResponse.json({ error: "Beer name is too long." }, { status: 400 });
    }

    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} beer description product official`)}`;
    const searchHtml = await fetchText(searchUrl);
    const searchResults = extractDuckDuckGoResults(searchHtml);
    const enriched = await Promise.all(searchResults.slice(0, 8).map((result) => enrichResult(result, query)));
    const items = enriched
      .filter((item) => item.imageUrl && !isBadDescription(item.description) && !/amazon|walmart|instacart|doordash/i.test(item.sourceName))
      .map((item) => ({ ...item, score: scoreItem(item, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return NextResponse.json({
      query,
      items,
      best: items[0] || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not look up beer product." },
      { status: 500 },
    );
  }
}

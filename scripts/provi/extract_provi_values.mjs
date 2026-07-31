import fs from "node:fs/promises";
import {
  agentRoot,
  alternateProviLocationNames,
  latestCapturePath,
  latestExtractPath,
  preferredProviLocationName,
} from "./paths.mjs";
import {
  extractInterestingValues,
  hardenPrivateRoot,
  hardenPrivateFile,
  safeJsonParse,
  sanitizeCapturedData,
  sanitizeCaptureEvent,
  writeJson,
} from "./utils.mjs";

async function main() {
  await hardenPrivateRoot(agentRoot);
  await hardenPrivateFile(latestCapturePath);
  const raw = await fs.readFile(latestCapturePath, "utf8");
  const payload = safeJsonParse(raw);
  if (!payload?.events) {
    throw new Error(`No valid capture file found at ${latestCapturePath}`);
  }
  const safePayload = {
    ...sanitizeCapturedData(payload),
    events: payload.events.map((event) => sanitizeCaptureEvent(event)),
  };
  // Older captures may predate redaction. Rewrite them privately before extracting.
  await writeJson(latestCapturePath, safePayload);

  const values = [];
  for (const event of safePayload.events) {
    if (event?.postData && typeof event.postData === "object") {
      extractInterestingValues(event.postData, values, ["postData"]);
    }
    if (event?.body && typeof event.body === "object") {
      extractInterestingValues(event.body, values, ["body"]);
    }
  }

  const filtered = dedupe(values).filter((entry) => {
    const text = `${entry.path} ${JSON.stringify(entry.value)}`.toLowerCase();
    return /(retailer|account|ohlq|customer|location|license|cart|checkout|on par entertainment|wild axe)/.test(text);
  });

  const result = {
    extractedAt: new Date().toISOString(),
    count: filtered.length,
    preferredLocationName: preferredProviLocationName,
    alternateLocationNames: alternateProviLocationNames,
    preferredLocationMatches: filtered.filter((entry) => JSON.stringify(entry.value).toLowerCase().includes(preferredProviLocationName.toLowerCase())),
    alternateLocationMatches: filtered.filter((entry) => alternateProviLocationNames.some((name) => JSON.stringify(entry.value).toLowerCase().includes(name.toLowerCase()))),
    values: filtered,
  };

  await writeJson(latestExtractPath, result);
  console.log(`Extracted ${filtered.length} candidate values to ${latestExtractPath}`);
}

function dedupe(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.path}:${JSON.stringify(entry.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

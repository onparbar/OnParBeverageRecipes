import { createHash } from "node:crypto";

export const OHIO_COMPLIANCE_FINGERPRINT_VERSION = "ohio-compliance-v1";
export const OHIO_COMPLIANCE_SOURCE_IDS = Object.freeze([
  "ohio-hemp-law",
  "ohio-sb86",
]);

function clean(value, maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeFactList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => clean(entry, 120)).filter(Boolean))].sort();
}

function normalizeFacts(sourceId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  if (sourceId === "ohio-hemp-law") {
    const facts = {
      effectiveDate: clean(value.effectiveDate, 60),
      latestLegislation: clean(value.latestLegislation, 140),
      lastUpdated: clean(value.lastUpdated, 60),
    };
    return Object.values(facts).some(Boolean) ? facts : null;
  }

  if (sourceId === "ohio-sb86") {
    const facts = {
      billTitle: clean(value.billTitle, 220),
      completedSteps: normalizeFactList(value.completedSteps),
      currentVersion: clean(value.currentVersion, 120),
      status: clean(value.status, 120),
    };
    return (
      facts.billTitle
      || facts.completedSteps.length
      || facts.currentVersion
      || facts.status
    ) ? facts : null;
  }

  return null;
}

function normalizeCheckedAt(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeDisplaySource(item, sourceId) {
  return {
    id: sourceId,
    title: clean(item?.title, 180),
    summary: clean(item?.summary, 360),
    status: clean(item?.status, 120),
    source: clean(item?.source, 100),
    url: clean(item?.url, 2_000),
  };
}

/**
 * Build a complete, deterministic snapshot of the official facts that matter
 * to the Ohio compliance watch. Page chrome, fetch times, and prose summaries
 * are deliberately excluded so harmless HTML edits do not create alerts.
 */
export function buildOhioComplianceSnapshot({
  regulatoryWatch = [],
  sources = [],
  checkedAt = "",
} = {}) {
  const watchItems = Array.isArray(regulatoryWatch) ? regulatoryWatch : [];
  const sourceRows = Array.isArray(sources) ? sources : [];
  const sourceStatus = new Map(
    sourceRows.map((source) => [clean(source?.id, 80), clean(source?.status, 40).toLowerCase()]),
  );
  const itemsBySource = new Map(
    watchItems.map((item) => [clean(item?.sourceId || item?.id, 80), item]),
  );

  const facts = [];
  const displaySources = [];
  const unavailableSourceIds = [];

  OHIO_COMPLIANCE_SOURCE_IDS.forEach((sourceId) => {
    const item = itemsBySource.get(sourceId);
    const normalizedFacts = normalizeFacts(sourceId, item?.complianceFacts);
    const sourceSucceeded = sourceStatus.get(sourceId) === "ok";
    if (!sourceSucceeded || !item?.isOfficial || !normalizedFacts) {
      unavailableSourceIds.push(sourceId);
      return;
    }
    facts.push({ sourceId, facts: normalizedFacts });
    displaySources.push(normalizeDisplaySource(item, sourceId));
  });

  const isComplete = unavailableSourceIds.length === 0
    && facts.length === OHIO_COMPLIANCE_SOURCE_IDS.length;
  const currentFingerprint = isComplete
    ? `${OHIO_COMPLIANCE_FINGERPRINT_VERSION}:${createHash("sha256")
      .update(JSON.stringify({ version: 1, sources: facts }))
      .digest("hex")}`
    : "";

  return {
    version: 1,
    status: isComplete ? "complete" : "unavailable",
    isComplete,
    currentFingerprint,
    checkedAt: normalizeCheckedAt(checkedAt),
    monitoredSourceIds: [...OHIO_COMPLIANCE_SOURCE_IDS],
    unavailableSourceIds,
    sources: displaySources,
  };
}

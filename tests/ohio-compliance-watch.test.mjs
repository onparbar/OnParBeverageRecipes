import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOhioComplianceSnapshot,
  OHIO_COMPLIANCE_FINGERPRINT_VERSION,
} from "../lib/ohio-compliance-watch.mjs";
import {
  buildOhioComplianceWatchViewModel,
  normalizeOhioComplianceFingerprint,
} from "../public/ohio-compliance-watch.mjs";

function officialSources() {
  return [
    { id: "ohio-hemp-law", status: "ok" },
    { id: "ohio-sb86", status: "ok" },
  ];
}

function officialWatch(overrides = {}) {
  const law = {
    id: "ohio-hemp-law",
    sourceId: "ohio-hemp-law",
    isOfficial: true,
    title: "Official Ohio hemp law (Chapter 928)",
    summary: "Current official law summary.",
    status: "Updated March 23, 2026",
    source: "Ohio Laws",
    url: "https://codes.ohio.gov/ohio-revised-code/chapter-928",
    complianceFacts: {
      effectiveDate: "March 20, 2026",
      latestLegislation: "Senate Bill 56 - 136th General Assembly",
      lastUpdated: "March 23, 2026",
    },
    ...overrides.law,
  };
  const bill = {
    id: "ohio-sb86",
    sourceId: "ohio-sb86",
    isOfficial: true,
    title: "Ohio drinkable cannabinoid bill tracker (SB 86)",
    summary: "Current official bill summary.",
    status: "Passed By Senate",
    source: "Ohio House of Representatives",
    url: "https://ohiohouse.gov/legislation/136/sb86",
    complianceFacts: {
      billTitle: "Regulate and tax intoxicating hemp, drinkable cannabinoid product",
      completedSteps: ["Introduced In Senate", "Passed By Senate"],
      currentVersion: "As Passed by the Senate",
      status: "Passed By Senate",
    },
    ...overrides.bill,
  };
  return [law, bill];
}

test("official compliance fingerprint is stable across display-only and ordering changes", () => {
  const first = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch(),
    sources: officialSources(),
    checkedAt: "2026-08-12T16:00:00.000Z",
  });
  const secondItems = officialWatch({
    law: { summary: "Reworded dashboard summary." },
    bill: {
      title: "Reworded dashboard title",
      complianceFacts: {
        billTitle: "Regulate and tax intoxicating hemp, drinkable cannabinoid product",
        completedSteps: ["Passed By Senate", "Introduced In Senate"],
        currentVersion: "As Passed by the Senate",
        status: "Passed By Senate",
      },
    },
  }).reverse();
  const second = buildOhioComplianceSnapshot({
    regulatoryWatch: secondItems,
    sources: officialSources().reverse(),
    checkedAt: "2026-08-13T16:00:00.000Z",
  });

  assert.equal(first.isComplete, true);
  assert.match(first.currentFingerprint, new RegExp(`^${OHIO_COMPLIANCE_FINGERPRINT_VERSION}:[a-f0-9]{64}$`));
  assert.equal(second.currentFingerprint, first.currentFingerprint);
});

test("a relevant official fact change produces a different fingerprint", () => {
  const first = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch(),
    sources: officialSources(),
  });
  const changed = officialWatch();
  changed[1].complianceFacts = {
    ...changed[1].complianceFacts,
    completedSteps: [...changed[1].complianceFacts.completedSteps, "Sent To The Governor"],
    status: "Sent To The Governor",
  };
  const second = buildOhioComplianceSnapshot({
    regulatoryWatch: changed,
    sources: officialSources(),
  });

  assert.notEqual(second.currentFingerprint, first.currentFingerprint);
});

test("an incomplete or unparseable official refresh cannot establish a baseline", () => {
  const missing = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch().slice(0, 1),
    sources: [
      { id: "ohio-hemp-law", status: "ok" },
      { id: "ohio-sb86", status: "unavailable" },
    ],
  });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.isComplete, false);
  assert.equal(missing.currentFingerprint, "");
  assert.deepEqual(missing.unavailableSourceIds, ["ohio-sb86"]);

  const unparseable = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch({ law: { complianceFacts: null } }),
    sources: officialSources(),
  });
  assert.equal(unparseable.isComplete, false);
  assert.equal(unparseable.currentFingerprint, "");
});

test("first successful state requests a silent baseline and never raises an alert", () => {
  const snapshot = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch(),
    sources: officialSources(),
  });
  const view = buildOhioComplianceWatchViewModel(snapshot);

  assert.equal(view.state, "baseline-required");
  assert.equal(view.shouldEstablishBaseline, true);
  assert.equal(view.shouldAlert, false);
  assert.equal(view.isVisible, false);
  assert.equal(view.alert, null);
});

test("watch stays hidden for an acknowledged fingerprint and alerts only after change", () => {
  const snapshot = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch(),
    sources: officialSources(),
  });
  const current = buildOhioComplianceWatchViewModel(snapshot, {
    acknowledgedFingerprint: snapshot.currentFingerprint,
  });
  assert.equal(current.state, "current");
  assert.equal(current.shouldAlert, false);
  assert.equal(current.isVisible, false);

  const changed = buildOhioComplianceWatchViewModel(snapshot, {
    acknowledgedFingerprint: `${OHIO_COMPLIANCE_FINGERPRINT_VERSION}:${"a".repeat(64)}`,
  });
  assert.equal(changed.state, "changed");
  assert.equal(changed.shouldAlert, true);
  assert.equal(changed.isVisible, true);
  assert.match(changed.alert.title, /Ohio beverage compliance/i);
  assert.equal(changed.sources.length, 2);
});

test("malformed acknowledgements are treated as absent instead of false changes", () => {
  const snapshot = buildOhioComplianceSnapshot({
    regulatoryWatch: officialWatch(),
    sources: officialSources(),
  });
  const view = buildOhioComplianceWatchViewModel(snapshot, {
    acknowledgedFingerprint: "tampered-value",
  });
  assert.equal(normalizeOhioComplianceFingerprint("tampered-value"), "");
  assert.equal(view.state, "baseline-required");
  assert.equal(view.shouldAlert, false);
});

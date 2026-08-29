import assert from "node:assert/strict";
import test from "node:test";

import { buildThirtySecondBriefing } from "../public/thirty-second-briefing.mjs";

test("puts a critical exception before routine work", () => {
  const briefing = buildThirtySecondBriefing({
    overview: {
      planNumbersAvailable: true,
      alerts: [{ severity: "critical", title: "PMB needs attention", message: "One tap is unavailable.", action: { target: "keg-levels" } }],
    },
    plan: { summary: { orderLineCount: 2, cocktailBatchTotal: 1 } },
    mondayRun: { complete: false, nextStep: { label: "Count inventory", status: "Ready", target: "inventory" } },
  });
  assert.equal(briefing.lines[0].text, "PMB needs attention");
  assert.match(briefing.voiceText, /One tap is unavailable/);
  assert.doesNotMatch(briefing.voiceText, /Current locked Weekly Plan/);
});

test("uses the next Monday step when no urgent exception exists", () => {
  const briefing = buildThirtySecondBriefing({
    overview: { alerts: [], planNumbersAvailable: false },
    mondayRun: { complete: false, nextStep: { label: "Count inventory", status: "Ready", target: "inventory" } },
  });
  assert.equal(briefing.lines[0].text, "Next: Count inventory");
});

test("keeps all current operational alerts in the briefing", () => {
  const alerts = Array.from({ length: 5 }, (_, index) => ({
    severity: index === 0 ? "critical" : "warning",
    title: `Alert ${index + 1}`,
    message: `Issue ${index + 1}`,
    action: { target: "dashboard" },
  }));
  const briefing = buildThirtySecondBriefing({
    overview: { alerts, planNumbersAvailable: false },
    mondayRun: { complete: true },
  });
  assert.deepEqual(briefing.lines.map((item) => item.text), alerts.map((item) => item.title));
});

test("summarizes unfinished staff work instead of locked plan totals", () => {
  const briefing = buildThirtySecondBriefing({
    overview: { alerts: [] },
    mondayRun: { complete: true },
    staffPrepPlan: {
      items: [
        { quantity: 2, completed: false },
        { quantity: 1, completed: true },
      ],
      liquorRefills: [
        { completed: false },
        { completed: true },
      ],
    },
  });

  const work = briefing.lines.find((item) => item.text === "What is left this week");
  assert.deepEqual(work.bullets, [
    "2 cocktails left to be made",
    "1 liquor refill left to complete",
  ]);
});

test("waits until after Thursday to flag an unverified Bonbright delivery", () => {
  const input = {
    overview: { alerts: [] },
    mondayRun: { complete: true },
    orders: {
      vendors: [{
        vendor: "Bonbright Distributors",
        ordered: true,
        items: [{ status: "pending" }],
      }],
    },
  };

  const thursday = buildThirtySecondBriefing({ ...input, now: new Date(2026, 7, 27, 17, 0) });
  assert.equal(thursday.lines.some((item) => item.bullets?.includes("Expected Bonbright delivery not verified")), false);

  const friday = buildThirtySecondBriefing({ ...input, now: new Date(2026, 7, 28, 9, 0) });
  assert.equal(friday.lines.some((item) => item.bullets?.includes("Expected Bonbright delivery not verified")), true);
});

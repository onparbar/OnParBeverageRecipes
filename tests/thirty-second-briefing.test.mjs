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
});

test("uses the next Monday step when no urgent exception exists", () => {
  const briefing = buildThirtySecondBriefing({
    overview: { alerts: [], planNumbersAvailable: false },
    mondayRun: { complete: false, nextStep: { label: "Count inventory", status: "Ready", target: "inventory" } },
  });
  assert.equal(briefing.lines[0].text, "Next: Count inventory");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryRecoveryJob } from "../lib/inventory-recovery-runtime.mjs";

test("idle inventory recovery avoids repeatedly loading the full keg state", async () => {
  let time = 1_000;
  let recoveries = 0;
  const run = createInventoryRecoveryJob({
    now: () => time,
    idleIntervalMs: 600_000,
    recover: async () => { recoveries += 1; return { pending: false }; },
  });

  await run();
  const skipped = await run();
  assert.equal(recoveries, 1);
  assert.equal(skipped.skipped, true);
  time += 600_000;
  await run();
  assert.equal(recoveries, 2);
});

test("pending inventory recovery keeps checking without an idle delay", async () => {
  let recoveries = 0;
  const run = createInventoryRecoveryJob({
    recover: async () => ({ pending: ++recoveries < 2 }),
  });
  await run();
  await run();
  assert.equal(recoveries, 2);
});

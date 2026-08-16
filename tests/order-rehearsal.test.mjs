import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAssistedOrderView } from "../public/assisted-order-direct-ui.mjs";
import { buildOrderRehearsalModel } from "../public/order-rehearsal.mjs";

test("rehearsal is isolated fixture data with all four approved vendor paths", () => {
  const model = buildOrderRehearsalModel();
  assert.deepEqual(model.drafts.map((draft) => draft.vendor), ["Bonbright", "Heidelberg", "Proof", "OHLQ"]);
  model.drafts.forEach((draft) => {
    const saved = model.savedDrafts.find((entry) => entry.id === draft.id);
    const view = buildAssistedOrderView(draft, saved, { rehearsal: true });
    assert.equal(view.order.actionsEnabled, true);
    assert.equal(view.order.rehearsal, true);
    assert.equal(view.vendorPath, null);
  });
  assert.equal(model.drafts.find((draft) => draft.vendor === "Proof").proofFee.configured, false);
});

test("rehearsal source has no network, storage, or vendor destination behavior", async () => {
  const source = await readFile(new URL("../public/order-rehearsal.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|https?:\/\//i);
});

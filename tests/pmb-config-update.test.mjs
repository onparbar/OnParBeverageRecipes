import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetedPmbConfigUpdatePayload,
  isSuccessfulPmbConfigUpdateStatus,
} from "../lib/pmb-config-update.mjs";

test("accepts successful PMB form redirects and API responses", () => {
  assert.equal(isSuccessfulPmbConfigUpdateStatus(200), true);
  assert.equal(isSuccessfulPmbConfigUpdateStatus(204), true);
  assert.equal(isSuccessfulPmbConfigUpdateStatus(302), true);
  assert.equal(isSuccessfulPmbConfigUpdateStatus(401), false);
  assert.equal(isSuccessfulPmbConfigUpdateStatus(500), false);
  assert.equal(isSuccessfulPmbConfigUpdateStatus(0), false);
});

test("builds a targeted PMB configuration payload without losing the device id", () => {
  assert.deepEqual(buildTargetedPmbConfigUpdatePayload(910423, 66952905848032), {
    id: "910423",
    device_id: 66952905848032,
  });
  assert.throws(() => buildTargetedPmbConfigUpdatePayload(0, 66952905848032));
  assert.throws(() => buildTargetedPmbConfigUpdatePayload(910423, Number.MAX_SAFE_INTEGER + 1));
});

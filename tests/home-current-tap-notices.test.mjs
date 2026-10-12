import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThirtySecondBriefing } from '../public/thirty-second-briefing.mjs';
import { getSavedTapOrderProduct, getTapOrderProductName } from '../public/tap-order-product.mjs';

const stale = { tapNumber: 28, newBrand: 'Coming Soon!' };
function notices(currentTapAssignments) {
  return buildThirtySecondBriefing({ tapReplacementOverrides: { 'main-28': stale }, currentTapAssignments }).lines
    .filter(line => /Coming Soon/.test(line.text));
}
test('Home clears an old Coming Soon notice for the retained Octoberfest assignment', () => {
  const tap = { tapNumber: 28, name: 'Coming Soon!' };
  const saved = getSavedTapOrderProduct(tap, [{ tapNumber: 28, name: 'Coming Soon!' }], [
    { tapNumber: 28, name: 'Octoberfest 1', replacedBy: 'Coming Soon!', replacedAt: '2026-10-12T15:08:14Z' },
  ]);
  assert.equal(notices([{ tapNumber: 28, name: getTapOrderProductName(tap, saved) }]).length, 0);
  assert.equal(notices([{ tapNumber: 28, name: 'Octoberfest 1' }]).length, 0);
});
test('Home preserves actual unresolved placeholders and excludes unrelated historical taps', () => {
  const lines = notices([{ tapNumber: 67, name: 'Coming Soon!' }, { tapNumber: 28, name: 'Octoberfest 1' }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Tap 67- Coming Soon');
  assert.equal(notices([]).length, 0);
});

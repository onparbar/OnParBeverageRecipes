import test from 'node:test';
import assert from 'node:assert/strict';
import { getLiquorTapBottleBatch } from '../public/liquor-tap-order-policy.mjs';
import { buildOperationalRecommendation, buildInventoryPosition } from '../public/operations-truth-model.mjs';
import { buildRawRecommendation } from '../lib/par-agent.mjs';
import { netRollingLiquorTapRecommendations } from '../public/rolling-cocktail-ingredients.mjs';
for (const [oz, bottles] of [[59.1745, 2], [59.17, 2], [33.814, 3], [33.81, 3], [25.3605, 5], [25.36, 5]]) {
  test(`liquor ${oz} oz orders a fixed ${bottles}-bottle batch`, () => {
    assert.equal(getLiquorTapBottleBatch(oz), bottles);
    for (const connected of [0, 100, 249.99]) {
      const result = buildOperationalRecommendation({ kind: 'liquor', averageUsage: 150, bottleSize: oz, position: buildInventoryPosition({ connected }) });
      assert.equal(result.orderQuantity, bottles);
    }
    assert.equal(buildOperationalRecommendation({ kind: 'liquor', averageUsage: 150, bottleSize: oz, position: { available: 250 } }).orderQuantity, 0);
    const tap = { key: 'patio-1', tapNumber: 1, wall: 'Patio', type: 'Shots', name: 'Test liquor 3', plu: 999, bottleOz: oz };
    const result = buildRawRecommendation(tap, { fillLevelPercent: 10, rawKegSize: 500, rawKegSizeDp: 0 }, [{ volumeOz: 150 }], { onHandOverrides: {}, onDeckOverrides: {} }, {});
    assert.equal(result.orderQty, bottles); assert.equal(result.refillBottleQty, bottles);
  });
}
test('Buffalo Trace uses its 1 L catalog bottle when PMB omits bottle size', () => {
  const tap = { key: 'patio-15', tapNumber: 15, wall: 'Patio', type: 'Shots', name: 'Buffalo Trace Bourbon 3', plu: 15 };
  const result = buildRawRecommendation(tap, { fillLevelPercent: 10, rawKegSize: 500, rawKegSizeDp: 0 }, [{ volumeOz: 150 }], { onHandOverrides: {}, onDeckOverrides: {} }, {});
  assert.equal(result.bottleOz, 33.814);
  assert.equal(result.orderQty, 3);
  assert.equal(result.refillBottleQty, 3);
});
test('partial cabinet coverage does not leave a one-bottle purchase for standard sizes', () => {
  const items = [{ id: 'test', name: 'Test', group: 'Liquor Cabinet', rollingIngredientVersion: 1, onHand: 1, hasCurrentCount: true }];
  const [result] = netRollingLiquorTapRecommendations([{ name: 'Test 3', isLiquorTap: true, actionType: 'order', orderQty: 2, bottleOz: 59.17 }], items);
  assert.equal(result.orderQty, 2); assert.equal(result.cabinetUsedQty, 1);
});
test('full cabinet coverage still avoids purchasing unnecessary bottles', () => {
  const items = [{ id: 'test', name: 'Test', group: 'Liquor Cabinet', rollingIngredientVersion: 1, onHand: 2, hasCurrentCount: true }];
  const [result] = netRollingLiquorTapRecommendations([{ name: 'Test 3', isLiquorTap: true, actionType: 'order', orderQty: 2, bottleOz: 59.17 }], items);
  assert.equal(result.orderQty, 0);
});
test('a cap cannot turn a refill batch into a single-bottle order', () => {
  const result = buildOperationalRecommendation({ kind: 'liquor', averageUsage: 150, bottleSize: 59.17, maxOrder: 1, position: { available: 10 } });
  assert.equal(result.orderQuantity, 0); assert.equal(result.orderCapApplied, true);
});

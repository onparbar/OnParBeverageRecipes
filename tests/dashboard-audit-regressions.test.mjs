import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getWeeklyUsageEntryPouredOz } from '../public/weekly-usage-performance.mjs';
import { applyInventoryStateAction, createEmptyInventoryState } from '../lib/inventory-store.mjs';

const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
function extract(name, scope = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return vm.runInNewContext(`${source.slice(start, source.indexOf('\n}\n', start) + 2)}; ${name}`, {
    clean: value => String(value ?? '').trim(),
    getWeeklyUsageEntryPouredOz,
    getWeeklyUsageFullOunces: () => 1984,
    ...scope,
  });
}

test('search preserves unusable, unknown-zero, and incompatible-sales exclusions', () => {
  const ounces = extract('getDashboardDataSearchEntryOunces');
  const item = { displayUnit: 'oz' };
  for (const entry of [
    { value: null }, { value: '' }, { value: 0 },
    { value: 12, hasValue: false },
    { value: 12, usageUnknownReason: 'Assignment unknown' },
    { value: 12, source: 'GoTab sales' },
  ]) assert.equal(ounces(item, entry), null, JSON.stringify(entry));
  assert.equal(ounces(item, { source: "PMB", value: 0, zeroUsageVerified: true }), 0);
  assert.equal(ounces({ displayUnit: 'kegs' }, { source: "PMB", value: 0.5 }), 992);
});

test('inventory usage adapter passes product and entry and recognizes PMB source case', () => {
  const history = [{ label: '9/7/26 - 9/13/26', source: 'PMB', volumeOz: 42 }];
  const rows = extract('getInventoryRealityUsageItems', {
    weeklyUsageItems: [{ name: 'Vodka', history }],
    getWeeklyUsageLabelTime: label => Date.parse(label.split(' - ')[0]),
  })();
  assert.equal(rows[0].ounces, 42);
  assert.equal(rows[0].verified, true);
});

test('clearing one count removes its count timestamp and explicit zero remains counted', () => {
  const now = new Date('2026-09-14T15:00:00Z');
  const initial = applyInventoryStateAction(createEmptyInventoryState(), 'initialize', {}, 'owner', now);
  const counted = applyInventoryStateAction(initial, 'update-field', { id: 'vodka', field: 'onHand', value: '0' }, 'owner', now);
  assert.equal(counted.current.countedItemsAt.vodka, now.toISOString());
  const cleared = applyInventoryStateAction(counted, 'update-field', { id: 'vodka', field: 'onHand', value: '' }, 'owner', now);
  assert.equal(cleared.current.countedItemsAt.vodka, undefined);
  assert.equal(cleared.current.onHandOverrides.vodka, undefined);
  const mixed = applyInventoryStateAction(counted, 'batch-update-fields', { changes: [
    { id: 'vodka', field: 'onHand', value: '' }, { id: 'gin', field: 'onHand', value: '0' },
  ] }, 'owner', now);
  assert.equal(mixed.current.countedItemsAt.vodka, undefined);
  assert.equal(mixed.current.countedItemsAt.gin, now.toISOString());
});

test('weekly comparisons survive both Eastern daylight-saving transitions', () => {
  const moduleUrl = new URL('../public/weekly-usage-performance.mjs', import.meta.url).href;
  const script = `import {buildWeeklyUsagePerformance} from ${JSON.stringify(moduleUrl)};
    const periods = [['3/9/26 - 3/15/26', '3/2/26 - 3/8/26'], ['11/2/26 - 11/8/26', '10/26/26 - 11/1/26']];
    console.log(JSON.stringify(periods.map(([current, previous]) => buildWeeklyUsagePerformance([{name:'Beer',tapNumber:21,history:[
      {label:current,source:'PMB',volumeOz:20}, {label:previous,source:'PMB',volumeOz:10}
    ]}]))));`;
  const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8',
  }));
  for (const result of results) {
    assert.equal(result.totalTrendPercent, 100);
    assert.equal(result.previousComplete, true);
  }
});

test('saved prep with unmapped inventory returns a visible warning to both clients', async () => {
  const { withInventoryReviewWarning } = await import('../lib/inventory-backed-operation.mjs');
  const result = withInventoryReviewWarning({ warning: 'Earlier warning.' }, [{ id: 'gin', name: 'Gin' }]);
  assert.equal(result.reviewRequired, true);
  assert.match(result.warning, /Earlier warning/);
  assert.match(result.warning, /Checklist saved.*Cabinet inventory needs manager review.*Gin/);
  assert.deepEqual(result.reviewItems, [{ id: 'gin', name: 'Gin' }]);
  assert.equal(withInventoryReviewWarning({}, []).warning, '');
});

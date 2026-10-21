import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
function status(overrides = {}) {
  const start = source.indexOf('function renderDashboardPulseHistoryStatus(');
  assert.ok(start >= 0, 'Home must explain stale history beside its estimates');
  const end = source.indexOf('\nfunction renderDashboardProjectedSalesMix(', start);
  const context = vm.createContext({
    getCompletedMondayWeekStarts: () => [new Date(2026, 9, 12)],
    weeklyUsageDisplayReadError: '', weeklyUsageSharedOutbox: null,
    escapeHtml: text => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    ...overrides,
  });
  vm.runInContext(source.slice(start, end), context);
  return mix => context.renderDashboardPulseHistoryStatus(mix);
}

test('the screenshot six-week lag is visibly identified beside estimated profit', () => {
  const html = status()({ weekStartTime: new Date(2026, 7, 31).getTime(), weekLabel: '9/8/25 - 9/6/26' });
  assert.match(html, /History is behind/);
  assert.match(html, /9\/8\/25 - 9\/6\/26/);
  assert.match(html, /data-dashboard-history-refresh/);
});

test('the latest completed week needs no stale warning', () => {
  assert.equal(status()({ weekStartTime: new Date(2026, 9, 12).getTime(), weekLabel: '10/20/25 - 10/18/26' }), '');
});

test('unavailable shared reads remain visible even with a recent local report', () => {
  const html = status({ weeklyUsageDisplayReadError: 'Could not check saved history.' })({ weekStartTime: new Date(2026, 9, 12).getTime() });
  assert.match(html, /Could not check saved history/);
});

test('a pending local report is preserved and explained instead of inviting a destructive reset', () => {
  const html = status({ weeklyUsageSharedOutbox: { conflict: true } })({ weekStartTime: new Date(2026, 7, 31).getTime() });
  assert.match(html, /unsaved report/);
  assert.match(html, /Weekly Usage/);
});

test('missing history never presents estimates as current', () => {
  assert.match(status()({ weekStartTime: 0, weekLabel: '' }), /No saved pour history/);
});

test('changing either Home filter checks shared history without a PMB pull', () => {
  const start = source.indexOf('  const handleDashboardPulseChange = (event) => {');
  const end = source.indexOf('\n  dashboardOverview?.addEventListener', start);
  let reads = 0;
  const context = vm.createContext({
    clean: value => String(value).trim(), renderDashboardBeveragePulse() {},
    refreshSharedWeeklyUsageForDisplay: () => { reads++; return Promise.resolve(false); },
    sellerRankingPeriod: 'six-weeks', sellerRankingWall: 'main',
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.change = handleDashboardPulseChange;`, context);
  context.change({ target: { closest: selector => selector === '[data-dashboard-pulse-period]' ? { value: 'fifty-two-weeks' } : null } });
  assert.equal(reads, 1);
  context.change({ target: { closest: selector => selector === '[data-seller-ranking-wall]' ? { value: 'karaoke' } : null } });
  assert.equal(reads, 2);
});

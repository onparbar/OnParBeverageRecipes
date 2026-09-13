import test from 'node:test';
import assert from 'node:assert/strict';
import { requireDailyReportOrigin } from '../lib/pmb-daily-origin.mjs';
const env = { NODE_ENV: 'production' };
function request(origin, extras = {}) { return new Request('http://localhost:3000/api/pmb-daily-usage', { headers: { ...(origin ? { Origin: origin } : {}), ...extras } }); }
test('accepts the public dashboard behind an internal proxy URL', () => {
  assert.doesNotThrow(() => requireDailyReportOrigin(request('https://onparbev.com', { 'sec-fetch-site': 'same-origin' }), env));
});
test('rejects foreign, null and spoofed forwarded origins', () => {
  for (const origin of ['https://evil.example', 'null', 'https://onparbev.com.evil.example', 'http://localhost:3000']) {
    assert.throws(() => requireDailyReportOrigin(request(origin, { 'x-forwarded-host': 'evil.example' }), env), { status: 403 });
  }
});
test('cross-site context remains rejected even with a matching origin', () => {
  assert.throws(() => requireDailyReportOrigin(request('https://onparbev.com', { 'sec-fetch-site': 'cross-site' }), env), { status: 403 });
});
test('authenticated machine clients and local development remain supported', () => {
  assert.doesNotThrow(() => requireDailyReportOrigin(request(), env));
  assert.doesNotThrow(() => requireDailyReportOrigin(request('http://localhost:3000'), { NODE_ENV: 'development' }));
});

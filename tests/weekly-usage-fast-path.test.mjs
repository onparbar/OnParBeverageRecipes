import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const stateRoute = readFileSync(new URL('../app/api/weekly-usage-state/route.js', import.meta.url), 'utf8');
const pmbRoute = readFileSync(new URL('../app/api/pmb-weekly-usage/route.js', import.meta.url), 'utf8');

test('weekly usage display reads return saved storage without waiting on live PMB recovery', () => {
  const getBody = stateRoute.slice(stateRoute.indexOf('export async function GET'), stateRoute.indexOf('export async function POST'));
  assert.match(getBody, /readSharedWeeklyUsageState\(\)/);
  assert.doesNotMatch(getBody, /pmb-weekly-usage|recoverWeeklyUsageState|getPmbWeeklyReport/);
});

test('one weekly transaction response supplies both full-week and pre-Thursday totals', () => {
  const transactionCalls = pmbRoute.match(/postJson\(config\.baseUrl, "\/api\/transactions"/g) || [];
  assert.equal(transactionCalls.length, 1, 'do not issue a duplicate PMB transaction request for the subset');
  assert.match(pmbRoute, /preThursdayTransactionResults = transactionResults\.map/);
  assert.match(pmbRoute, /getPreThursdayTransactionRangePayload\(ranges\[index\]\)/);
});

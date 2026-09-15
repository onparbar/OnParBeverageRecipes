import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { describePmbProductReportPage, parseReportHistoryRequest, readPmbReportHistory } from '../lib/pmb-report-history.mjs';

test('report lookup accepts only fixed views and bounded product identities', () => {
  assert.deepEqual(parseReportHistoryRequest(new URLSearchParams('view=products&plus=12,34,12')), { view: 'products', plus: [12, 34] });
  for (const query of ['path=http://elsewhere', 'view=delete', 'view=products&plus=-1', 'view=products&plus=1e3', 'view=products', 'view=catalog&plus=1', 'view=products&plus=1,2,3,4,5,6,7,8,9']) {
    assert.throws(() => parseReportHistoryRequest(new URLSearchParams(query)), { status: 422 });
  }
});

test('catalog projects product text and report navigation without HTML or secrets', () => {
  const page = describePmbProductReportPage(`<script>secret()</script><a href="/pages/reporting">Poured Oz</a><a href="/pages/products?delete=1">Delete</a><a href="https://elsewhere">Report</a><table><tr><th>Product</th><th>PLU</th></tr><tr><td>Strawberry Margarita 2</td><td>123</td></tr></table><input name="token" value="private"><select name="category"><option value="all">All products</option></select>`);
  assert.deepEqual(page.links, [{ label: 'Poured Oz', path: '/pages/reporting' }]);
  assert.deepEqual(page.tables[0].rows[1], ['Strawberry Margarita 2', '123']);
  assert.ok(!JSON.stringify(page).includes('private'));
  assert.ok(!JSON.stringify(page).includes('secret'));
});

test('catalog reads a fixed controller page with GET and no submitted fields', async () => {
  const calls = [];
  await readPmbReportHistory({ view: 'catalog', plus: [] }, { config: {}, readPage: async (...args) => {
    calls.push(args); return { status: 200, raw: '<table><tr><td>House Margarita 2</td></tr></table>' };
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'GET');
  assert.equal(calls[0][2], '/pages/products');
  assert.equal(calls[0][3].length, 0);
});

test('retired names require matching returned identity, not a replacement product', async () => {
  const result = await readPmbReportHistory({ view: 'products', plus: [12, 34] }, { config: {}, readProduct: async () => ({ html: '<form><input name="fd_plu" value="12"><input name="fd_name" value="House Margarita 2"><input name="fd_price_per_unit" value="219"><button name="submit_saveedit_product">Save</button></form>' }) });
  assert.deepEqual(result.products[0], { plu: 12, name: 'House Margarita 2', identityVerified: true });
  assert.equal(result.products[1].identityVerified, false);
  assert.equal(result.products[1].name, null);
});

test('report endpoint requires owner authorization before controller access and has no write handler', async () => {
  const source = await readFile(new URL('../app/api/pmb-report-history/route.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('await requireDashboardRequestRole(request, { owner: true })') < source.indexOf('await readPmbReportHistory(input)'));
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(source, /private, no-store/);
});

test('product search only submits the observed name filter and includes inactive entries', async () => {
  const input = parseReportHistoryRequest(new URLSearchParams('view=catalog&name=Strawberry'));
  let call;
  await readPmbReportHistory(input, {config: {}, readPage: async (...args) => { call = args; return {status:200, raw:''}; }});
  assert.equal(call[1], 'POST');
  assert.equal(call[2], '/pages/products');
  assert.deepEqual([...new URLSearchParams(call[3].toString())], [['fd_plu',''], ['fd_name','Strawberry'], ['fd_descr',''], ['submit_apply_filter','Apply']]);
  assert.throws(() => parseReportHistoryRequest(new URLSearchParams('view=products&plus=4&name=Strawberry')), {status:422});
});

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const dollars = value => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const amount = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const sumKnown = (rows, field) => rows.length && rows.every(r => r[field] !== null && r[field] !== undefined) ? rows.reduce((sum, r) => sum + r[field], 0) : null;

import { fillDailyReportCost } from './daily-report-costs.mjs';

function formatReportDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date);
  const shortDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }).format(date);
  return `${weekday}- ${shortDate}`;
}

function reportWall(row) {
  const wallForTap = value => {
    const tap = Number(value);
    if (!Number.isInteger(tap)) return '';
    if (tap >= 1 && tap <= 20) return 'patio';
    if (tap >= 21 && tap <= 72) return 'main';
    if (tap >= 73 && tap <= 102) return 'karaoke';
    return '';
  };
  const recordedWall = wallForTap(row.tapNumber);
  if (recordedWall) return recordedWall;
  // Product suffixes preserve wall identity in older PMB exports without taps.
  const suffix = String(row.product || '').match(/\s+([123])\s*$/)?.[1];
  return ({ '1': 'main', '2': 'karaoke', '3': 'patio' })[suffix]
    || wallForTap(row.suggestedTapNumber);
}

function renderPerformanceGroup(group) {
  return `<tr><td>${escape(group.product)}</td><td>${amount(group.members.reduce((sum, row) => sum + row.volumeOz, 0))}</td><td>${dollars(sumKnown(group.members, 'estimatedGrossProfit'))}</td></tr>`;
}

function exportPerformanceCsv(groups, startDate, endDate) {
  const csvCell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    // Keep product names from being interpreted as spreadsheet formulas.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [['Product', 'Ounces', 'Estimated gross profit']];
  for (const group of groups) {
    const members = group.members;
    rows.push([
      group.product,
      members.reduce((sum, row) => sum + row.volumeOz, 0),
      sumKnown(members, 'estimatedGrossProfit'),
    ]);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `daily-sales-profit-${startDate}-to-${endDate}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountTapPerformance(root, getCosts) {
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const yesterday = new Date(`${day(new Date())}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = day(yesterday), first = new Date(yesterday); first.setUTCDate(first.getUTCDate() - 6);
  let reports = [], missingDays = [], running = false, stop = false;
  let sortColumn = 'product', sortDirection = 'asc';
  root.innerHTML = `<header class="tap-performance-heading"><div><h2>Daily Sales &amp; Profit</h2></div></header>
    <form class="tap-performance-filters">
      <label>From<input name="start" type="date" value="${day(first)}" max="${end}" required></label>
      <label>Through<input name="end" type="date" value="${end}" max="${end}" required></label>
      <label>Wall<select name="tap"><option value="all">All taps</option><option value="patio">Patio wall</option><option value="main">Main wall</option><option value="karaoke">Karaoke wall</option></select></label>
      <button class="primary-button" type="submit">Show results</button>
      <button class="ghost-button" type="button" data-stop hidden>Stop after this day</button>
    </form>
    <div class="tap-performance-presets"><button type="button" data-days="1">Yesterday</button><button type="button" data-days="7">Last 7 days</button><button type="button" data-days="30">Last 30 days</button></div>
    <p role="status" aria-live="polite" data-status hidden></p>
    <div data-results></div>`;
  const form = root.querySelector('form'), status = root.querySelector('[data-status]');
  const input = name => form.elements.namedItem(name);
  const say = text => { status.textContent = text; status.hidden = !text; };
  function render() {
    const selected = input('tap').value;
    const costs = getCosts() || [];
    const all = reports.flatMap(report => report.rows.map(row => ({ ...fillDailyReportCost(row, costs), day: report.day, coverage: report.coverage })));
    const filtered = all.filter(row => selected === 'all' || reportWall(row) === selected);
    const groups = new Map();
    for (const row of filtered) {
      const productIdentity = String(row.product || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      // Total each named product across the selected dates and wall, retaining
      // each underlying row's cost and sales evidence for the profit calculation.
      const key = productIdentity;
      const group = groups.get(key) || { ...row, members: [] };
      group.members.push(row); groups.set(key, group);
    }
    const partial = reports.filter(r => r.coverage !== 'matching-overlapping-reads').length;
    const columns = [
      ['product', 'Product'], ['volumeOz', 'Ounces'], ['estimatedGrossProfit', 'Est. gross profit'],
    ];
    const sortValue = group => sortColumn === 'day' || sortColumn === 'product'
      ? group[sortColumn]
      : sortColumn === 'volumeOz'
        ? group.members.reduce((sum, row) => sum + row.volumeOz, 0)
        : sumKnown(group.members, sortColumn);
    const orderedGroups = [...groups.values()].sort((a, b) => {
      const left = sortValue(a), right = sortValue(b);
      // Missing figures stay at the bottom in either direction.
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;
      const comparison = left == null && right == null ? 0
        : typeof left === 'number' ? left - right
          : String(left).localeCompare(String(right), 'en', { numeric: true, sensitivity: 'base' });
      return comparison * (sortDirection === 'asc' ? 1 : -1) || a.product.localeCompare(b.product);
    });
    const columnHeaders = columns.map(([key, label]) => {
      const active = sortColumn === key;
      const nextDirection = active ? (sortDirection === 'asc' ? 'desc' : 'asc') : key === 'product' ? 'asc' : 'desc';
      return `<th scope="col" aria-sort="${active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="tap-performance-sort" data-sort="${key}" aria-label="Sort ${label} ${nextDirection === 'asc' ? 'ascending' : 'descending'}">${label} <span aria-hidden="true">${active ? (sortDirection === 'asc' ? '&#8593;' : '&#8595;') : '&#8597;'}</span></button></th>`;
    }).join('');
    const missingCosts = [...new Set(filtered.filter(row => !Number.isFinite(row.estimatedCost)).map(row => row.product))];
    const missingRevenue = filtered.some(row => !Number.isFinite(row.revenue));
    const profit = sumKnown(filtered, 'estimatedGrossProfit');
    const profitLabel = profit !== null ? dollars(profit) : missingCosts.length ? 'Pricing needed' : missingRevenue ? 'Sales verification needed' : 'No pours';
    const costNote = missingCosts.length
      ? `<p class="table-note">Pricing needed for: ${missingCosts.map(escape).join(', ')}. These costs are not treated as zero.</p>` : '';
    const estimateNote = filtered.some(row => row.currentCostEstimate)
      ? '<p class="table-note">Current product costs estimate missing historical costs; saved historical costs are preserved.</p>' : '';
    root.querySelector('[data-results]').innerHTML = `<p class="table-note">${reports.length} saved days · ${missingDays.length} missing days · ${partial} unverified or partial days. Totals below cover captured records only.</p>
      <div class="tap-performance-totals"><article><span>Captured ounces</span><strong>${amount(filtered.reduce((s, r) => s + r.volumeOz, 0))}</strong></article><article><span>PMB recorded sales</span><strong>${dollars(sumKnown(filtered, 'revenue'))}</strong></article><article><span>Estimated gross profit</span><strong>${profitLabel}</strong></article></div>
      ${costNote}${estimateNote}
      <p class="table-note">${escape(formatReportDay(input('start').value))} to ${escape(formatReportDay(input('end').value))}</p>
      <button type="button" class="ghost-button" data-export-report${filtered.length ? '' : ' disabled'}>Export CSV</button>
      <div class="inventory-table-wrap" tabindex="0" role="region" aria-label="Tap sales and profit details"><table class="inventory-table"><thead><tr>${columnHeaders}</tr></thead><tbody>
      ${orderedGroups.map(renderPerformanceGroup).join('') || `<tr><td colspan="3">No captured pours for this selection. Missing data is not zero usage.</td></tr>`}
      </tbody></table></div>`;
    root.querySelector('[data-export-report]').addEventListener('click', () => {
      exportPerformanceCsv(orderedGroups, input('start').value, input('end').value);
    });
    root.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
      const column = button.dataset.sort;
      sortDirection = sortColumn === column ? (sortDirection === 'asc' ? 'desc' : 'asc') : column === 'product' ? 'asc' : 'desc';
      sortColumn = column;
      const scrollLeft = root.querySelector('.inventory-table-wrap').scrollLeft;
      render();
      root.querySelector('.inventory-table-wrap').scrollLeft = scrollLeft;
      root.querySelector(`[data-sort="${column}"]`).focus({ preventScroll: true });
    }));
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options, signal: AbortSignal.timeout(100000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Report request failed (${response.status}).`);
    return data;
  }
  async function load() {
    const data = await request(`/api/pmb-daily-usage?startDate=${encodeURIComponent(input('start').value)}&endDate=${encodeURIComponent(input('end').value)}`);
    reports = data.reports; missingDays = data.missingDays; render();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (running) return;
    await showResults();
  });
  input('tap').addEventListener('change', render);
  root.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
    if (running) return;
    const from = new Date(yesterday); from.setUTCDate(from.getUTCDate() - Number(button.dataset.days) + 1);
    input('start').value = day(from); input('end').value = end; form.requestSubmit();
  }));
  root.querySelector('[data-stop]').addEventListener('click', () => { stop = true; say('Stopping after the current day is safely saved.'); });
  async function showResults() {
    if (running || !form.reportValidity()) return;
    const startMs = Date.parse(input('start').value), endMs = Date.parse(input('end').value);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || input('end').value > end) { say('Choose a valid range of completed days.'); return; }
    running = true; stop = false;
    form.querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
    const stopButton = root.querySelector('[data-stop]'); stopButton.disabled = false; stopButton.hidden = false;
    try {
      say('Loading results...');
      await load();
      const needed = [...new Set([
        ...missingDays,
        ...reports.filter(report => report.coverage !== 'matching-overlapping-reads').map(report => report.day),
      ])].filter(date => date >= input('start').value && date <= input('end').value && date <= end).sort();
      if (!needed.length) { say(''); return; }
      const costs = getCosts();
      for (const [index, date] of needed.entries()) {
        if (stop) break;
        say(`Completing results: ${index + 1} of ${needed.length} days...`);
        const data = await request('/api/pmb-daily-usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: date, costs }) });
        if (!data.saved || !data.report) throw new Error('PMB report could not be saved.');
        reports = [...reports.filter(report => report.day !== date), data.report];
        missingDays = missingDays.filter(day => day !== date);
        render();
      }
      say(stop ? 'Stopped. Saved results are available below.' : '');
    } catch (error) { say(`Could not complete results. ${error.message}`); }
    finally { running = false; form.querySelectorAll('input,select,button').forEach(el => { el.disabled = false; }); stopButton.hidden = true; }
  }
}

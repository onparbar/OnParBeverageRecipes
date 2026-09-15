const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const dollars = value => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const amount = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const sumKnown = (rows, field) => rows.length && rows.every(r => r[field] !== null && r[field] !== undefined) ? rows.reduce((sum, r) => sum + r[field], 0) : null;

function renderPerformanceGroup(group) {
  const tap = group.displayTapNumber ? `Tap ${group.displayTapNumber}` : 'Tap not recorded';
  const heading = `<strong>${escape(tap)}</strong>`;
  return `<tr><td>${escape(group.day)}</td><td>${heading}</td><td>${escape(group.product)}</td><td>${amount(group.members.reduce((sum, row) => sum + row.volumeOz, 0))}</td><td>${dollars(sumKnown(group.members, 'revenue'))}</td><td>${dollars(sumKnown(group.members, 'estimatedCost'))}</td><td>${dollars(sumKnown(group.members, 'estimatedGrossProfit'))}</td></tr>`;
}

export function mountTapPerformance(root, getCosts) {
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const yesterday = new Date(`${day(new Date())}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const end = day(yesterday), first = new Date(yesterday); first.setUTCDate(first.getUTCDate() - 6);
  let reports = [], missingDays = [], running = false, stop = false;
  root.innerHTML = `<header class="tap-performance-heading"><div><p class="eyebrow">Daily reporting</p><h2>Sales &amp; profit</h2></div></header>
    <form class="tap-performance-filters">
      <label>From<input name="start" type="date" value="${day(first)}" max="${end}" required></label>
      <label>Through<input name="end" type="date" value="${end}" max="${end}" required></label>
      <label>Tap<select name="tap"><option value="all">All taps</option></select></label>
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
    const all = reports.flatMap(report => report.rows.map(row => ({ ...row, day: report.day, coverage: report.coverage })));
    const taps = [...new Set(all.map(r => r.tapNumber || r.suggestedTapNumber).filter(Boolean))].sort((a, b) => a - b);
    input('tap').innerHTML = `<option value="all">All taps</option>${taps.map(t => `<option value="${t}">Tap ${t}</option>`).join('')}<option value="unknown">Unassigned</option>`;
    input('tap').value = selected === 'all' || selected === 'unknown' || taps.includes(Number(selected)) ? selected : 'all';
    const filtered = all.filter(r => input('tap').value === 'all' || (input('tap').value === 'unknown' ? !(r.tapNumber || r.suggestedTapNumber) : Number(input('tap').value) === (r.tapNumber || r.suggestedTapNumber)));
    const groups = new Map();
    for (const row of filtered) {
      const date = row.day;
      const displayTapNumber = row.tapNumber || null;
      const productIdentity = String(row.product || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      // Group the same displayed tap/product once, but retain every member's
      // assignment evidence and cost snapshot. A display merge is not verification.
      const key = JSON.stringify([date, displayTapNumber, row.plu, productIdentity]);
      const group = groups.get(key) || { ...row, day: date, displayTapNumber, members: [] };
      group.members.push(row); groups.set(key, group);
    }
    const partial = reports.filter(r => r.coverage !== 'matching-overlapping-reads').length;
    root.querySelector('[data-results]').innerHTML = `<p class="table-note">${reports.length} saved days · ${missingDays.length} missing days · ${partial} unverified or partial days. Totals below cover captured records only.</p>
      <div class="tap-performance-totals"><article><span>Captured ounces</span><strong>${amount(filtered.reduce((s, r) => s + r.volumeOz, 0))}</strong></article><article><span>PMB recorded sales</span><strong>${dollars(sumKnown(filtered, 'revenue'))}</strong></article><article><span>Estimated gross profit</span><strong>${dollars(sumKnown(filtered, 'estimatedGrossProfit'))}</strong></article></div>
      <div class="inventory-table-wrap" tabindex="0" role="region" aria-label="Tap sales and profit details"><table class="inventory-table"><thead><tr><th>Day</th><th>Tap</th><th>Product</th><th>Ounces</th><th>PMB sales</th><th>Est. cost</th><th>Est. gross profit</th></tr></thead><tbody>
      ${[...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || (a.displayTapNumber || 9999) - (b.displayTapNumber || 9999)).map(renderPerformanceGroup).join('') || `<tr><td colspan="7">No captured pours for this selection. Missing data is not zero usage.</td></tr>`}
      </tbody></table></div>`;
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

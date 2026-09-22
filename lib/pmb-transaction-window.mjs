// PMB can return pours outside the requested report range. Original timestamps,
// rather than the report label, determine which week/day owns each pour.
export function filterPmbTransactionWindow(rows, { start_time, end_time }) {
  const start = Date.parse(start_time), end = Date.parse(end_time);
  if (!Array.isArray(rows) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('PMB did not return a valid transaction window. No usage was saved.');
  }
  return rows.filter(row => {
    const raw = String(row?.tst_start ?? '').trim();
    const epoch = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    const at = epoch >= 1e12 ? epoch : epoch * 1000;
    if (!(at > 0) || !Number.isFinite(new Date(at).getTime())) {
      throw new Error('A PMB pour has no usable original timestamp. No usage was saved.');
    }
    return at >= start && at < end;
  });
}

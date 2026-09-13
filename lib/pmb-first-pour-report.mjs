const DAY_MS = 86400000;
const timeZone = "America/New_York";

function reportError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

function parseDay(value) {
  const text = String(value || "");
  const milliseconds = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString().slice(0, 10) !== text) {
    throw reportError("Use valid YYYY-MM-DD report dates.");
  }
  return milliseconds;
}

export function getFirstPourWindow(startDate, endDate, now = new Date()) {
  const start = parseDay(startDate);
  const end = parseDay(endDate) + DAY_MS;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const today = parseDay(`${parts.year}-${parts.month}-${parts.day}`);
  if (end <= start || end - start > 7 * DAY_MS || end > today + DAY_MS) {
    throw reportError("Search 1-7 days at a time, with no future dates.");
  }
  return { start, end };
}

export function pmbLocalMidnight(milliseconds) {
  const date = new Date(milliseconds).toISOString().slice(0, 10);
  // At local midnight on a DST change date, the pre-transition offset applies.
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone, timeZoneName: "shortOffset", hour: "2-digit",
  }).formatToParts(new Date(`${date}T04:00:00Z`))
    .find((part) => part.type === "timeZoneName")?.value;
  const match = String(offset).match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw reportError("Could not determine the PMB business-day offset.", 500);
  return `${date}T00:00:00${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`;
}

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

export function summarizeFirstPourTransactions(rows, target, bounds = null) {
  if (!Array.isArray(rows)) throw reportError("PMB did not return a transaction report.", 502);
  let matchedRows = 0;
  let physicalTapRows = 0;
  let productOnlyRows = 0;
  let volumeOz = 0;
  const timestampSamples = [];
  let transactionFieldNames = [];
  let firstRecordedPourAt = null;
  for (const row of rows) {
    if (positiveInteger(row?.plu) !== Number(target.plu)) continue;
    if (row.volume_amount === null || row.volume_amount === undefined || row.volume_amount === ""
      || !Number.isFinite(Number(row.volume_amount)) || Number(row.volume_amount) < 0) {
      throw reportError("PMB returned an unreadable poured volume for this product.", 502);
    }
    if (!(Number(row.volume_amount) > 0)) continue;
    const tap = positiveInteger(row.tapNumber ?? row.tap_number ?? row.tap_num ?? row.tap_no ?? row.tap);
    const device = positiveInteger(row.deviceId ?? row.device_id ?? row.controller_id);
    const line = positiveInteger(row.lineNum ?? row.line_num ?? row.line_number);
    if (tap && tap !== Number(target.tapNumber)) continue;
    if (device && device !== Number(target.deviceId)) continue;
    if (line && line !== Number(target.lineNum)) continue;
    const rawTimestamp = String(row.tst_start ?? "").trim();
    const timestampNumber = /^\d+(?:\.\d+)?$/.test(rawTimestamp) ? Number(rawTimestamp) : NaN;
    const milliseconds = timestampNumber >= 1e12 ? timestampNumber : timestampNumber * 1000;
    const timestampValid = milliseconds > 0 && Number.isFinite(new Date(milliseconds).getTime());
    if (bounds) {
      if (!timestampValid) throw reportError("PMB returned a pour without a usable original start timestamp.", 502);
      // PMB can include transactions beyond the requested date boundaries.
      // The original epoch timestamp, not the query label, determines the day.
      if (milliseconds < bounds.start || milliseconds >= bounds.end) continue;
    }
    if (timestampValid && (!firstRecordedPourAt || milliseconds < Date.parse(firstRecordedPourAt))) {
      firstRecordedPourAt = new Date(milliseconds).toISOString();
    }
    matchedRows += 1;
    volumeOz += Number(row.volume_amount);
    if (!transactionFieldNames.length) transactionFieldNames = Object.keys(row);
    if (timestampSamples.length < 6) {
      const fields = Object.fromEntries(Object.entries(row).filter(([key, value]) => (
        /^(?:time|date|timestamp|datetime|time_stamp|transaction_time|transaction_date|transaction_datetime|start_time|end_time|tst_start|tst_stop|poured_at|created_at|occurred_at)$/i.test(key)
        && ["string", "number"].includes(typeof value)
      )).map(([key, value]) => [key, String(value).slice(0, 100)]));
      if (Object.keys(fields).length) timestampSamples.push(fields);
    }
    if (tap || (device && line)) physicalTapRows += 1;
    else productOnlyRows += 1;
  }
  return { matchedRows, physicalTapRows, productOnlyRows, volumeOz, firstRecordedPourAt, timestampSamples, transactionFieldNames };
}

function localDate(timestamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Every query is a read of a bounded date range. Original PMB tst_start values
// establish the date, including when PMB returns extra boundary-day rows.
export async function findFirstPourInRange({ target, startDate, endDate, readTransactions, now = new Date() }) {
  const range = getFirstPourWindow(startDate, endDate, now);
  const start_time = pmbLocalMidnight(range.start);
  const end_time = pmbLocalMidnight(range.end);
  const rows = await readTransactions({ start_time, end_time });
  const total = summarizeFirstPourTransactions(rows, target, { start: Date.parse(start_time), end: Date.parse(end_time) });
  const firstRecordedPourDate = total.firstRecordedPourAt ? localDate(total.firstRecordedPourAt) : null;
  let firstDay = null;
  if (firstRecordedPourDate) {
    const day = parseDay(firstRecordedPourDate);
    firstDay = summarizeFirstPourTransactions(rows, target, {
      start: Date.parse(pmbLocalMidnight(day)), end: Date.parse(pmbLocalMidnight(day + DAY_MS)),
    });
  }
  return {
    product: target.product || target.name,
    plu: Number(target.plu),
    tapNumber: Number(target.tapNumber),
    source: "PMB transaction reports",
    timeZone,
    searchedStartDate: startDate,
    searchedEndDate: endDate,
    firstRecordedPourDate,
    firstRecordedPourAt: total.firstRecordedPourAt,
    dateEvidence: "PMB original tst_start timestamp",
    firstDay,
    reportRequests: 1,
    identityEvidence: !firstDay ? "no-positive-pours-returned"
      : firstDay.productOnlyRows ? "product-plu-only-or-mixed" : "physical-tap-and-product-plu",
    firstEverVerified: false,
    note: "Earliest positive pour returned in this search window, not proof of the product's first-ever pour. PMB retention and historical PLU reuse can limit the evidence. Product-only rows do not verify a historical wall assignment.",
  };
}

export async function findFirstPoursForTaps({ targets, startDate, endDate, readTransactions, now = new Date() }) {
  const range = getFirstPourWindow(startDate, endDate, now);
  const rows = await readTransactions({ start_time: pmbLocalMidnight(range.start), end_time: pmbLocalMidnight(range.end) });
  const items = [];
  for (const target of targets) {
    items.push(await findFirstPourInRange({ target, startDate, endDate, now, readTransactions: async () => rows }));
  }
  return {
    source: "PMB transaction reports", timeZone, searchedStartDate: startDate, searchedEndDate: endDate,
    reportRequests: 1, tapCount: targets.length, transactionCount: rows.length, items,
  };
}

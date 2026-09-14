import { firstPourSnapshot } from "./pmb-first-pour-snapshot.mjs";

const normalizeName = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const easternDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

// Display evidence only: never use product-wide first pours as assignment dates
// or as the starting point for demand calculations.
export function getTapFirstPour(current, snapshot = firstPourSnapshot) {
  if (!current || !(Number(current.plu) > 0)) return null;
  const name = normalizeName(current.name || current.tapProduct);
  if (!name) return null;
  const record = snapshot.rows.find((row) => (
    Number(row.tapNumber) === Number(current.tapNumber)
    && Number(row.plu) === Number(current.plu)
    && normalizeName(row.product) === name
  ));
  const timestamp = Date.parse(record?.firstRecordedPourAt || "");
  if (!Number.isFinite(timestamp) || timestamp < Date.parse("2026-01-01T00:00:00-05:00")) return null;
  return {
    label: "Earliest PMB pour found",
    date: easternDate.format(timestamp),
    note: `Product history through ${snapshot.searchedEndDate}; not a verified first pour on this tap.${snapshot.hasCoverageGaps ? " Some historical reports were unavailable." : ""}`,
  };
}

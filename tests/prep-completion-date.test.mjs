import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatCalendarDate, formatUpdatedAt } from "../public/dashboard-formatters.mjs";
import { buildWeeklySnapshotCompletion } from "../public/weekly-snapshot-completion.mjs";

test("backdated prep retains its calendar day without inventing a time in every prep view", () => {
  const date = "2026-10-15";
  const label = "Oct 15, 2026";
  assert.equal(formatCalendarDate(date), label);
  assert.equal(formatUpdatedAt(date), label);
  for (const [file, name] of [["dashboard.js", "formatDashboardPrepTime"], ["staff-dashboard.js", "formatCompletionTime"]]) {
    const source = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
    const body = source.match(new RegExp(`function ${name}\\(value\\) \\{([\\s\\S]*?)\\n\\}`))[1];
    const format = new Function("formatCalendarDate", `return function(value) {${body}}`)(formatCalendarDate);
    assert.equal(format(date), label);
    assert.match(format("2026-10-15T17:04:24Z"), /\d:\d{2}/);
  }
  const snapshot = buildWeeklySnapshotCompletion({
    generatedAt: "2026-10-12T19:23:03.740Z",
    prep: { items: [{ id: "cocktail:bacardi", name: "Bacardi Sunset", completed: true,
      preparedBy: "Molly Adams", completedAt: date, updatedAt: "2026-10-16T18:00:00Z" }] },
  });
  assert.equal(snapshot.cocktails[0].completedAt, date);
  assert.equal(snapshot.cocktails[0].updatedAt, "2026-10-16T18:00:00Z");
});

test("date-only formatting leaves precise timestamps alone and rejects invalid dates", () => {
  for (const value of ["", null, "2026-02-30", "2026-10-15T17:04:24Z", "not a date"]) {
    assert.equal(formatCalendarDate(value), "");
  }
  assert.match(formatUpdatedAt("2026-10-15T17:04:24Z"), /\d:\d{2}/);
});

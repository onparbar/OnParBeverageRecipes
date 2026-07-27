import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const historyFiles = [
  "../public/data/weekly-usage-history.csv",
  "../public/data/weekly-usage-history-extra.csv",
];

async function getHistoryTapNumbers(productName) {
  const tapNumbers = [];
  for (const file of historyFiles) {
    const text = await readFile(new URL(file, import.meta.url), "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const cells = line.split(",");
      if (String(cells[2] || "").trim() === productName) {
        tapNumbers.push(Number(cells[1]));
      }
    });
  }
  return tapNumbers;
}

test("historical wall-two cocktail rows use their distinct tap numbers", async () => {
  assert.deepEqual(
    await getHistoryTapNumbers("STRAWBERRY SENORITA (JOSE CUERVO) 2"),
    [102, 102, 102],
  );
  assert.deepEqual(
    await getHistoryTapNumbers("STRAWBERRY SENORITA (JOSE CUERVO) 1"),
    [55, 55, 55],
  );
});

test("Boozy Cucumber and Espresso retain their separate wall-one taps", async () => {
  assert.deepEqual(
    await getHistoryTapNumbers("BOOZY CUCUMBER LEMONADE (KETEL ONE) 1"),
    [58, 58, 58],
  );
  assert.deepEqual(
    await getHistoryTapNumbers("ESPRESSO MARTINI (TITO'S) 1"),
    [59, 59, 59],
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COCKTAIL_RECIPE_YIELDS,
  getCocktailAwareKegFullOunces,
  getCocktailRecipeYieldOz,
  normalizeCocktailRecipeName,
} from "../public/cocktail-recipe-yields.mjs";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
}

function getDeclaredRecipeYields(text) {
  const rows = parseCsv(text);
  const header = rows[0] || [];
  const results = new Map();

  for (let index = 0; index < header.length; index += 1) {
    const sourceTitle = clean(header[index]);
    if (
      !sourceTitle
      || clean(header[index + 1]).toLowerCase() !== "$"
      || clean(header[index + 2]).toLowerCase() !== "oz"
    ) continue;

    const totalRow = rows.slice(2).find((row) => clean(row[index]).toLowerCase() === "total oz");
    results.set(sourceTitle, toNumber(totalRow?.[index + 1] || totalRow?.[index + 2]));
  }
  return results;
}

function getRecipeColumn(text, sourceTitle) {
  const rows = parseCsv(text);
  const index = (rows[0] || []).findIndex((value) => clean(value) === sourceTitle);
  assert.ok(index >= 0, sourceTitle);
  return rows.slice(2).map((row) => ({
    label: clean(row[index]),
    cost: toNumber(row[index + 1]),
    oz: toNumber(row[index + 2]),
  })).filter(({ label }) => label);
}

function getRecipeMetric(recipe, label) {
  return recipe.find((row) => row.label.toLowerCase() === label.toLowerCase())?.cost;
}

function roundToHundredths(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const sourceRecipes = [
  ["Whiskey Smash", 1463],
  ["Apple Jack (Whiskey)", 1530],
  ["On Par Tee", 1452],
  ["Bacardi Sunset", 1379.05],
  ["Crown Apple 'rita(Whiskey)", 1471],
  ["Vodka Cran(Vodka)", 1379],
  ["Lemon Drop Martini(Vodka)", 1448],
  ["Apple-tini(Vodka)", 1437],
  ["Pomegranate Martini(Tito's)", 1437],
  ["Ginny from the Block (Gin)", 1379],
  ["Captain Quencher (Rum)", 1497],
  ["House Margarita (Tequilla)", 1456],
  ["Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)", 1540],
  ["Strawberry Senorita (Tequilla)", 1379],
  ["Blue Dot (Vodka)", 1508],
  ["Boozy Cucumber Lemonade (Vodka)", 1430],
  ["Spiked Cranberry Lemonade (Vodka)", 1379],
  ["Spiked Strawberry Lemonade (Vodka)", 1379],
  ["Spiked Arnold Palmer (Vodka)", 1507],
  ["Jack and Lemonade (Whiskey)", 1507],
  ["Jacked Up Strawberry Lemonade (Whiskey)", 1379],
  ["Old fashioned (Whiskey)", 1379],
  ["Whiskey Sour (Whiskey)", 1360],
  ["Washington Apple (Whiskey)", 1123],
  ["Espresso Martini", 1500],
];

const activeDisplayAliases = [
  ["GIN & JUICE (BOMBAY)", 1379],
  ["CAPTAIN QUENCHER (CAPTAIN MORGAN)", 1497],
  ["BLUEBERRY MARGARITA (JOSE CUERVO)", 1540],
  ["HOUSE MARGARITA (JOSE CUERVO)", 1456],
  ["PEACH MARGARITA (JOSE CUERVO)", 1540],
  ["RASPBERRY MARGARITA (JOSE CUERVO)", 1540],
  ["STRAWBERRY MARGARITA (JOSE CUERVO)", 1540],
  ["WATERMELON MARGARITA (JOSE CUERVO)", 1540],
  ["STRAWBERRY SENORITA (JOSE CUERVO)", 1379],
  ["APPLETINI (TITO'S)", 1437],
  ["BLUE DOT (SVEDKA)", 1508],
  ["BOOZY CUCUMBER LEMONADE (KETEL ONE)", 1430],
  ["ESPRESSO MARTINI (TITO'S)", 1500],
  ["LEMON DROP MARTINI (ABSOLUT CITRON)", 1448],
  ["POMEGRANATE MARTINI (TITO'S)", 1437],
  ["SPIKED ARNOLD PALMER (TITO'S)", 1507],
  ["SPIKED CRANBERRY LEMONADE (TITO'S)", 1379],
  ["SPIKED PINK LEMONADE (TITO'S)", 1379],
  ["SPIKED STRAWBERRY LEMONADE (TITO'S)", 1379],
  ["VODKA CRAN (TITO'S)", 1379],
  ["CROWN APPLE 'RITA", 1471],
  ["JACKED UP STRAWBERRY LEMONADE (JACK DANIELS)", 1379],
  ["OLD FASHIONED (BULLEIT)", 1379],
  ["JACK & LEMONADE", 1507],
  ["WASHINGTON APPLE (CROWN ROYAL APPLE)", 1123],
  ["WHISKEY SOUR (JACK DANIELS)", 1360],
];

test("resolves all 25 source recipe titles to their declared batch yields", () => {
  assert.equal(COCKTAIL_RECIPE_YIELDS.length, 25);
  sourceRecipes.forEach(([name, expectedYieldOz]) => {
    assert.equal(getCocktailRecipeYieldOz(name), expectedYieldOz, name);
  });
});

test("canonical yields stay synchronized with the recipe CSV", async () => {
  const sources = await Promise.all([
    "../public/data/cocktail-recipes.csv",
    "../public/data/new-cocktails.csv",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const declaredYields = new Map(sources.flatMap((source) => [...getDeclaredRecipeYields(source)]));

  assert.equal(declaredYields.size, 25);
  COCKTAIL_RECIPE_YIELDS.forEach(({ sourceTitle, yieldOz }) => {
    assert.equal(declaredYields.get(sourceTitle), yieldOz, sourceTitle);
  });
});

test("Whiskey Smash and On Par Tee source instructions agree with their ounce math", async () => {
  for (const file of [
    "../public/data/cocktail-recipes.csv",
    "../public/data/new-cocktails.csv",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const whiskeySmash = getRecipeColumn(source, "Whiskey Smash");
    const onParTee = getRecipeColumn(source, "On Par Tee");

    assert.equal(
      whiskeySmash.find(({ label }) => label === "Lemonade = 2.5 gallons")?.oz,
      320,
    );
    assert.equal(
      whiskeySmash.find(({ label }) => label === "Water= 4.5 gallons")?.oz,
      576,
    );
    assert.equal(
      whiskeySmash.find(({ label }) => label.toLowerCase() === "total oz")?.cost,
      1463,
    );
    assert.equal(
      onParTee.find(({ label }) => label === "Peach Schnapps= 8 bottles")?.oz,
      270,
    );
    assert.equal(
      onParTee.find(({ label }) => label === "Sour Mix= 2 gallons")?.oz,
      256,
    );
    assert.equal(
      onParTee.find(({ label }) => label === "Lemonade= 2.5 gallons")?.oz,
      320,
    );
    assert.equal(
      onParTee.find(({ label }) => label === "Water= 1.5 gallons")?.oz,
      192,
    );
    assert.equal(
      onParTee.find(({ label }) => label.toLowerCase() === "total oz")?.cost,
      1452,
    );
  }
});

test("Bacardi Sunset uses eight gallons of strawberry lemonade and six 1.75L Bacardi bottles", async () => {
  const source = await readFile(new URL("../public/data/new-cocktails.csv", import.meta.url), "utf8");
  const recipe = getRecipeColumn(source, "Bacardi Sunset");

  assert.equal(recipe.find(({ label }) => label === "Bacardi Superior = 6 bottles (1.75L)")?.oz, 355.05);
  assert.equal(recipe.find(({ label }) => label === "Strawberry Lemonade = 8 gallons")?.oz, 1024);
  assert.equal(getRecipeMetric(recipe, "Total oz"), 1379.05);
});

test("new cocktail costs and pricing metrics agree with their recipe files", async () => {
  const fixtures = [
    {
      file: "../public/data/cocktail-recipes.csv",
      recipes: [
        {
          title: "Whiskey Smash",
          totalCost: 256.09,
          totalOz: 1463,
          costPerOz: 0.18,
          chargePerOz: 2.09,
          profitPerOz: 1.91,
          margin: 91.62,
          pourOz: 5.30,
          chargePerPour: 11.08,
        },
        {
          title: "On Par Tee",
          totalCost: 532.84,
          totalOz: 1452,
          costPerOz: 0.37,
          chargePerOz: 2.49,
          profitPerOz: 2.12,
          margin: 85.26,
          pourOz: 5.26,
          chargePerPour: 13.10,
        },
      ],
    },
    {
      file: "../public/data/new-cocktails.csv",
      recipes: [
        {
          title: "Whiskey Smash",
          totalCost: 256.09,
          totalOz: 1463,
          costPerOz: 0.18,
          chargePerOz: 1.99,
          profitPerOz: 1.81,
          margin: 91.20,
          pourOz: 5.30,
          chargePerPour: 10.55,
        },
        {
          title: "On Par Tee",
          totalCost: 532.84,
          totalOz: 1452,
          costPerOz: 0.37,
          chargePerOz: 1.99,
          profitPerOz: 1.62,
          margin: 81.56,
          pourOz: 5.26,
          chargePerPour: 10.47,
        },
        {
          title: "Bacardi Sunset",
          totalCost: 184.42,
          totalOz: 1379.05,
          costPerOz: 0.13,
          chargePerOz: 1.99,
          profitPerOz: 1.86,
          margin: 93.28,
          pourOz: 5.83,
          chargePerPour: 11.60,
        },
      ],
    },
  ];

  for (const { file, recipes: expectedRecipes } of fixtures) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const expected of expectedRecipes) {
      const recipe = getRecipeColumn(source, expected.title);
      const totalPriceIndex = recipe.findIndex(({ label }) => label.toLowerCase() === "total price");
      const ingredientCost = roundToHundredths(
        recipe.slice(0, totalPriceIndex).reduce((sum, row) => sum + row.cost, 0),
      );
      const ingredientOz = roundToHundredths(
        recipe.slice(0, totalPriceIndex).reduce((sum, row) => sum + row.oz, 0),
      );
      const exactCostPerOz = expected.totalCost / expected.totalOz;

      assert.equal(ingredientCost, expected.totalCost, `${file}: ${expected.title} ingredient cost`);
      assert.equal(ingredientOz, expected.totalOz, `${file}: ${expected.title} ingredient ounces`);
      assert.equal(getRecipeMetric(recipe, "Total price"), expected.totalCost, `${file}: ${expected.title} total cost`);
      assert.equal(getRecipeMetric(recipe, "Total oz"), expected.totalOz, `${file}: ${expected.title} yield`);
      assert.equal(getRecipeMetric(recipe, "Total price per oz"), expected.costPerOz, `${file}: ${expected.title} cost/oz`);
      assert.equal(getRecipeMetric(recipe, "Price we're charging"), expected.chargePerOz, `${file}: ${expected.title} price/oz`);
      assert.equal(getRecipeMetric(recipe, "Profit per oz"), expected.profitPerOz, `${file}: ${expected.title} profit/oz`);
      assert.equal(getRecipeMetric(recipe, "Profit margin"), expected.margin, `${file}: ${expected.title} margin`);
      assert.equal(
        recipe.find(({ label }) => label.toLowerCase().startsWith("cost for 1.5 oz of liquor"))?.cost,
        expected.chargePerPour,
        `${file}: ${expected.title} charge/pour`,
      );
      assert.equal(getRecipeMetric(recipe, "How many oz per shot"), expected.pourOz, `${file}: ${expected.title} pour`);

      assert.equal(roundToHundredths(exactCostPerOz), expected.costPerOz);
      assert.equal(roundToHundredths(expected.chargePerOz - exactCostPerOz), expected.profitPerOz);
      assert.equal(
        roundToHundredths(((expected.chargePerOz - exactCostPerOz) / expected.chargePerOz) * 100),
        expected.margin,
      );
      assert.equal(roundToHundredths(expected.pourOz * expected.chargePerOz), expected.chargePerPour);
    }
  }
});

test("resolves all 26 active display aliases, including wall-number suffixes", () => {
  assert.equal(activeDisplayAliases.length, 26);
  activeDisplayAliases.forEach(([name, expectedYieldOz]) => {
    assert.equal(getCocktailRecipeYieldOz(name), expectedYieldOz, name);
    assert.equal(getCocktailRecipeYieldOz(`${name} 1`), expectedYieldOz, `${name} 1`);
    assert.equal(getCocktailRecipeYieldOz(`${name} 2 `), expectedYieldOz, `${name} 2`);
  });
});

test("every active cocktail tap in the wall template resolves to a declared yield", async () => {
  const template = await readFile(
    new URL("../public/data/keg-levels-template.csv", import.meta.url),
    "utf8",
  );
  const activeCocktailNames = template
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+,Cocktail,(.+?)\s*$/)?.[1] || "")
    .filter(Boolean);

  assert.equal(activeCocktailNames.length, 36);
  activeCocktailNames.forEach((name) => {
    assert.ok(getCocktailRecipeYieldOz(name) > 0, name);
  });
});

test("keeps renamed recipes and flavored margaritas on their canonical yields", () => {
  [
    ["Ginny from the Block (Gin)", "GIN & JUICE (BOMBAY)", 1379],
    ["Apple-tini(Vodka)", "APPLETINI (TITO'S)", 1437],
    ["Spiked Strawberry Lemonade (Vodka)", "SPIKED PINK LEMONADE (TITO'S)", 1379],
    ["Spiked Strawberry Lemonade (Vodka)", "SPIKED STRAWBERRY LEMONADE (TITO'S)", 1379],
  ].forEach(([sourceName, displayName, expectedYieldOz]) => {
    assert.equal(getCocktailRecipeYieldOz(sourceName), expectedYieldOz);
    assert.equal(getCocktailRecipeYieldOz(displayName), expectedYieldOz);
  });

  activeDisplayAliases
    .filter(([name]) => /(?:BLUEBERRY|PEACH|RASPBERRY|STRAWBERRY|WATERMELON) MARGARITA/.test(name))
    .forEach(([name]) => assert.equal(getCocktailRecipeYieldOz(name), 1540, name));
});

test("normalizes punctuation and returns zero for an unknown cocktail", () => {
  assert.equal(normalizeCocktailRecipeName(" JACK & LEMONADE 2 "), "jack and lemonade");
  assert.equal(normalizeCocktailRecipeName("CAPTAIN QUENCHER 1(CAPTAIN MORGAN) 1"), "captain quencher");
  assert.equal(
    getCocktailRecipeYieldOz({
      name: "Unrecognized PMB label",
      templateBrand: "GIN & JUICE (BOMBAY) 1",
    }),
    1379,
  );
  assert.equal(getCocktailRecipeYieldOz("Generic Cocktail"), 0);
  assert.equal(getCocktailRecipeYieldOz(null), 0);
});

test("prefers a normalized current product name over prior template names", () => {
  assert.equal(
    getCocktailRecipeYieldOz({
      currentName: "On Par Tee",
      name: "Whiskey Smash",
      templateBrand: "SPIKED CRANBERRY LEMONADE (TITO'S) 1",
    }),
    1452,
  );
});

test("Keg Levels sizing prefers named cocktails before generic PMB sizes", () => {
  assert.equal(
    getCocktailAwareKegFullOunces(
      {
        name: "On Par Tee",
        rawKegSize: 1536,
        rawKegSizeDp: 0,
      },
      {
        name: "Whiskey Smash",
        type: "Cocktail",
      },
      1536,
    ),
    1452,
  );
  assert.equal(
    getCocktailAwareKegFullOunces(
      {
        name: "Unknown PMB Product",
        rawKegSize: 1536,
        rawKegSizeDp: 0,
      },
      {
        name: "Whiskey Smash",
        type: "Cocktail",
      },
      1536,
    ),
    1463,
  );
  assert.equal(
    getCocktailAwareKegFullOunces(
      {
        name: "Unknown PMB Product",
        rawKegSize: 14000,
        rawKegSizeDp: 1,
      },
      null,
      1536,
    ),
    1400,
  );
});

const recipeYieldDefinitions = [
  {
    sourceTitle: "Whiskey Smash",
    yieldOz: 1463,
    aliases: [],
  },
  {
    sourceTitle: "Apple Jack (Whiskey)",
    yieldOz: 1530,
    aliases: [],
  },
  {
    sourceTitle: "On Par Tee",
    yieldOz: 1452,
    aliases: [],
  },
  {
    sourceTitle: "Bacardi Sunset",
    yieldOz: 1379.05,
    aliases: [],
  },
  {
    sourceTitle: "Crown Apple 'rita(Whiskey)",
    yieldOz: 1471,
    aliases: ["CROWN APPLE 'RITA"],
  },
  {
    sourceTitle: "Vodka Cran(Vodka)",
    yieldOz: 1379,
    aliases: ["VODKA CRAN (TITO'S)"],
  },
  {
    sourceTitle: "Lemon Drop Martini(Vodka)",
    yieldOz: 1448,
    aliases: ["LEMON DROP MARTINI (ABSOLUT CITRON)"],
  },
  {
    sourceTitle: "Apple-tini(Vodka)",
    yieldOz: 1437,
    aliases: ["APPLETINI (TITO'S)"],
  },
  {
    sourceTitle: "Pomegranate Martini(Tito's)",
    yieldOz: 1437,
    aliases: ["POMEGRANATE MARTINI (TITO'S)"],
  },
  {
    sourceTitle: "Ginny from the Block (Gin)",
    yieldOz: 1379,
    aliases: ["GIN & JUICE (BOMBAY)"],
  },
  {
    sourceTitle: "Captain Quencher (Rum)",
    yieldOz: 1497,
    aliases: ["CAPTAIN QUENCHER (CAPTAIN MORGAN)"],
  },
  {
    sourceTitle: "House Margarita (Tequilla)",
    yieldOz: 1456,
    aliases: ["HOUSE MARGARITA (JOSE CUERVO)"],
  },
  {
    sourceTitle: "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)",
    yieldOz: 1540,
    aliases: [
      "BLUEBERRY MARGARITA (JOSE CUERVO)",
      "PEACH MARGARITA (JOSE CUERVO)",
      "RASPBERRY MARGARITA (JOSE CUERVO)",
      "STRAWBERRY MARGARITA (JOSE CUERVO)",
      "WATERMELON MARGARITA (JOSE CUERVO)",
    ],
  },
  {
    sourceTitle: "Strawberry Senorita (Tequilla)",
    yieldOz: 1379,
    aliases: ["STRAWBERRY SENORITA (JOSE CUERVO)"],
  },
  {
    sourceTitle: "Blue Dot (Vodka)",
    yieldOz: 1508,
    aliases: ["BLUE DOT (SVEDKA)"],
  },
  {
    sourceTitle: "Boozy Cucumber Lemonade (Vodka)",
    yieldOz: 1430,
    aliases: ["BOOZY CUCUMBER LEMONADE (KETEL ONE)"],
  },
  {
    sourceTitle: "Spiked Cranberry Lemonade (Vodka)",
    yieldOz: 1379,
    aliases: ["SPIKED CRANBERRY LEMONADE (TITO'S)"],
  },
  {
    sourceTitle: "Spiked Strawberry Lemonade (Vodka)",
    yieldOz: 1379,
    aliases: [
      "SPIKED PINK LEMONADE (TITO'S)",
      "SPIKED STRAWBERRY LEMONADE (TITO'S)",
    ],
  },
  {
    sourceTitle: "Spiked Arnold Palmer (Vodka)",
    yieldOz: 1507,
    aliases: ["SPIKED ARNOLD PALMER (TITO'S)"],
  },
  {
    sourceTitle: "Jack and Lemonade (Whiskey)",
    yieldOz: 1507,
    aliases: ["JACK & LEMONADE"],
  },
  {
    sourceTitle: "Jacked Up Strawberry Lemonade (Whiskey)",
    yieldOz: 1379,
    aliases: ["JACKED UP STRAWBERRY LEMONADE (JACK DANIELS)"],
  },
  {
    sourceTitle: "Old fashioned (Whiskey)",
    yieldOz: 1379,
    aliases: ["OLD FASHIONED (BULLEIT)"],
  },
  {
    sourceTitle: "Whiskey Sour (Whiskey)",
    yieldOz: 1360,
    aliases: ["WHISKEY SOUR (JACK DANIELS)"],
  },
  {
    sourceTitle: "Washington Apple (Whiskey)",
    yieldOz: 1123,
    aliases: ["WASHINGTON APPLE (CROWN ROYAL APPLE)"],
  },
  {
    sourceTitle: "Espresso Martini",
    yieldOz: 1500,
    aliases: ["ESPRESSO MARTINI (TITO'S)"],
  },
];

export const COCKTAIL_RECIPE_YIELDS = Object.freeze(
  recipeYieldDefinitions.map((definition) => Object.freeze({
    ...definition,
    aliases: Object.freeze([...definition.aliases]),
  })),
);

export function normalizeCocktailRecipeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?:\s+[123])+\s*$/, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const recipeYieldByName = new Map(
  COCKTAIL_RECIPE_YIELDS.flatMap(({ sourceTitle, yieldOz, aliases }) => (
    [sourceTitle, ...aliases].map((name) => [normalizeCocktailRecipeName(name), yieldOz])
  )),
);

export function getCocktailRecipeYieldOz(value) {
  const candidates = value && typeof value === "object"
    ? [
        value.currentName,
        value.name,
        value.brand,
        value.tapProduct,
        value.templateBrand,
        value.title,
        value.sourceTitle,
      ]
    : [value];

  for (const candidate of candidates) {
    const yieldOz = recipeYieldByName.get(normalizeCocktailRecipeName(candidate));
    if (yieldOz) return yieldOz;
  }
  return 0;
}

function toPositiveNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getCocktailAwareKegFullOunces(liveRow, item = null, fallbackOz = 0) {
  const namedYieldOz = getCocktailRecipeYieldOz(liveRow)
    || getCocktailRecipeYieldOz(item);
  if (namedYieldOz) return namedYieldOz;

  const rawKegSize = toPositiveNumber(liveRow?.rawKegSize);
  if (rawKegSize) {
    const decimalPlaces = Math.max(0, Math.round(toPositiveNumber(liveRow?.rawKegSizeDp)));
    return decimalPlaces ? rawKegSize / (10 ** decimalPlaces) : rawKegSize;
  }

  return toPositiveNumber(fallbackOz);
}

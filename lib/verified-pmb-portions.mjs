function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function portionKey(plu, portionName) {
  return (Number(plu) || 0) + ":" + clean(portionName).toLowerCase();
}

const VERIFIED_PATIO_PORTIONS = [
  [145687, 63, 157], [126598, 350, 351], [38216, 16, 105], [124587, 329, 330],
  [59864, 53, 137], [112354, 64, 154], [196548, 325, 326], [121547, 323, 324],
  [56439, 51, 130], [56542, 46, 131], [32549, 23, 95], [136985, 317, 318],
  [34615, 42, 96], [16824, 43, 86], [145876, 345, 346], [46581, 41, 114],
  [35137, 25, 97], [112478, 356, 357], [3, 33, 65], [145871, 332, 333],
];

// Read from PMB's Items table and product catalog on 2026-09-11.
// These are distinct Karaoke items, not the corresponding Patio item IDs.
// PMB's Portions table defines Single as 1.500 oz and Double as 2.000 oz.
const VERIFIED_KARAOKE_PORTIONS = [
  [196542, 327, 328], [145831, 343, 344], [52323, 52, 118],
  [46287, 30, 113], [25469, 31, 89], [35417, 32, 98],
  [23154, 34, 88], [132541, 321, 322], [115468, 354, 355],
  [4, 37, 66],
];

const VERIFIED_BY_KEY = new Map([...VERIFIED_PATIO_PORTIONS, ...VERIFIED_KARAOKE_PORTIONS].flatMap(([plu, singleId, doubleId]) => [
  [portionKey(plu, "Single"), { itemId: String(singleId), quantityOz: 1.5 }],
  [portionKey(plu, "Double"), { itemId: String(doubleId), quantityOz: 2 }],
]));

export const VERIFIED_PMB_PORTION_SCHEMA = Object.freeze({
  itemIdField: "__onParVerifiedItemId",
  quantityField: "__onParVerifiedQuantityOz",
  quantityDpField: "",
});

export function attachVerifiedPmbPortionIdentity(itemRows = []) {
  return (Array.isArray(itemRows) ? itemRows : []).map((row) => {
    const verified = VERIFIED_BY_KEY.get(portionKey(row?.product_plu, row?.portion_name));
    return verified ? {
      ...row,
      [VERIFIED_PMB_PORTION_SCHEMA.itemIdField]: verified.itemId,
      [VERIFIED_PMB_PORTION_SCHEMA.quantityField]: verified.quantityOz,
    } : row;
  });
}

export function getOwnerVerifiedPmbPortionRows(itemRows = []) {
  return attachVerifiedPmbPortionIdentity(itemRows).filter((row) => (
    clean(row?.[VERIFIED_PMB_PORTION_SCHEMA.itemIdField])
    && Number(row?.[VERIFIED_PMB_PORTION_SCHEMA.quantityField]) > 0
  ));
}

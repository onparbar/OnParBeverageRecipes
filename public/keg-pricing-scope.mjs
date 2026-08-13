function tapNumberOf(item) {
  return Number(item?.tapNumber ?? item?.tapPosition) || 0;
}

export function filterCurrentTapPricingItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => (
      item?.isCurrentTap === true
      && String(item?.tapMatchSource || "").trim() === "pmb-tap-config"
      && tapNumberOf(item) > 0
    ))
    .slice()
    .sort((a, b) => tapNumberOf(a) - tapNumberOf(b)
      || String(a?.name || "").localeCompare(String(b?.name || "")));
}

export function buildVerifiedCurrentBeerTapItems({
  wallItems = [],
  liveLevelItems = [],
  tapPriceItems = [],
  isBeerTapPosition = () => false,
} = {}) {
  const beerWallByTap = new Map(
    wallItems
      .filter((item) => isBeerTapPosition(item))
      .map((item) => [tapNumberOf(item), item]),
  );
  const verifiedLevelsByTap = new Map();

  liveLevelItems.forEach((item) => {
    const tapNumber = tapNumberOf(item);
    const wallItem = beerWallByTap.get(tapNumber);
    if (!tapNumber || !wallItem || verifiedLevelsByTap.has(tapNumber)) return;
    verifiedLevelsByTap.set(tapNumber, {
      ...item,
      tapNumber,
      tapPosition: tapNumber,
      wall: wallItem.wall,
      type: wallItem.type || "Beer",
      matchedBrand: item.tapProduct || item.name || "",
      templateBrand: wallItem.brand || "",
      isCurrentTap: true,
      tapMatchSource: "pmb-keg-levels",
    });
  });

  if (verifiedLevelsByTap.size) {
    return [...verifiedLevelsByTap.values()].sort((a, b) => tapNumberOf(a) - tapNumberOf(b));
  }

  return tapPriceItems
    .filter((item) => item?.isCurrentTap === true && isBeerTapPosition(item))
    .slice()
    .sort((a, b) => tapNumberOf(a) - tapNumberOf(b));
}

export function buildAssignedOnDeckBeerItems({
  wallItems = [],
  isBeerTapPosition = () => false,
  resolveOnDeck = () => null,
} = {}) {
  return wallItems.flatMap((item) => {
    if (!isBeerTapPosition(item)) return [];
    const onDeck = resolveOnDeck(item);
    if (!onDeck || String(onDeck.kind || "").toLowerCase() !== "beer") return [];
    const tapNumber = tapNumberOf(item);
    return [{
      ...onDeck,
      tapNumber,
      wall: item.wall || "",
      type: "Beer",
      sourceTapLabel: `On Deck for ${item.wall || "wall"} ${tapNumber}`,
      isOnDeckProduct: true,
    }];
  });
}

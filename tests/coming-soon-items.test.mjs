import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  getActiveComingSoonItems,
  consolidateComingSoonItems,
  getComingSoonKindLabel,
  mergeRequiredComingSoonItems,
  REQUIRED_COMING_SOON_ITEMS,
} from "../public/coming-soon-items.mjs";
import { buildKegOnDeckOptions } from "../public/keg-on-deck-options.mjs";

test("shows only unresolved products in the Coming Soon section", () => {
  const active = getActiveComingSoonItems([
    { id: "beer:waiting", name: "Waiting Lager" },
    { id: "recipe:completed", name: "Completed Cocktail", replacedAt: "2026-08-30T12:00:00.000Z" },
    null,
  ]);

  assert.deepEqual(active, [{ id: "beer:waiting", name: "Waiting Lager" }]);
});

test("keeps the required products in Coming Soon", () => {
  assert.deepEqual(
    REQUIRED_COMING_SOON_ITEMS.map(({ name }) => name),
    [
      "On Par Tee (Crown Royal) 1",
      "Whiskey Smash (Jim Beam) 1",
      "Triple Jam Cider 2",
      "Vodka Cran (Tito's) 2",
      "Maker's Mark",
      "Ciroc Pineapple",
    ],
  );

  const merged = mergeRequiredComingSoonItems([]);
  assert.equal(merged.length, 6);
  assert.deepEqual(merged.map(({ kind }) => kind), ["recipe", "recipe", "beer", "recipe", "liquor", "liquor"]);
  assert.deepEqual(
    merged.find(({ id }) => id === "recipe:vodka-cran-2"),
    {
      id: "recipe:vodka-cran-2",
      kind: "recipe",
      recipeId: "vodka-cran-tito-s",
      name: "Vodka Cran (Tito's) 2",
      cloneSourceName: "VODKA CRAN (TITO'S) 1",
      imageUrl: "/images/products/vodka-cran-2.png",
    },
  );
  assert.equal(merged.some(({ id }) => id === "liquor:don-julio-blanco-2"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:woodford-reserve"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:captain-morgan"), false);
});

test("preserves saved Coming Soon details while removing retired products", () => {
  const merged = mergeRequiredComingSoonItems([
    {
      id: "recipe:on-par-tee",
      name: "On Par Tee",
      kind: "recipe",
      batchOz: 1452,
      imageUrl: "https://old.example/on-par-tee.png",
      replacedAt: "2026-08-14T18:00:00.000Z",
    },
    {
      id: "liquor:woodford-reserve",
      name: "Woodford Reserve",
      kind: "liquor",
      imageUrl: "https://labels.untappd.com/old-woodford",
      untappdQuery: "old broad search",
      untappdId: 6686987,
    },
    { id: "liquor:captain-morgan", name: "Captain Morgan", kind: "liquor" },
    { id: "liquor:don-julio-blanco-2", name: "Don Julio Blanco 2", kind: "liquor" },
    { id: "beer:99", name: "Future Lager", kind: "beer", plu: 99 },
  ]);

  assert.equal(merged.filter(({ id }) => id === "recipe:on-par-tee").length, 1);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.name, "On Par Tee (Crown Royal) 1");
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.batchOz, 1452);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.replacedAt, "2026-08-14T18:00:00.000Z");
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.imageUrl, "/images/products/on-par-tee-classic.png");
  assert.equal(merged.find(({ id }) => id === "recipe:whiskey-smash")?.imageUrl, "/images/products/whiskey-smash-classic.png");
  assert.equal(merged.some(({ id }) => id === "liquor:woodford-reserve"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:captain-morgan"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:don-julio-blanco-2"), false);
  assert.equal(merged.find(({ id }) => id === "beer:99")?.plu, 99);
});

test("removes the mistaken legacy Vodka Cran card in favor of the canonical clone", () => {
  const merged = mergeRequiredComingSoonItems([
    {
      id: "recipe:vodka-cran-tito-s",
      recipeId: "vodka-cran-tito-s",
      name: "VODKA CRAN (TITO'S)",
      kind: "recipe",
      chargePerOz: 2.09,
    },
    {
      id: "recipe:vodka-cran-2",
      recipeId: "vodka-cran-tito-s",
      name: "Vodka Cran (Tito's) 2",
      kind: "recipe",
    },
  ]);

  assert.equal(merged.some(({ id }) => id === "recipe:vodka-cran-tito-s"), false);
  assert.equal(merged.filter(({ id }) => id === "recipe:vodka-cran-2").length, 1);
  assert.equal(merged.find(({ id }) => id === "recipe:vodka-cran-2")?.cloneSourceName, "VODKA CRAN (TITO'S) 1");
  assert.equal(merged.find(({ id }) => id === "beer:triple-jam-2")?.imageUrl, "/images/products/triple-jam-cider-2.png");
  assert.equal(merged.find(({ id }) => id === "recipe:vodka-cran-2")?.imageUrl, "/images/products/vodka-cran-2.png");
});

test("labels beer, liquor, and cocktail Coming Soon items correctly", () => {
  assert.equal(getComingSoonKindLabel("beer"), "Beer keg");
  assert.equal(getComingSoonKindLabel("liquor"), "Liquor tap");
  assert.equal(getComingSoonKindLabel("recipe"), "Cocktail recipe");
  assert.equal(getComingSoonKindLabel("liquor", { compact: true }), "liquor");
});

test("consolidates a beer's draft and published entries while preserving its original ID", () => {
  const draft = { id: "beer:psychopathy", name: "Psychopathy", kind: "beer", plu: 0, createdAt: "2026-09-10T10:00:00Z", kegCost: 180 };
  const published = { id: "beer:4321", name: "PSYCHOPATHY", kind: "beer", plu: 4321, createdAt: "2026-09-10T11:00:00Z", pricePerOz: 0.6 };
  const merged = consolidateComingSoonItems([draft, published]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, draft.id);
  assert.equal(merged[0].createdAt, draft.createdAt);
  assert.equal(merged[0].plu, 4321);
  assert.equal(merged[0].kegCost, 180);
  assert.equal(merged[0].pricePerOz, 0.6);
  const reloaded = mergeRequiredComingSoonItems(merged, [{ kind: "beer", name: "Psychopathy", status: "ready", payload: {} }]);
  assert.equal(reloaded.filter((item) => /psychopathy/i.test(item.name)).length, 1);
  assert.equal(draft.plu, 0);
});

test("keeps distinct PMB products and numbered wall counterparts separate", () => {
  const items = [
    { id: "beer:1", kind: "beer", name: "Triple Jam Cider 1", plu: 1 },
    { id: "beer:2", kind: "beer", name: "Triple Jam Cider 2", plu: 2 },
    { id: "beer:3", kind: "beer", name: "Triple Jam Cider 1", plu: 3 },
  ];
  assert.equal(consolidateComingSoonItems(items).length, 3);
});

test("a completed duplicate cannot reappear as a waiting product", () => {
  const items = [
    { id: "beer:psychopathy", kind: "beer", name: "Psychopathy", plu: 0 },
    { id: "beer:4321", kind: "beer", name: "Psychopathy", plu: 4321, replacedAt: "2026-09-10T12:00:00Z", replaceTapKey: "main:21" },
  ];
  assert.equal(getActiveComingSoonItems(items).length, 0);
  assert.equal(consolidateComingSoonItems(items)[0].replaceTapKey, "main:21");
});

test("Bacardi Sunset is removed from old saved Coming Soon data and never reseeded", () => {
  const saved = [{ id: "recipe:bacardi-sunset", kind: "recipe", name: "Bacardi Sunset" }];
  assert.equal(getActiveComingSoonItems(saved).length, 0);
  assert.equal(mergeRequiredComingSoonItems(saved).some((item) => item.id === saved[0].id), false);
  assert.equal(saved.length, 1);
});

test("an older local Coming Soon draft cannot revive Octoberfest or omit the required liquor options", () => {
  const staleDraft = [
    { id: "beer:octoberfest", kind: "beer", name: "Octoberfest", kegCost: 185 },
    { id: "beer:psychopathy", kind: "beer", name: "Psychopathy", pricePerOz: 0.6 },
    { id: "beer:christmas-ale", kind: "beer", name: "Christmas Ale", kegCost: 204 },
  ];
  const queued = [{
    id: "pmb-publish:beer:octoberfest",
    kind: "beer",
    name: "Octoberfest",
    status: "ready",
    payload: { kegCost: 185 },
  }];
  const draftBefore = JSON.stringify(staleDraft);
  const queueBefore = JSON.stringify(queued);
  const merged = mergeRequiredComingSoonItems(staleDraft, queued);
  const replayed = mergeRequiredComingSoonItems(JSON.parse(JSON.stringify(merged)), queued);

  assert.equal(merged.some(item => item.id === "beer:octoberfest"), false);
  assert.equal(getActiveComingSoonItems(staleDraft).some(item => item.id === "beer:octoberfest"), false);
  for (const id of ["liquor:makers-mark", "liquor:ciroc-pineapple"]) {
    assert.equal(merged.filter(item => item.id === id).length, 1);
  }
  assert.equal(merged.find(item => item.id === "beer:psychopathy")?.pricePerOz, 0.6);
  assert.equal(merged.find(item => item.id === "beer:christmas-ale")?.kegCost, 204);
  assert.equal(JSON.stringify(replayed), JSON.stringify(merged), "reloads do not reintroduce or duplicate products");
  assert.equal(JSON.stringify(staleDraft), draftBefore, "the recoverable local draft stays untouched");
  assert.equal(JSON.stringify(queued), queueBefore, "the publishing queue stays untouched");
});

test("liquor defaults preserve saved prices, PMB identities, and completed-product history", () => {
  const saved = [
    {
      id: "liquor:makers-mark", kind: "liquor", name: "Maker's Mark",
      plu: 1234, bottleCost: 47, bottleOz: 59.1745, pricePerOz: 2.25,
      pmbActiveAt: "2026-10-01T16:00:00Z", replacedAt: "2026-10-02T16:00:00Z",
      replaceTapKey: "main-10", imageUrl: "/saved-makers-mark.png",
    },
    {
      id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple",
      plu: 5678, bottleCost: 29.99, bottleOz: 25.3605, pricePerOz: 2,
      description: "Saved product details", imageUrl: "/saved-ciroc-pineapple.png",
    },
    {
      id: "beer:octoberfest", kind: "beer", name: "Octoberfest",
      plu: 41438, replacedAt: "2026-09-28T16:00:00Z", kegCost: 182,
    },
  ];
  const before = JSON.stringify(saved);
  const merged = mergeRequiredComingSoonItems(saved);

  for (const original of saved.slice(0, 2)) {
    const item = merged.find(entry => entry.id === original.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(item?.[key], value, `${original.id}: ${key}`);
  }
  assert.equal(getActiveComingSoonItems(merged).some(item => item.id === "liquor:makers-mark"), false);
  assert.equal(getActiveComingSoonItems(merged).some(item => item.id === "liquor:ciroc-pineapple"), true);
  assert.equal(merged.some(item => item.id === "beer:octoberfest"), false);
  assert.equal(JSON.stringify(saved), before, "the saved Octoberfest archive and all other source records stay untouched");
});

test("minimal and blank liquor cards receive complete product details and approved portions", () => {
  const expected = [
    { id: "liquor:makers-mark", name: "Maker's Mark", abv: 45, cost: 49.99, size: 59.1745, label: "1.75 L", rate: 4.67, prices: [7, 9], image: "/images/products/makers-mark.webp" },
    { id: "liquor:ciroc-pineapple", name: "Ciroc Pineapple", abv: 35, cost: 38.99, size: 33.814, label: "1 L", rate: 8, prices: [12, 16], image: "/images/products/ciroc-pineapple.webp" },
  ];
  for (const product of expected) {
    for (const blanks of [{}, {
      name: "", kind: "", producer: " ", brewery: null, style: 0,
      description: "", imageUrl: null, abvPercent: 0, bottleCost: null,
      bottleOz: "0", bottleSizeLabel: " ", pricePerOz: 0, servingOz: null,
      targetMargin: 0, portions: [], priceStatus: null, plu: 9876,
    }]) {
      const saved = { id: product.id, kind: "liquor", name: product.name, ...blanks };
      const before = JSON.stringify(saved);
      const item = mergeRequiredComingSoonItems([saved]).find(entry => entry.id === product.id);
      assert.equal(item.name, product.name);
      assert.equal(item.kind, "liquor");
      for (const field of ["producer", "brewery", "style", "description"]) assert.ok(item[field]?.trim(), field);
      assert.equal(item.imageUrl, product.image);
      assert.equal(item.abvPercent, product.abv);
      assert.equal(item.bottleCost, product.cost);
      assert.equal(item.bottleOz, product.size);
      assert.equal(item.bottleSizeLabel, product.label);
      assert.equal(item.pricePerOz, product.rate);
      assert.equal(item.servingOz, 1.5);
      assert.equal(item.targetMargin, 82);
      assert.deepEqual(item.portions, [
        { name: "Single", quantityOz: 1.5, price: product.prices[0] },
        { name: "Double", quantityOz: 2, price: product.prices[1] },
      ]);
      assert.equal(item.priceStatus, "approved");
      if (saved.plu) assert.equal(item.plu, saved.plu);
      assert.equal(JSON.stringify(saved), before);
    }
  }
  const defaults = mergeRequiredComingSoonItems([]);
  const makers = defaults.find(item => item.id === "liquor:makers-mark");
  assert.equal(makers.bottleCostSource, "OHLQ largest bottle · 6060D");
  assert.equal(makers.bottleCostCheckedAt, "2026-11-02");
  const ciroc = defaults.find(item => item.id === "liquor:ciroc-pineapple");
  assert.equal(ciroc.bottleCostStatus, "verified");
  assert.equal(ciroc.bottleCostSource, "OHLQ largest bottle · 2056L");
  assert.equal(ciroc.bottleCostCheckedAt, "2026-11-02");
  assert.equal(ciroc.bottleCostSourceUrl, "https://www.ohlq.com/liquor/vodka/flavored/ciroc-pineapple?sku=2056l");
});

test("older seeded bottle records migrate to the largest OHLQ size and exact listed price together", () => {
  const saved = [
    { id: "liquor:makers-mark", kind: "liquor", name: "Maker's Mark", bottleCost: 47, bottleOz: 59.1745, bottleSizeLabel: "1.75 L", bottleCostSource: "Saved supplier price", bottleCostCheckedAt: "2026-09-10" },
    { id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple", bottleCost: 24.99, bottleOz: 25.3605, bottleSizeLabel: "750 mL", bottleCostSource: "OHLQ retail estimate", bottleCostCheckedAt: "2026-11-02", bottleCostStatus: "estimate" },
  ].map(item => ({ ...item, portions: [{ name: "Single", quantityOz: 1.5, price: 12 }], pricePerOz: 8, createdAt: "2026-11-02T20:16:13.371Z" }));
  const before = JSON.stringify(saved);
  const merged = mergeRequiredComingSoonItems(saved);
  for (const old of saved) {
    const item = merged.find(entry => entry.id === old.id);
    const required = REQUIRED_COMING_SOON_ITEMS.find(entry => entry.id === old.id);
    for (const field of ["bottleCost", "bottleOz", "bottleSizeLabel", "bottleCostStatus", "bottleCostSource", "bottleCostSourceUrl"]) assert.equal(item[field], required[field], field);
    assert.deepEqual(item.portions, old.portions);
    assert.equal(item.pricePerOz, old.pricePerOz);
    assert.equal(item.createdAt, old.createdAt);
    for (const changed of [{ bottleCost: 39 }, { bottleCostSource: "Supplier invoice" }, { plu: 1234 }, { replacedAt: "2026-11-02T21:00:00Z" }]) {
      const custom = { ...old, ...changed };
      const preserved = mergeRequiredComingSoonItems([custom]).find(entry => entry.id === old.id);
      for (const [field, value] of Object.entries(custom)) assert.deepEqual(preserved[field], value, field);
    }
  }
  assert.equal(JSON.stringify(saved), before);
  assert.equal(JSON.stringify(mergeRequiredComingSoonItems(merged)), JSON.stringify(merged));
});

test("saved liquor prices do not acquire conflicting portions or unearned approval", () => {
  const base = { id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple" };
  const customPortions = [{ name: "Single", quantityOz: 1.5, price: 10 }, { name: "Double", quantityOz: 2, price: 13 }];
  for (const saved of [
    { ...base, pricePerOz: 6 },
    { ...base, chargePerOz: 6 },
    { ...base, pricePerOz: 6, portions: customPortions },
    { ...base, portions: customPortions },
    { ...base, pricePerOz: 8 },
    { ...base, servingOz: 1 },
  ]) {
    const item = mergeRequiredComingSoonItems([saved]).find(entry => entry.id === base.id);
    assert.equal(item.priceStatus, undefined);
    if (saved.portions) assert.deepEqual(item.portions, saved.portions);
    else if (saved.pricePerOz !== 8) assert.equal(item.portions, undefined);
    if (saved.pricePerOz) assert.equal(item.pricePerOz, saved.pricePerOz);
    if (saved.chargePerOz) {
      assert.equal(item.chargePerOz, saved.chargePerOz);
      assert.equal(item.pricePerOz, saved.chargePerOz);
    }
    if (saved.servingOz) assert.equal(item.servingOz, saved.servingOz);
  }
  const savedApproval = { ...base, pricePerOz: 6, portions: customPortions, priceStatus: "approved", approvedAt: "2026-10-15T12:00:00Z" };
  const item = mergeRequiredComingSoonItems([savedApproval]).find(entry => entry.id === base.id);
  assert.equal(item.priceStatus, savedApproval.priceStatus);
  assert.equal(item.approvedAt, savedApproval.approvedAt);
  assert.deepEqual(item.portions, customPortions);
});

test("saved servingOz portions determine the ounce rate without being replaced by defaults", () => {
  const saved = {
    id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple",
    portions: [{ name: "Single", servingOz: 1.5, price: 10 }, { name: "Double", servingOz: 2, price: 13 }],
  };
  const item = mergeRequiredComingSoonItems([saved]).find(entry => entry.id === saved.id);
  assert.equal(item.pricePerOz, 10 / 1.5);
  assert.deepEqual(item.portions, saved.portions);
  assert.equal(item.priceStatus, undefined);
  assert.deepEqual(mergeRequiredComingSoonItems([item]).find(entry => entry.id === saved.id), item);
});

test("saved custom bottle costs and sizes never inherit fallback estimate attribution", () => {
  const base = { id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple" };
  const sourceFields = ["bottleCostStatus", "bottleCostSource", "bottleCostCheckedAt", "bottleCostSourceUrl"];
  for (const saved of [
    { ...base, bottleCost: 30, bottleOz: 25.3605 },
    { ...base, kegCost: 30, kegOz: 25.3605 },
    { ...base, bottleCost: 24.99, bottleOz: 33.814 },
  ]) {
    const item = mergeRequiredComingSoonItems([saved]).find(entry => entry.id === base.id);
    assert.equal(item.bottleCost, saved.bottleCost || saved.kegCost);
    assert.equal(item.bottleOz, saved.bottleOz || saved.kegOz);
    for (const field of sourceFields) assert.equal(item[field], undefined, field);
    if (item.bottleOz !== 33.814) assert.equal(item.bottleSizeLabel, undefined);
  }
  const saved = {
    ...base, bottleCost: 30, bottleOz: 25.3605, bottleCostStatus: "verified",
    bottleCostSource: "Supplier invoice", bottleCostCheckedAt: "2026-10-30",
    bottleCostSourceUrl: "https://supplier.example/invoice", bottleSizeLabel: "750 ml bottle",
  };
  const item = mergeRequiredComingSoonItems([saved]).find(entry => entry.id === base.id);
  for (const [field, value] of Object.entries(saved)) assert.deepEqual(item[field], value, field);
});

test("older liquor IDs and queued Maker's Mark retain their custom pricing when defaults are filled", () => {
  const saved = {
    id: "liquor:1234", kind: "liquor", name: "Maker's Mark", plu: 1234,
    bottleCost: 55, bottleOz: 59.1745, pricePerOz: 6, imageUrl: "/saved.png",
  };
  const queued = {
    id: "pmb-publish:liquor:maker-s-mark", kind: "liquor", name: "Maker's Mark", status: "ready",
    payload: { bottleCost: 55, bottleOz: 59.1745, pricePerOz: 6, imageUrl: "/saved.png" },
  };
  for (const [items, queue, expectedId] of [[[saved], [], saved.id], [[], [queued], "liquor:maker-s-mark"]]) {
    const merged = mergeRequiredComingSoonItems(items, queue);
    const makers = merged.filter(item => item.name === "Maker's Mark");
    assert.equal(makers.length, 1);
    assert.equal(makers[0].id, expectedId);
    assert.equal(makers[0].bottleCost, 55);
    assert.equal(makers[0].pricePerOz, 6);
    assert.equal(makers[0].imageUrl, "/saved.png");
    assert.equal(makers[0].portions, undefined);
    assert.equal(makers[0].priceStatus, undefined);
    assert.equal(makers[0].bottleCostSource, undefined);
    assert.ok(makers[0].description);
    assert.equal(JSON.stringify(mergeRequiredComingSoonItems(merged, queue)), JSON.stringify(merged));
  }
});

test("liquor fallback hydration stays stable across reloads for defaults and custom pricing", () => {
  for (const saved of [
    [],
    [{ id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple", pricePerOz: 6, bottleCost: 30 }],
    [{ id: "liquor:makers-mark", kind: "liquor", name: "Maker's Mark", imageUrl: "/custom.png", replacedAt: "2026-10-01T12:00:00Z", plu: 1234 }],
  ]) {
    const first = JSON.parse(JSON.stringify(mergeRequiredComingSoonItems(saved)));
    const second = JSON.parse(JSON.stringify(mergeRequiredComingSoonItems(first)));
    const third = JSON.parse(JSON.stringify(mergeRequiredComingSoonItems(second)));
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  }
});

test("On Deck offers both required liquor products after stale Coming Soon data is restored", () => {
  const comingSoonItems = mergeRequiredComingSoonItems([
    { id: "beer:octoberfest", kind: "beer", name: "Octoberfest" },
    { id: "beer:christmas-ale", kind: "beer", name: "Christmas Ale", plu: 7654 },
  ]);
  const options = buildKegOnDeckOptions({ comingSoonItems });
  for (const [id, name] of [["liquor:makers-mark", "Maker's Mark"], ["liquor:ciroc-pineapple", "Ciroc Pineapple"]]) {
    const option = options.find(item => item.id === id);
    assert.equal(option?.name, name);
    assert.equal(option?.kind, "liquor");
  }
  assert.equal(options.some(item => item.id === "beer:octoberfest"), false);
  assert.equal(options.find(item => item.id === "beer:christmas-ale")?.plu, 7654);
});

test("clone previews and publishing use the main-wall image instead of the saved substitute", () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const context = vm.createContext({
    clean: (value) => String(value ?? "").trim(),
    toNumber: (value) => Number(value) || 0,
    getComingSoonLiquorCatalogPricing: () => null,
    STANDARD_BEER_KEG_OZ: 1984,
    STANDARD_COCKTAIL_KEG_OZ: 1452,
  });
  for (const name of ["getComingSoonImageUrl", "buildPmbPayloadFromComingSoonItem"]) {
    const match = source.match(new RegExp(`function ${name}\\(item\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  for (const item of REQUIRED_COMING_SOON_ITEMS.filter((entry) => entry.cloneSourceName)) {
    assert.equal(context.getComingSoonImageUrl(item), `/api/pmb-products?cloneImageFor=${encodeURIComponent(item.cloneSourceName)}`);
    const payload = context.buildPmbPayloadFromComingSoonItem(item);
    assert.equal(payload.imageUrl, "");
    assert.equal(payload.cloneSourceName, item.cloneSourceName);
  }
  assert.equal(context.getComingSoonImageUrl({ imageUrl: "/own-image.png" }), "/own-image.png");
});

test("includes an unpublished queued beer in Coming Soon immediately", () => {
  const merged = mergeRequiredComingSoonItems([], [{
    id: "pmb-publish:beer:future-lager",
    kind: "beer",
    name: "Future Lager",
    status: "ready",
    updatedAt: "2026-08-15T05:32:00.000Z",
    payload: {
      name: "Future Lager",
      kegCost: 185,
      kegOz: 1984,
      pricePerOz: 0.52,
      abvPercent: 5.3,
    },
  }]);
  const futureLager = merged.find(({ id }) => id === "beer:future-lager");

  assert.equal(futureLager?.kind, "beer");
  assert.equal(futureLager?.name, "Future Lager");
  assert.equal(futureLager?.kegCost, 185);
  assert.equal(futureLager?.source, "PMB publishing queue");
});

test("includes an unpublished queued liquor tap in Coming Soon immediately", () => {
  const merged = mergeRequiredComingSoonItems([], [{
    id: "pmb-publish:liquor:future-rye",
    kind: "liquor",
    name: "Future Rye",
    status: "ready",
    payload: {
      name: "Future Rye",
      bottleCost: 64,
      bottleOz: 59.1745,
      pricePerOz: 2.25,
      abvPercent: 45.2,
    },
  }]);
  const futureRye = merged.find(({ id }) => id === "liquor:future-rye");

  assert.equal(futureRye?.kind, "liquor");
  assert.equal(futureRye?.bottleCost, 64);
  assert.equal(futureRye?.bottleOz, 59.1745);
});

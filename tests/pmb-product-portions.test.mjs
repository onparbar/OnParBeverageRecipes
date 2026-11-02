import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  buildNewProductPortionPriceEdit,
  normalizeNewProductPortions,
  readProductPortionItems,
  savePmbLiquorProductPortions,
  verifyProductPortionChoices,
  verifyProductPortionDefinitions,
} from "../lib/pmb-product-portions.mjs";

const portions = [{ name: "Single", quantityOz: 1.5, price: 8 }, { name: "Double", quantityOz: 2, price: 10 }];
const requested = { plu: 500001, name: "Maker's Mark 3", price_per_unit: 533, units_per_serving: 150, abv: 4500, product_type: 3, volume_unit: "oz" };
const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const field = (name, value = "", extra = "") => `<input name="${name}" value="${escape(value)}" ${extra}>`;
const choices = (selected = true) => `${portions.map((portion) => field(portion.name, "on", `id="portion_list" type="checkbox" data-caption="${portion.name} ${portion.quantityOz.toFixed(3)} " ${selected ? "checked" : ""}`)).join("")}${field("chosenPortions", "Test", 'type="hidden"')}`;
const definitions = (doubleQuantity = 2000) => [["Single", 1500], ["Double", doubleQuantity]].map(([name, quantity]) => `<form method="post">${field("fd_edit_portion_name", name)}${field("fd_edit_quantity", quantity)}${field("fd_edit_dp", 3)}</form>`).join("");
const productForm = (product) => `<form method="post">${field("fd_plu", product.plu)}${field("fd_name", product.name)}${field("fd_is_active", "on", `type="checkbox" ${product.is_active ? "checked" : ""}`)}${choices()}${field("submit_saveedit_product", "save", 'type="submit"')}</form>`;
const itemTable = (product, items) => `<table id="item_table"><tbody>${items.map((item) => `<tr>
  <td name="Current_Row_Id">${item.itemId}</td><td name="Current_Row_Product">${escape(product.name)}</td>
  <td name="Current_Row_Portion">${item.name}</td><td name="Current_Row_Price">${item.price.toFixed(2)}</td>
  <td name="Current_Volume_Unit">oz</td></tr>`).join("")}</tbody></table>`;
const itemForm = (product, item) => `<form method="post" action="/pages/items">
  ${field("Id_Input", item.itemId)}${field("fd_edit_id", item.itemId, 'type="hidden"')}
  ${field("Product_Input", product.name)}${field("Product_Associated_PLU")}${field("Product_Associated_Volume_Unit")}
  ${field("Price_Input", item.price.toFixed(2))}${field("Portion_Input", item.name)}${field("HappyHour1", "0.00")}
  <ol id="productList"><li><a>${escape(product.name)}</a><cite>${product.plu}</cite><blockquote>oz</blockquote></li></ol>
  <button name="submit_saveadd_item" type="submit" value="save item">Save</button>
  <!-- <input name="submit_saveadd_item" value="save item" type="submit"> -->
</form>`;

function mockClient(options = {}) {
  const state = {
    products: options.existing ? [{ ...requested, is_active: 0, ...options.existing }] : [],
    items: options.items || [],
    calls: [],
  };
  const target = () => state.products[0];
  const client = {
    definitions: async () => definitions(options.wrongDefinition ? 3000 : 2000),
    list: async () => state.products.map((product) => ({ ...product })),
    create: async (product, selected) => {
      state.calls.push("create");
      assert.equal(product.is_active, 0);
      assert.equal(product.is_in_use, 0);
      assert.deepEqual(selected, portions);
      state.products.push({ ...product });
      if (!options.missingItems) state.items = portions.map((portion, index) => ({ ...portion, itemId: String(900 + index), price: 1 }));
      if (options.createTimeout) throw new Error("create connection interrupted");
    },
    openProduct: async () => ({ html: productForm(target()), cookieJar: new Map() }),
    items: async () => itemTable(target() || requested, state.items),
    openItem: async (itemId) => ({ html: itemForm(target(), state.items.find((item) => item.itemId === itemId)), cookieJar: new Map() }),
    saveItem: async (entries) => {
      const fields = Object.fromEntries(entries);
      state.calls.push(`price:${fields.Portion_Input}`);
      assert.equal(target().is_active, 0);
      const item = state.items.find((entry) => entry.itemId === fields.Id_Input);
      if (!options.ignorePrice) item.price = Number(fields.Price_Input);
      if (options.priceTimeout) throw new Error("price connection interrupted");
    },
    activate: async (entries) => {
      state.calls.push("activate");
      assert.equal(Object.fromEntries(entries).chosenPortions, "Single;Double");
      assert.deepEqual(state.items.map(({ name, quantityOz, price }) => ({ name, quantityOz, price })), portions);
      if (options.activationTimeout) throw new Error("activation connection interrupted");
      target().is_active = 1;
      if (options.corruptAfterActivation) state.items[0].price = 999;
    },
  };
  return { client, state };
}

test("validates exactly Single 1.5oz and Double 2oz with precise saved prices", () => {
  assert.deepEqual(normalizeNewProductPortions({ productKind: "liquor", portions }), portions);
  assert.deepEqual(normalizeNewProductPortions({ productKind: "beer" }), []);
  for (const invalid of [[], [portions[0]], [portions[0], portions[0]], [{ ...portions[0], quantityOz: 3 }, portions[1]], [{ ...portions[0], price: 8.001 }, portions[1]]]) {
    assert.throws(() => normalizeNewProductPortions({ productKind: "liquor", portions: invalid }), { code: "PMB_PRODUCT_PORTIONS_INVALID" });
  }
});

test("verifies the observed PMB global definitions and semicolon product selection", () => {
  assert.equal(verifyProductPortionDefinitions(definitions(), portions), true);
  assert.throws(() => verifyProductPortionDefinitions(definitions(3000), portions), /size differs/);
  assert.equal(verifyProductPortionChoices(choices(false), portions), "Single;Double");
  assert.throws(() => verifyProductPortionChoices(choices(false), portions, { selected: true }), /selection is not verified/);
});

test("verifies exact item IDs, names, units and prices without a hardcoded PLU registry", () => {
  const items = portions.map((portion, index) => ({ ...portion, itemId: String(900 + index) }));
  assert.deepEqual(readProductPortionItems(itemTable(requested, items), requested, portions, { verifyPrices: true }), items);
  assert.throws(() => readProductPortionItems(itemTable(requested, [items[0]]), requested, portions), /exactly two/);
  assert.throws(() => readProductPortionItems(itemTable(requested, [items[0], { ...items[1], price: 11 }]), requested, portions, { verifyPrices: true }), /Double price/);
});

test("the real item editor keeps existing fields and links only the exact PLU", () => {
  const item = { ...portions[0], price: 1, itemId: "900" };
  const entries = Object.fromEntries(buildNewProductPortionPriceEdit(itemForm(requested, item), requested, item, portions[0]));
  assert.equal(entries.Price_Input, "8.00");
  assert.equal(entries.Product_Associated_PLU, String(requested.plu));
  assert.equal(entries.Product_Associated_Volume_Unit, "oz");
  assert.equal(entries.HappyHour1, "0.00");
  assert.equal(entries.fd_edit_id, "900");
  assert.equal(entries.submit_saveadd_item, "save item");
  assert.throws(() => buildNewProductPortionPriceEdit(itemForm({ ...requested, plu: 999 }, item), requested, item, portions[0]), /exact saved product PLU/);
});

test("creates inactive, verifies both exact prices, then activates once", async () => {
  const { client, state } = mockClient();
  const saved = await savePmbLiquorProductPortions({ product: requested, portions, activate: true, client });
  assert.deepEqual(state.calls, ["create", "price:Single", "price:Double", "activate"]);
  assert.equal(saved.portionsVerified, true);
  assert.equal(saved.activationVerified, true);
  assert.equal(saved.staged, false);
  assert.deepEqual(saved.portions.map(({ name, quantityOz, price }) => ({ name, quantityOz, price })), portions);
});

test("saving without activation leaves the fully verified draft inactive", async () => {
  const { client, state } = mockClient();
  const saved = await savePmbLiquorProductPortions({ product: requested, portions, activate: false, client });
  assert.equal(saved.portionsVerified, true);
  assert.equal(saved.activationVerified, false);
  assert.equal(saved.staged, true);
  assert.equal(state.calls.includes("activate"), false);
});

test("a changed global portion size prevents every mutation", async () => {
  const { client, state } = mockClient({ wrongDefinition: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), /size differs/);
  assert.deepEqual(state.calls, []);
});

test("missing generated items return a verified inactive PLU and do not activate", async () => {
  const { client, state } = mockClient({ missingItems: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.equal(error.code, "PMB_PRODUCT_PORTIONS_MISSING");
    assert.deepEqual(error.stagedProduct, { plu: requested.plu, name: requested.name });
    return true;
  });
  assert.deepEqual(state.calls, ["create"]);
});

test("uncertain create is read back once and a later retry resumes the same PLU", async () => {
  const { client, state } = mockClient({ createTimeout: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.deepEqual(error.stagedProduct, { plu: requested.plu, name: requested.name });
    return /interrupted/.test(error.message);
  });
  assert.deepEqual(state.calls, ["create"]);
  const saved = await savePmbLiquorProductPortions({ product: { ...requested, plu: 500002 }, portions, requestedPlu: requested.plu, activate: true, client });
  assert.equal(saved.product.plu, requested.plu);
  assert.equal(state.calls.filter((call) => call === "create").length, 1);
});

test("an uncertain item save is not replayed and cannot trigger activation", async () => {
  const { client, state } = mockClient({ priceTimeout: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.deepEqual(error.stagedProduct, { plu: requested.plu, name: requested.name });
    return /interrupted/.test(error.message);
  });
  assert.deepEqual(state.calls, ["create", "price:Single"]);
});

test("a false-success item response cannot activate with different prices", async () => {
  const { client, state } = mockClient({ ignorePrice: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), { code: "PMB_PRODUCT_PORTION_SAVE_UNCONFIRMED" });
  assert.equal(state.calls.includes("activate"), false);
});

test("already active products require exact prices and are never silently repriced", async () => {
  const { client, state } = mockClient({ existing: { is_active: 1 }, items: portions.map((portion, index) => ({ ...portion, itemId: String(900 + index), price: 1 })) });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.equal(error.stagedProduct, undefined);
    return /price/.test(error.message);
  });
  assert.deepEqual(state.calls, []);
});

test("a create request cannot adopt or reprice an unrelated inactive product by name", async () => {
  const { client, state } = mockClient({ existing: { is_active: 0 }, items: portions.map((portion, index) => ({ ...portion, itemId: String(900 + index), price: 11 })) });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.equal(error.code, "PMB_PRODUCT_EXISTS");
    assert.equal(error.stagedProduct, undefined);
    return true;
  });
  assert.deepEqual(state.calls, []);
});

test("a staged PLU with different manufacturer or description cannot be silently overwritten", async () => {
  for (const changed of [{ brewery: "Another maker" }, { style: "Other style" }, { tasting_notes: "Another product description" }]) {
    const { client, state } = mockClient({ existing: changed });
    await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, requestedPlu: requested.plu, activate: true, client }), /differs/);
    assert.deepEqual(state.calls, []);
  }
});

test("an already completed retry is verified with no duplicate writes", async () => {
  const { client, state } = mockClient({ existing: { is_active: 1 }, items: portions.map((portion, index) => ({ ...portion, itemId: String(900 + index) })) });
  const saved = await savePmbLiquorProductPortions({ product: requested, portions, activate: true, client });
  assert.equal(saved.activationVerified, true);
  assert.equal(saved.portionsVerified, true);
  assert.deepEqual(state.calls, []);
});

test("post-activation mismatches never report inactive staged success", async () => {
  const { client } = mockClient({ corruptAfterActivation: true });
  await assert.rejects(savePmbLiquorProductPortions({ product: requested, portions, activate: true, client }), (error) => {
    assert.equal(error.stagedProduct, undefined);
    return /Single price/.test(error.message);
  });
});

test("the product management form stages unchecked Active with actual chosen portions", () => {
  const source = readFileSync(new URL("../app/api/pmb-products/route.js", import.meta.url), "utf8");
  const match = source.match(/function buildManagementProductForm\([^]*?\n\}/);
  assert.ok(match);
  const context = vm.createContext({ decimalDollarsFromCents: (value) => (Number(value) / 100).toFixed(2), decimalOuncesFromHundredths: (value) => String(Number(value) / 100) });
  vm.runInContext(match[0], context);
  const fields = context.buildManagementProductForm({ ...requested, is_active: 0 }, null, { portions });
  assert.equal(fields.fd_is_active, undefined);
  assert.equal(fields.chosenPortions, "Single;Double");
  assert.equal(fields.Single, "on");
  assert.equal(fields.Double, "on");
  assert.equal(fields.submit_saveadd_product, "save new");
});

const routeSource = readFileSync(new URL("../app/api/pmb-products/route.js", import.meta.url), "utf8");
function loadRouteFunctions(names, globals) {
  const context = vm.createContext({
    Buffer, URL, URLSearchParams, Map, Object,
    clean: (value) => String(value ?? "").trim(),
    normalizeName: (value) => String(value ?? "").trim().toLowerCase(),
    toNumber: (value) => Number(value) || 0,
    decimalDollarsFromCents: (value) => (Number(value) / 100).toFixed(2),
    decimalOuncesFromHundredths: (value) => String(Number(value) / 100),
    normalizeNewProductPortions, verifyProductPortionChoices, savePmbLiquorProductPortions,
    ...globals,
  });
  for (const name of names) {
    const match = routeSource.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, name);
    vm.runInContext(match[0].replace(/^export /, ""), context);
  }
  return context;
}

test("the real route client sends observed navigation, inactive product and exact item-save requests", async () => {
  const requests = [];
  let products = [];
  const source = loadRouteFunctions(["buildManagementProductForm", "createProductViaManagementUi", "createPortionProductClient"], {
    getProductList: async () => ({ productlist: products }),
    postDigestForm: async (_config, path, fields, options) => {
      requests.push({ path, fields, options });
      if (fields.submit_add_product) return { status: 200, raw: `<form>${choices(false)}${field("submit_saveadd_product", "save new")}</form>` };
      assert.equal(fields.fd_is_active, undefined);
      assert.equal(fields.chosenPortions, "Single;Double");
      assert.equal(options.multipart, true);
      assert.equal(options.files.length, 1);
      products = [{ ...requested, is_active: 0 }];
      return { status: 200, raw: "Saved" };
    },
    managementRequest: async (_config, method, path, body) => {
      requests.push({ method, path, fields: Object.fromEntries(new URLSearchParams(String(body))) });
      return { status: 200, raw: method === "GET" ? definitions() : "item editor" };
    },
    urlEncodedBody: (entries) => ({ body: Buffer.from(new URLSearchParams(entries).toString()), headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
    openProductEditForm: async () => ({ html: productForm(products[0]) }),
    saveProductEditForm: async (_config, entries) => requests.push({ activate: entries }),
  });
  const client = source.createPortionProductClient({}, {}, { fieldName: "file", buffer: Buffer.from("image") });
  await client.definitions();
  await client.items();
  await client.create({ ...requested, is_active: 0 }, portions);
  await client.openItem("900");
  await client.saveItem([["fd_edit_id", "900"], ["Price_Input", "8.00"], ["submit_saveadd_item", "save item"]], new Map());
  assert.deepEqual(requests.filter((request) => request.method === "GET").map(({ path }) => path), ["/pages/portions", "/pages/items"]);
  assert.ok(requests.some((request) => request.fields.submit_add_product === "add product"));
  assert.ok(requests.some((request) => request.fields.fd_edit_id === "900" && request.fields.submit_edit_item === "edit"));
  assert.ok(requests.some((request) => request.fields.Price_Input === "8.00" && request.fields.submit_saveadd_item === "save item"));
});

test("the POST route sends configuration only after exact portions and activation acknowledge", async () => {
  for (const ignorePrice of [false, true]) {
    const { client, state } = mockClient({ ignorePrice });
    let configurationCount = 0;
    const source = loadRouteFunctions(["POST"], {
      NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
      requireDashboardRequestRole: async () => {}, productWriteInProgress: false,
      getConfig: () => ({}), getAuthtoken: async () => ({}), getNextPlu: async () => requested.plu,
      buildProduct: () => ({ ...requested }), buildPmbImageFile: async () => ({ buffer: Buffer.from("image") }),
      createPortionProductClient: () => client, savePmbProductCatalog: async () => {},
      getProductList: async () => ({ productlist: await client.list() }),
      trySendConfigUpdate: async () => {
        assert.equal(state.products[0].is_active, 1);
        assert.deepEqual(state.items.map(({ name, quantityOz, price }) => ({ name, quantityOz, price })), portions);
        configurationCount += 1;
        return "/api/configupdate";
      },
    });
    const result = await source.POST({ headers: { get: () => "same-origin" }, json: async () => ({ productKind: "liquor", name: requested.name, portions, isActive: true, sendConfigUpdate: true }) });
    if (ignorePrice) {
      assert.equal(result.status, 502);
      assert.equal(result.body.portionsVerified, false);
      assert.equal(result.body.activationVerified, false);
      assert.equal(result.body.staged, true);
      assert.equal(result.body.product.plu, requested.plu);
      assert.equal(configurationCount, 0);
    } else {
      assert.equal(result.status, 200);
      assert.equal(result.body.portionsVerified, true);
      assert.equal(result.body.activationVerified, true);
      assert.equal(result.body.configUpdateSent, true);
      assert.equal(configurationCount, 1);
    }
  }
});

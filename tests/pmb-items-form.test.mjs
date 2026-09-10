import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Exercise the production parser without exporting its private functions or
// contacting a controller. The fixture follows the captured PMB Items form.
const moduleUrl = new URL("../lib/pmb-item-management.mjs", import.meta.url);
const source = (await readFile(moduleUrl, "utf8"))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, moduleUrl).href)}`);
const { findItemEditRequest, findSaveDescriptor } = await import(
  `data:text/javascript;base64,${Buffer.from(`${source}\nexport { findItemEditRequest, findSaveDescriptor };`).toString("base64")}`
);

const item = { itemId: "157", productPlu: 145687, portionName: "Double", quantityOz: 2, priceRaw: 1350, priceDp: 2 };
const expected = { newPriceRaw: 1400 };
const catalogEntry = '<li><a href="#">Hennessy Cognac 3</a><cite>145687</cite><blockquote>oz</blockquote></li>';
const form = `<form method="post">
  <input name="Id_Input" value="157">
  <input name="Product_Input" value="Hennessy Cognac 3">
  <input name="Product_Associated_PLU" value="">
  <input name="Product_Associated_Volume_Unit" value="">
  <ol id="productList">${catalogEntry}</ol>
  <input name="Price_Input" value="13.50">
  <input name="Portion_Input" value="Double">
  <p>Happy Hour 1 / Happy Hour 2</p>
  <input name="HappyHour1" value="0.00">
  <input name="HappyHour1_Percent" value="0.00">
  <input name="HappyHour2" value="0.00">
  <input name="HappyHour2_Percent" value="0.00">
  <input name="Device_item_id_Input" value="">
  <input name="Pos_item_id_Input" value="">
  <input type="checkbox" name="selectable_in_open_pour_mode_Input" checked>
  <input type="hidden" name="fd_edit_id" value="157">
  <button type="submit" name="submit_saveadd_item" value="save item"><span class="mif-checkmark"></span></button>
  <input type="submit" name="submit_saveadd_item" value="save item">
  <input type="submit" name="submit_saveedit_product_cancel" value="Cancel">
</form>`;

function rejects(html, target = item) {
  assert.throws(() => findSaveDescriptor(html, target, expected), { code: "PMB_PORTION_FORM_UNVERIFIED" });
}

test("PMB hash-action edit forms open the exact item without delete controls", () => {
  const row = (id) => `<form method="post" action="#"><input type="hidden" name="fd_edit_id" value="${id}"><input type="submit" name="submit_edit_item" value="edit"><input type="submit" name="submit_delete_item" value="delete"></form>`;
  const request = findItemEditRequest(row(63) + row(157), "157");
  assert.equal(request.action, "/pages/items");
  assert.equal(request.method, "post");
  assert.deepEqual(request.entries.map(({ name, value }) => [name, value]), [["fd_edit_id", "157"], ["submit_edit_item", "edit"]]);
});

test("PMB Double editor needs no ounce field and changes only the regular price", () => {
  const descriptor = findSaveDescriptor(form, item, expected);
  assert.equal(descriptor.action, "/pages/items");
  assert.equal(descriptor.method, "post");
  assert.equal(descriptor.target.itemId, "157");
  assert.equal(descriptor.target.quantityOz, 2);
  assert.deepEqual(descriptor.updatedEntries, descriptor.originalEntries.map(([name, value]) => [name, name === "Price_Input" ? "14.00" : value]));
  assert.equal(descriptor.originalEntries.filter(([name]) => name === "submit_saveadd_item").length, 1);
  assert.ok(!descriptor.updatedEntries.some(([name]) => /cancel/i.test(name)));
});

test("PMB Single editor uses its separately verified item identity", () => {
  const single = form.replaceAll('value="157"', 'value="63"').replace('value="Double"', 'value="Single"').replace('value="13.50"', 'value="10.00"');
  const descriptor = findSaveDescriptor(single, { ...item, itemId: "63", portionName: "Single", quantityOz: 1.5, priceRaw: 1000 }, { newPriceRaw: 1100 });
  assert.equal(descriptor.target.itemId, "63");
  assert.deepEqual(descriptor.updatedEntries.find(([name]) => name === "Price_Input"), ["Price_Input", "11.00"]);
});

test("unrelated numbers cannot substitute for a verified product or portion", () => {
  rejects(form.replace('name="Portion_Input" value="Double"', 'name="Portion_Input" value="Single"'));
  rejects(form.replace('name="Id_Input" value="157"', 'name="Id_Input" value="63"'));
  rejects(form.replace('name="fd_edit_id" value="157"', 'name="fd_edit_id" value="63"'));
  rejects(form.replace('<cite>145687</cite>', '<cite>999999</cite>'));
  rejects(form.replace('name="Product_Input" value="Hennessy Cognac 3"', 'name="Product_Input" value="Other product"'));
});

test("missing and ambiguous product pickers keep writes disabled", () => {
  rejects(form.replace(catalogEntry, ""));
  rejects(form.replace(catalogEntry, catalogEntry + catalogEntry));
  rejects(form.replace('<ol id="productList">', '<ol id="otherProducts">'));
});

test("unknown item IDs or changed portion sizes cannot use the no-quantity fallback", () => {
  rejects(form.replaceAll('value="157"', 'value="999"'), { ...item, itemId: "999" });
  rejects(form, { ...item, quantityOz: 3 });
  rejects(form.replace('</form>', '<input name="quantity" value="3"></form>'));
});

test("stale prices and duplicate price controls keep writes disabled", () => {
  rejects(form.replace('name="Price_Input" value="13.50"', 'name="Price_Input" value="15.00"'));
  rejects(form.replace('</form>', '<input name="Price_Input" value="13.50"></form>'));
  rejects(form + form);
});

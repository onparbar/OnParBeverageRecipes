// PMB form fields and chosenPortions encoding were read from the controller's
// unsaved Product/Item forms on 2026-11-02. No live writes were used to inspect them.
import { inspectPmbActivationForm } from "./pmb-product-activation.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sameName = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase();
const cents = (value) => Math.round(Number(value) * 100);

function fail(message, code = "PMB_PRODUCT_PORTIONS_UNVERIFIED", status = 409) {
  throw Object.assign(new Error(message), { code, status });
}

function decode(value) {
  return String(value ?? "").replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&quot;/gi, '"').replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
}

function attributes(tag) {
  return Object.fromEntries([...String(tag).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
    .map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? "")]));
}

function inputs(html) {
  return [...String(html).replace(/<!--[\s\S]*?-->/g, "").matchAll(/<input\b[^>]*>/gi)].map(([tag]) => attributes(tag));
}

function oneControl(controls, name) {
  const matches = controls.filter((control) => control.name === name);
  if (matches.length !== 1) fail(`PMB did not return one ${name} field.`, "PMB_PRODUCT_PORTION_FORM_CHANGED", 503);
  return matches[0];
}

export function normalizeNewProductPortions(input) {
  if (input.portions == null) return [];
  if (clean(input.productKind || input.kind).toLowerCase() !== "liquor" || !Array.isArray(input.portions) || input.portions.length !== 2) {
    fail("Liquor setup requires exactly one Single and one Double price.", "PMB_PRODUCT_PORTIONS_INVALID", 400);
  }
  return [["Single", 1.5], ["Double", 2]].map(([name, quantityOz]) => {
    const matches = input.portions.filter((portion) => sameName(portion?.name, name));
    const portion = matches[0];
    const price = Number(portion?.price);
    if (matches.length !== 1 || Number(portion.quantityOz ?? portion.servingOz) !== quantityOz
      || !Number.isFinite(price) || price <= 0 || price > 100 || Math.abs(price * 100 - cents(price)) > 1e-6) {
      fail(`${name} must have its verified ${quantityOz} oz size and a positive price with at most two decimal places.`, "PMB_PRODUCT_PORTIONS_INVALID", 400);
    }
    return { name, quantityOz, price };
  });
}

export function verifyProductPortionDefinitions(html, portions) {
  const forms = [...String(html).matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(([form]) => inputs(form));
  for (const portion of portions) {
    const matches = forms.filter((controls) => controls.some((control) => control.name === "fd_edit_portion_name" && control.value === portion.name));
    if (matches.length !== 1) fail(`PMB's ${portion.name} portion definition is unavailable or ambiguous.`);
    const raw = Number(oneControl(matches[0], "fd_edit_quantity").value);
    const dp = Number(oneControl(matches[0], "fd_edit_dp").value);
    if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(dp) || dp < 0 || dp > 6 || raw / (10 ** dp) !== portion.quantityOz) {
      fail(`PMB's ${portion.name} size differs from the saved ${portion.quantityOz} oz serving.`);
    }
  }
  return true;
}

export function verifyProductPortionChoices(html, portions, { selected = false } = {}) {
  const controls = inputs(html);
  oneControl(controls, "chosenPortions");
  for (const portion of portions) {
    const control = oneControl(controls.filter((entry) => entry.id === "portion_list"), portion.name);
    const caption = clean(control["data-caption"]);
    if (control.type !== "checkbox" || caption !== `${portion.name} ${portion.quantityOz.toFixed(3)}`
      || (selected && !Object.hasOwn(control, "checked"))) {
      fail(`PMB's ${portion.name} product selection is not verified.`, "PMB_PRODUCT_PORTION_FORM_CHANGED", 503);
    }
  }
  if (selected && controls.some((entry) => entry.id === "portion_list" && Object.hasOwn(entry, "checked") && !portions.some((portion) => portion.name === entry.name))) {
    fail("PMB has unexpected portion selections for this product.");
  }
  return portions.map((portion) => portion.name).join(";");
}

function cell(row, name) {
  const values = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
    .filter((match) => attributes(match[1]).name === name)
    .map((match) => clean(decode(match[2].replace(/<[^>]+>/g, " "))));
  if (values.length !== 1) fail(`PMB's item table is missing ${name}.`, "PMB_PRODUCT_PORTION_TABLE_CHANGED", 503);
  return values[0];
}

export function readProductPortionItems(html, product, portions, { verifyPrices = false } = {}) {
  const rows = [...String(html).matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(([row]) => row)
    .filter((row) => /name=["']Current_Row_Product["']/.test(row))
    .filter((row) => sameName(cell(row, "Current_Row_Product"), product.name));
  if (rows.length !== 2) fail("PMB did not return exactly two items for this product. Its saved draft remains inactive.", "PMB_PRODUCT_PORTIONS_MISSING");
  const result = portions.map((portion) => {
    const matches = rows.filter((row) => cell(row, "Current_Row_Portion") === portion.name);
    if (matches.length !== 1) fail(`PMB's ${portion.name} item is missing or duplicated.`);
    const itemId = cell(matches[0], "Current_Row_Id");
    const price = Number(cell(matches[0], "Current_Row_Price"));
    if (!/^[1-9]\d*$/.test(itemId) || !Number.isFinite(price) || price < 0 || cell(matches[0], "Current_Volume_Unit") !== "oz") {
      fail(`PMB's ${portion.name} item identity or price is invalid.`);
    }
    if (verifyPrices && cents(price) !== cents(portion.price)) fail(`PMB has not confirmed the saved ${portion.name} price.`);
    return { itemId, name: portion.name, quantityOz: portion.quantityOz, price };
  });
  if (new Set(result.map((item) => item.itemId)).size !== 2) fail("PMB returned duplicate item identities.");
  return result;
}

export function buildNewProductPortionPriceEdit(html, product, item, desired) {
  const safeHtml = String(html).replace(/<!--[\s\S]*?-->/g, "");
  const forms = [...safeHtml.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
    .filter((match) => /name=["']submit_saveadd_item["']/.test(match[2]));
  if (forms.length !== 1) fail("PMB did not return one portion item editor.", "PMB_PRODUCT_PORTION_FORM_CHANGED", 503);
  const form = forms[0];
  const formAttributes = attributes(form[1]);
  if (formAttributes.method?.toLowerCase() !== "post" || ![undefined, "", "#", "/pages/items"].includes(formAttributes.action)) {
    fail("PMB's item save action changed.", "PMB_PRODUCT_PORTION_FORM_CHANGED", 503);
  }
  const controls = inputs(form[2]);
  const value = (name) => clean(oneControl(controls, name).value);
  if (value("Id_Input") !== item.itemId || value("fd_edit_id") !== item.itemId
    || !sameName(value("Product_Input"), product.name) || value("Portion_Input") !== item.name
    || cents(value("Price_Input")) !== cents(item.price)) fail("PMB opened a different or changed portion item.");
  const productOptions = [...form[2].matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map(([entry]) => ({
    name: clean(decode(entry.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1])),
    plu: Number(entry.match(/<cite\b[^>]*>(.*?)<\/cite>/i)?.[1]),
    unit: clean(entry.match(/<blockquote\b[^>]*>(.*?)<\/blockquote>/i)?.[1]),
  })).filter((entry) => sameName(entry.name, product.name));
  if (productOptions.length !== 1 || productOptions[0].plu !== Number(product.plu) || productOptions[0].unit !== "oz") {
    fail("The portion item cannot be linked to the exact saved product PLU.");
  }
  const associated = value("Product_Associated_PLU");
  if (associated && Number(associated) !== Number(product.plu)) fail("PMB's portion editor references another product.");
  const entries = controls.filter((control) => control.name && !["submit", "button", "file"].includes(control.type)
    && (!['checkbox', 'radio'].includes(control.type) || Object.hasOwn(control, "checked")))
    .map((control) => [control.name, control.value ?? (control.type === "checkbox" ? "on" : "")]);
  for (const [name, next] of [["Price_Input", Number(desired.price).toFixed(2)], ["Product_Associated_PLU", String(product.plu)], ["Product_Associated_Volume_Unit", "oz"]]) {
    const index = entries.findIndex(([key]) => key === name);
    if (index < 0) fail(`PMB's item editor is missing ${name}.`);
    entries[index] = [name, next];
  }
  const saveButtons = [...form[2].matchAll(/<(?:input|button)\b[^>]*>/gi)].map(([tag]) => attributes(tag))
    .filter((control) => control.name === "submit_saveadd_item" && control.value === "save item");
  if (saveButtons.length !== 1) fail("PMB's item save button changed.", "PMB_PRODUCT_PORTION_FORM_CHANGED", 503);
  entries.push(["submit_saveadd_item", "save item"]);
  return entries;
}

function verifyCatalogIdentity(saved, requested) {
  if (!saved || !sameName(saved.name, requested.name) || Number(saved.plu) !== Number(requested.plu)) fail("PMB's saved product identity differs from this request.");
  for (const key of ["price_per_unit", "units_per_serving", "abv", "product_type"]) {
    if (Number(saved[key]) !== Number(requested[key])) fail("An existing product with this name has different details. It was not overwritten.");
  }
  if (clean(saved.volume_unit) !== "oz") fail("The saved product does not use ounces.");
  for (const key of ["brewery", "style"]) {
    if (!sameName(saved[key], requested[key])) fail(`The saved product's ${key} differs from the requested details.`);
  }
  const noteText = (value) => clean(decode(String(value ?? "").replace(/<[^>]+>/g, " ")));
  if (noteText(saved.tasting_notes) !== noteText(requested.tasting_notes)) fail("The saved product description differs from the requested details.");
}

function preservedProductFields(entries) {
  return JSON.stringify(entries.filter(([key]) => key.startsWith("fd_") && key !== "fd_is_active")
    .map((entry) => [...entry]).sort(([key, value], [otherKey, otherValue]) => key.localeCompare(otherKey) || String(value).localeCompare(String(otherValue))));
}

// The client performs individual authenticated requests. A timed-out mutation is
// never replayed; fresh reads determine whether a subsequent user retry can resume.
export async function savePmbLiquorProductPortions({ product, portions, activate = false, requestedPlu = 0, client }) {
  let target = null;
  let resumable = false;
  let created = false;
  try {
    verifyProductPortionDefinitions(await client.definitions(), portions);
    const before = await client.list();
    const named = before.filter((entry) => sameName(entry.name, product.name));
    if (named.length > 1) fail("More than one PMB product has this name. Nothing was changed.");
    if (requestedPlu && (!named.length || Number(named[0].plu) !== Number(requestedPlu))) fail("The saved PMB PLU no longer matches this Coming Soon product.");
    if (named.length) {
      target = named[0];
      product = { ...product, plu: Number(target.plu) };
      verifyCatalogIdentity(target, product);
      resumable = Boolean(requestedPlu);
    } else {
      if (before.some((entry) => Number(entry.plu) === Number(product.plu))) fail("The new PMB PLU is already in use. Refresh before trying again.");
      let createError = null;
      try { await client.create({ ...product, is_active: 0, is_in_use: 0 }, portions); }
      catch (error) { createError = error; }
      const after = await client.list();
      const matches = after.filter((entry) => Number(entry.plu) === Number(product.plu) && sameName(entry.name, product.name));
      if (matches.length !== 1) throw createError || Object.assign(new Error("PMB has not confirmed the new product. No activation was attempted."), { code: "PMB_PRODUCT_CREATE_UNCONFIRMED", status: 502 });
      target = matches[0];
      verifyCatalogIdentity(target, product);
      resumable = true;
      created = true;
      if (createError) throw createError;
    }

    let form = await client.openProduct(target.plu);
    let state = inspectPmbActivationForm(form.html, { plu: Number(target.plu), name: target.name });
    verifyProductPortionChoices(form.html, portions, { selected: true });
    if (!resumable && !state.active) fail("An inactive PMB product with this name already exists. Select its verified PLU before changing it.", "PMB_PRODUCT_EXISTS");
    let items = readProductPortionItems(await client.items(), target, portions, { verifyPrices: state.active });
    if (!state.active) {
      for (const desired of portions) {
        items = readProductPortionItems(await client.items(), target, portions);
        const item = items.find((entry) => entry.name === desired.name);
        if (cents(item.price) === cents(desired.price)) continue;
        const edit = await client.openItem(item.itemId);
        const entries = buildNewProductPortionPriceEdit(edit.html, target, item, desired);
        // An independently activated product must never have its prices changed by this creation flow.
        const beforeSave = await client.openProduct(target.plu);
        if (inspectPmbActivationForm(beforeSave.html, { plu: Number(target.plu), name: target.name }).active) fail("The product became active before portion setup finished. No price change was sent.");
        await client.saveItem(entries, edit.cookieJar);
        const readback = readProductPortionItems(await client.items(), target, portions).find((entry) => entry.name === desired.name);
        if (readback.itemId !== item.itemId || cents(readback.price) !== cents(desired.price)) fail(`PMB did not confirm the ${desired.name} price after saving.`, "PMB_PRODUCT_PORTION_SAVE_UNCONFIRMED", 502);
      }
    }
    verifyProductPortionDefinitions(await client.definitions(), portions);
    items = readProductPortionItems(await client.items(), target, portions, { verifyPrices: true });
    form = await client.openProduct(target.plu);
    state = inspectPmbActivationForm(form.html, { plu: Number(target.plu), name: target.name });
    verifyProductPortionChoices(form.html, portions, { selected: true });
    if (activate && !state.active) {
      const originalFields = preservedProductFields(state.entries);
      const entries = state.entries.filter(([key]) => key !== "chosenPortions" && key !== "fd_is_active");
      entries.push(["chosenPortions", portions.map((portion) => portion.name).join(";")], ["fd_is_active", state.activeValue], ["submit_saveedit_product", "save"]);
      await client.activate(entries, form.cookieJar);
      form = await client.openProduct(target.plu);
      state = inspectPmbActivationForm(form.html, { plu: Number(target.plu), name: target.name });
      verifyProductPortionChoices(form.html, portions, { selected: true });
      if (!state.active) fail("PMB has not confirmed activation. The portion prices remain saved.", "PMB_PRODUCT_ACTIVATION_UNCONFIRMED", 502);
      if (preservedProductFields(state.entries) !== originalFields) fail("PMB activation changed other product fields. The save requires review.", "PMB_PRODUCT_ACTIVATION_DETAILS_CHANGED", 502);
      verifyProductPortionDefinitions(await client.definitions(), portions);
      items = readProductPortionItems(await client.items(), target, portions, { verifyPrices: true });
    }
    const saved = (await client.list()).find((entry) => Number(entry.plu) === Number(target.plu));
    verifyCatalogIdentity(saved, product);
    return { product: saved, portions: items, portionsVerified: true, activationVerified: state.active, staged: !state.active, created };
  } catch (error) {
    // Only expose a resumable PLU when its identity and inactive state were read
    // back independently. Never claim an uncertain activation left it inactive.
    if (target && resumable) {
      try {
        const current = (await client.list()).find((entry) => Number(entry.plu) === Number(target.plu));
        verifyCatalogIdentity(current, product);
        const state = inspectPmbActivationForm((await client.openProduct(current.plu)).html, { plu: Number(current.plu), name: current.name });
        if (!state.active) error.stagedProduct = { plu: Number(current.plu), name: current.name };
      } catch { /* Preserve the original failure and withhold unverified state. */ }
    }
    throw error;
  }
}

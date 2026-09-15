const clean = value => String(value ?? "").trim().replace(/\s+/g, " ");
export function duplicatedProductName(name, wall) {
  const suffix = wall === "Karaoke" ? "2" : "1";
  return `${clean(name).replace(/\s+[123]$/, "")} ${suffix}`;
}
export function pmbCatalogProductKind(product) {
  if (Number(product.product_type) === 1) return "beer";
  const style = clean(product.style).toLowerCase();
  return !/cocktail|mixed/.test(style) && /liquor|spirit|vodka|tequila|bourbon|whisk|cognac|^rum$|^gin$/.test(style) ? "liquor" : "recipe";
}
export function mountProductDuplicator(root, { onCreated = () => {} } = {}) {
  if (!root) return;
  root.innerHTML = `<summary>Duplicate existing product</summary>
    <form class="recipe-form" id="product-duplicate-form">
      <div class="form-grid">
        <label>Find product<input name="search" type="search" placeholder="Search saved PMB products" autocomplete="off"></label>
        <label>Existing product<select name="source" required><option value="">Choose a product</option></select></label>
        <label>Destination wall<select name="wall"><option value="Main">Main wall</option><option value="Karaoke">Karaoke wall</option></select></label>
        <label>New product name<input name="name" required maxlength="160" autocomplete="off"></label>
      </div>
      <div class="form-actions"><button class="ghost-button" type="button" data-refresh>Refresh products</button><button class="primary-button" type="submit" disabled>Create copy</button></div>
      <p role="status" aria-live="polite"></p>
    </form>`;
  const form = root.querySelector("form"), status = root.querySelector('[role="status"]');
  const field = name => form.elements.namedItem(name);
  const submit = form.querySelector('[type="submit"]');
  let products = [], busy = false, loaded = false;
  const say = message => { status.textContent = message; };
  function selection() { return products.find(p => String(p.plu) === field("source").value); }
  function suggestName() {
    const product = selection();
    field("name").value = product ? duplicatedProductName(product.name, field("wall").value) : "";
    submit.disabled = busy || !product;
  }
  function showProducts() {
    const selected = field("source").value;
    const query = clean(field("search").value).toLowerCase();
    field("source").replaceChildren(new Option("Choose a product", ""));
    for (const product of products.filter(p => `${p.name} ${p.plu}`.toLowerCase().includes(query))) {
      field("source").add(new Option(`${clean(product.name)} (PLU ${product.plu})`, String(product.plu)));
    }
    field("source").value = selected;
    if (!field("source").value) field("name").value = "";
    submit.disabled = busy || !selection();
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", redirect: "manual", cache: "no-store", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || "The product request could not be completed.");
    return body;
  }
  function setBusy(value) {
    busy = value;
    form.querySelectorAll("input,select,button").forEach(control => { control.disabled = value; });
    if (!value) submit.disabled = !selection();
  }
  async function load(refresh = false) {
    if (busy) return;
    setBusy(true); say("Loading products...");
    try {
      const catalog = await request(`/api/pmb-products?catalog=1${refresh ? "&refresh=1" : ""}`);
      products = (catalog.products || []).filter(p => p.name).sort((a,b) => a.name.localeCompare(b.name));
      loaded = true; showProducts(); say(catalog.warning || "");
    } catch (error) { say(error.message); }
    finally { setBusy(false); }
  }
  root.addEventListener("toggle", () => { if (root.open && !loaded) load(); });
  root.querySelector("[data-refresh]").addEventListener("click", () => load(true));
  field("search").addEventListener("input", showProducts);
  field("source").addEventListener("change", suggestName);
  field("wall").addEventListener("change", suggestName);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const source = selection();
    if (busy || !source || !form.reportValidity()) return;
    const wall = field("wall").value;
    setBusy(true); say("Creating the new wall copy...");
    let created = false;
    try {
      const result = await request("/api/pmb-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duplicateSourcePlu: Number(source.plu), destinationWall: wall, name: clean(field("name").value), sendConfigUpdate: false }) });
      created = true;
      const setup = await onCreated({ source, product: result.product, wall });
      products.push(result.product);
      say([
        `${result.product.name} was created and added to Coming Soon.`,
        result.catalogBackupWarning,
        setup?.setupIssues?.length ? `Finish setup: ${setup.setupIssues.join(" ")}` : "",
      ].filter(Boolean).join(" "));
    } catch (error) { say(created ? `PMB created the copy, but its dashboard listing needs attention: ${error.message}` : error.message); }
    finally { setBusy(false); }
  });
}

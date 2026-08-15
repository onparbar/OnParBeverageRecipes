"use client";

import { useEffect, useState } from "react";

const operationSections = [
  ["weekly-plan", "Weekly Plan"],
  ["keg-levels", "Keg Levels"],
  ["pricing", "Tap Pricing"],
  ["ingredients", "Ingredient & Keg Costs"],
  ["inventory", "Inventory"],
];

function OperationsBar({ context }) {
  return (
    <div className="operations-bar">
      <div className="operation-tabs" role="tablist" aria-label="Beverage operations sections">
        {operationSections.map(([id, label]) => (
          <button
            className={`operation-tab${id === "weekly-plan" ? " is-active" : ""}`}
            id={`${context}-${id}-tab`}
            data-operation-tab={id}
            type="button"
            role="tab"
            aria-controls={`${id}-panel`}
            aria-selected={id === "weekly-plan" ? "true" : "false"}
            tabIndex={id === "weekly-plan" ? 0 : -1}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [isReady, setIsReady] = useState(false);
  const [sessionRole, setSessionRole] = useState("");

  const isEmployee = sessionRole === "employee";

  useEffect(() => {
    let isMounted = true;

    async function loadSessionRole() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || "Login required.");
        if (result?.role === "employee") {
          window.location.replace("/staff");
          return;
        }
        if (isMounted) setSessionRole("owner");
      } catch {
        window.location.assign("/login");
      }
    }

    loadSessionRole();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionRole) return undefined;

    setIsReady(true);

    const existingScript = document.querySelector('script[data-dashboard-script="true"]');
    if (existingScript) existingScript.remove();

    const script = document.createElement("script");
    script.type = "module";
    script.src = `/dashboard.js?v=${Date.now()}`;
    script.dataset.dashboardScript = "true";
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, [sessionRole]);

  if (!isReady) {
    return (
      <div className="shell">
        <header className="topbar">
          <div>
            <h1>Beverage Dashboard</h1>
          </div>
        </header>
        <main>
          <section className="panel is-active">
            <div className="empty-state">Loading dashboard...</div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="shell" data-dashboard-role={sessionRole}>
      <header className="topbar">
        <div>
          <h1>Beverage Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <div className="top-actions dashboard-owner-only" aria-label="Dashboard sections">
            <button className="tab-button is-active" id="dashboard-tab" data-tab="dashboard" type="button">Dashboard</button>
            <button className="tab-button" id="operations-tab" data-tab="operations" type="button">Beverage Ops</button>
            <button className="tab-button" id="weekly-usage-tab" data-tab="weekly-usage" type="button">Weekly Usage</button>
            <button className="tab-button" id="recipes-tab" data-tab="recipes" data-recipe-view="current" type="button">Recipes</button>
            <button className="tab-button" id="add-tab" data-tab="add" type="button">Add Product</button>
            <button className="tab-button" id="search-tab" data-tab="search" type="button">Search</button>
          </div>
          <a className="logout-link" href="/api/logout" aria-label={`Log out of the ${sessionRole} dashboard`}>Log out</a>
        </div>
      </header>

      <dialog className="global-search-dialog dashboard-owner-only" id="global-search-dialog" aria-labelledby="global-search-title">
        <div className="global-search-dialog__header">
          <label htmlFor="global-search-input">
            <span className="sr-only" id="global-search-title">Search the beverage dashboard</span>
            <span className="global-search-dialog__icon" aria-hidden="true">⌕</span>
            <input
              id="global-search-input"
              type="search"
              placeholder="Search recipes, ingredients, taps, inventory..."
              autoComplete="off"
              aria-controls="global-search-results"
              aria-autocomplete="list"
            />
          </label>
          <button className="global-search-close" id="global-search-close" type="button" aria-label="Close dashboard search">Esc</button>
        </div>
        <p className="global-search-hint" id="global-search-hint"></p>
        <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Dashboard search results"></div>
      </dialog>

      <main>
        <section className="panel is-active" id="dashboard-panel" role="tabpanel" aria-labelledby="dashboard-tab">
          <div className="dashboard-overview" id="dashboard-overview"></div>
        </section>

        <section className="panel" id="search-panel" role="tabpanel" aria-labelledby="search-tab">
          <div className="dashboard-data-search">
            <form className="dashboard-data-search__form" id="dashboard-data-search-form">
              <label htmlFor="dashboard-data-search-input">What do you want to know?</label>
              <div>
                <input
                  id="dashboard-data-search-input"
                  type="search"
                  autoComplete="off"
                />
                <button className="primary-button" type="submit">Search</button>
              </div>
            </form>
            <p className="dashboard-data-search__feedback" id="dashboard-data-search-feedback" aria-live="polite"></p>
            <div className="dashboard-data-search__results" id="dashboard-data-search-results"></div>
          </div>
        </section>

        <section className="panel" id="recipes-panel" role="tabpanel" aria-labelledby="recipes-tab">
          <header className="recipe-workspace-header">
            <div>
              <h2>Cocktail Recipes</h2>
            </div>
            <div className="recipe-view-switcher" role="tablist" aria-label="Recipe status">
              <button
                className="recipe-view-button is-active"
                id="current-recipes-tab"
                data-recipe-view="current"
                type="button"
                role="tab"
                aria-controls="current-recipes-view"
                aria-selected="true"
              >
                Current <span id="current-recipe-count"></span>
              </button>
              <button
                className="recipe-view-button"
                id="old-recipes-tab"
                data-recipe-view="old"
                type="button"
                role="tab"
                aria-controls="old-recipes-view"
                aria-selected="false"
                tabIndex={-1}
              >
                Old Recipes <span id="old-recipe-count"></span>
              </button>
            </div>
          </header>

          <div id="current-recipes-view" role="tabpanel" aria-labelledby="current-recipes-tab">
            <div className="toolbar">
              <label className="search-field">
                <span>Search recipes or ingredients</span>
                <input id="recipe-search" type="search" placeholder="Search cocktails, liquor, juice..." />
              </label>
              <label className="select-field">
                <span>Spirit</span>
                <select id="category-filter">
                  <option value="all">All spirits</option>
                </select>
              </label>
            </div>

            <div className="stats-grid" id="stats-grid"></div>
            <section className="recipe-coverage-alert" id="recipe-coverage-alert" aria-live="polite" hidden></section>
            <div className="recipe-grid" id="recipe-grid"></div>
          </div>

          <div id="old-recipes-view" role="tabpanel" aria-labelledby="old-recipes-tab" hidden>
            <div className="toolbar">
              <label className="search-field">
                <span>Search old recipes</span>
                <input id="old-search" type="search" placeholder="Search deactivated cocktails..." />
              </label>
            </div>
            <div className="recipe-grid" id="old-recipe-grid"></div>
          </div>
        </section>

        <section className="panel" id="pricing-panel" role="tabpanel" aria-label="Tap Pricing">
          <OperationsBar context="pricing" />
          <div className="toolbar">
            <label className="search-field">
              <span>Find recipe</span>
              <input id="pricing-search" type="search" placeholder="Search charge pricing..." />
            </label>
            <button className="ghost-button" id="clear-charges" type="button">Clear charge overrides</button>
          </div>

          <section className="pricing-advisor" aria-labelledby="pricing-advisor-title">
            <div className="pricing-advisor__header">
              <div>
                <h2 id="pricing-advisor-title">82% Price Suggestions</h2>
              </div>
            </div>
            <div className="pricing-advisor__summary" id="pricing-advisor-summary" aria-live="polite"></div>
            <div className="pricing-table-wrap">
              <table className="pricing-table pricing-advisor__table">
                <thead>
                  <tr>
                    <th>Tap</th>
                    <th>Product</th>
                    <th>Current</th>
                    <th>Current gross margin</th>
                    <th>82% suggested price</th>
                    <th>Change</th>
                    <th>Status</th>
                    <th>Owner approval</th>
                  </tr>
                </thead>
                <tbody id="pricing-advisor-table"></tbody>
              </table>
            </div>
          </section>

          <div className="pricing-layout">
            <aside className="pricing-summary" id="pricing-summary"></aside>
            <div className="pricing-table-wrap">
              <table className="pricing-table">
                <thead>
                  <tr>
                    <th>Tap</th>
                    <th>Product</th>
                    <th>Cost / oz</th>
                    <th>Charge</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody id="pricing-table"></tbody>
              </table>
            </div>
          </div>

          <section className="shot-pricing" aria-labelledby="shot-pricing-title">
            <div className="shot-pricing__header">
              <div>
                <h2 id="shot-pricing-title">Shot pricing</h2>
              </div>
            </div>
            <div className="shot-pricing__summary" id="shot-pricing-summary" aria-live="polite"></div>
            <div className="pricing-table-wrap">
              <table className="pricing-table shot-pricing__table">
                <thead>
                  <tr>
                    <th>Tap</th>
                    <th>Liquor</th>
                    <th>Current portions</th>
                    <th>New portion prices</th>
                    <th>Status</th>
                    <th>Owner action</th>
                  </tr>
                </thead>
                <tbody id="shot-pricing-table"></tbody>
              </table>
            </div>
          </section>

        </section>

        <section className="panel" id="keg-levels-panel" role="tabpanel" aria-label="Keg Levels">
          <OperationsBar context="keg-levels" />
          <div className="keg-layout">
            <aside className="keg-summary" id="keg-summary"></aside>
            <div className="keg-walls" id="keg-walls"></div>
          </div>
        </section>

        <section className="panel" id="weekly-plan-panel" role="tabpanel" aria-label="Weekly Plan">
          <OperationsBar context="weekly-plan" />
          <div id="weekly-plan" className="weekly-plan"></div>
        </section>

        <section className="panel" id="add-panel" aria-labelledby="add-tab">
          <div className="add-workspace">
          <div className="add-product-switcher" role="tablist" aria-label="Choose a product type">
            <button
              className="add-product-switcher__button is-active"
              id="add-product-cocktail-tab"
              data-add-product-type="cocktail"
              type="button"
              role="tab"
              aria-controls="recipe-form"
              aria-selected="true"
            >
              Cocktail recipe
            </button>
            <button
              className="add-product-switcher__button"
              id="add-product-beer-tab"
              data-add-product-type="beer"
              type="button"
              role="tab"
              aria-controls="pmb-product-form"
              aria-selected="false"
            >
              Beer keg
            </button>
            <button
              className="add-product-switcher__button"
              id="add-product-liquor-tab"
              data-add-product-type="liquor"
              type="button"
              role="tab"
              aria-controls="liquor-product-form"
              aria-selected="false"
            >
              Liquor tap
            </button>
          </div>

          <form
            className="recipe-form add-product-form"
            id="recipe-form"
            data-add-product-form="cocktail"
            role="tabpanel"
            aria-labelledby="add-product-cocktail-tab"
          >
            <div className="form-header">
              <div>
                <h2 id="recipe-form-title">Add cocktail product</h2>
              </div>
              <div className="form-actions">
                <button className="ghost-button" id="cancel-edit" type="button" hidden>Cancel edit</button>
                <button className="primary-button" id="recipe-submit-button" type="submit">Save recipe draft</button>
              </div>
            </div>

            <div className="form-grid">
              <label>
                <span>Recipe name</span>
                <input id="new-recipe-title" type="text" required placeholder="Example: Spicy Pineapple Margarita" />
              </label>
              <label>
                <span>Spirit</span>
                <select id="new-recipe-category">
                  <option>Vodka</option>
                  <option>Tequila</option>
                  <option>Whiskey</option>
                  <option>Gin</option>
                  <option>Rum</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                <span>Tap wall price / oz</span>
                <input id="new-recipe-charge" type="text" inputMode="decimal" placeholder="2.49" />
              </label>
              <label className="auto-description-field">
                <span>Description</span>
                <textarea id="new-recipe-description" rows="3" placeholder="Auto-created when you add the recipe"></textarea>
              </label>
              <div className="image-picker" data-picker="recipe">
                <div className="image-picker__preview">
                  <img id="new-recipe-image-preview" alt="Recipe default" />
                </div>
                <div className="image-picker__controls">
                  <span>Default picture</span>
                  <input id="new-recipe-image" type="hidden" />
                  <div className="image-picker__actions">
                    <button className="ghost-button" id="shuffle-recipe-image" type="button">Shuffle image</button>
                    <button className="ghost-button" id="shuffle-recipe-description" type="button">Shuffle description</button>
                  </div>
                </div>
              </div>
              <div className="recipe-generated-summary" id="recipe-generated-summary">Recipe financials will appear here.</div>
            </div>

            <div className="builder-panel">
              <div className="builder-panel__header">
                <h3>Ingredients</h3>
                <button className="ghost-button" id="add-ingredient-row" type="button">Add ingredient</button>
              </div>
              <p className="formula-note">List the liquor first.</p>
              <div className="new-ingredient-table-wrap">
                <table className="new-ingredient-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Cost</th>
                      <th>Bottles / gallons</th>
                      <th>Oz in recipe</th>
                      <th>ABV %</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="new-ingredient-rows"></tbody>
                </table>
              </div>
            </div>
          </form>

          <form
            className="recipe-form pmb-product-form add-product-form"
            id="pmb-product-form"
            data-add-product-form="beer"
            role="tabpanel"
            aria-labelledby="add-product-beer-tab"
            hidden
          >
            <div className="form-header">
              <div>
                <h2>Add beer product</h2>
              </div>
              <div className="form-actions">
                <button className="primary-button" id="pmb-product-submit" type="submit">Save beer to queue</button>
              </div>
            </div>

            <div className="form-grid pmb-product-grid">
              <input id="pmb-product-kind" type="hidden" value="beer" />
              <div className="form-field untappd-search-field">
                <label htmlFor="pmb-product-name">Beer product name</label>
                <input
                  id="pmb-product-name"
                  type="search"
                  required
                  autoComplete="off"
                  placeholder="Search Untappd, e.g. Garage Beer"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="false"
                  aria-controls="beer-untappd-results"
                />
                <div className="untappd-search-results" id="beer-untappd-results" role="listbox" hidden></div>
              </div>
              <label>
                <span>Keg cost</span>
                <input id="pmb-product-keg-cost" type="text" inputMode="decimal" required placeholder="185" />
              </label>
              <label>
                <span>Keg size</span>
                <select id="pmb-product-keg-oz" required defaultValue="1984">
                  <option value="1984">15.5 gal half barrel</option>
                  <option value="1690.7">50 L import keg</option>
                  <option value="992">7.75 gal quarter barrel</option>
                  <option value="661">5.16 gal sixth barrel</option>
                </select>
              </label>
              <label>
                <span>Profit margin %</span>
                <input id="pmb-product-margin" type="text" inputMode="decimal" placeholder="82" />
              </label>
              <div className="generated-beer-summary" id="pmb-generated-summary">Generated PMB price will appear here.</div>
              <input id="pmb-product-price" type="hidden" />
              <input id="pmb-product-serving" type="hidden" />
              <input id="pmb-product-abv" type="hidden" />
              <input id="pmb-product-brewery" type="hidden" />
              <input id="pmb-product-style" type="hidden" />
              <input id="pmb-product-ibu" type="hidden" />
              <label className="pmb-product-notes">
                <span>Internet description</span>
                <textarea id="pmb-product-notes" rows="3" placeholder="Pulled from an internet source for this beer"></textarea>
              </label>
              <div className="image-picker pmb-product-image" data-picker="pmb-product">
                <div className="image-picker__preview">
                  <img id="pmb-product-image-preview" alt="Beer product default" />
                </div>
                <div className="image-picker__controls">
                  <span>676x540 preview</span>
                  <input id="pmb-product-image" type="hidden" />
                  <div className="image-picker__actions">
                    <button className="ghost-button" id="shuffle-pmb-product-image" type="button">Shuffle image</button>
                    <button className="ghost-button" id="shuffle-pmb-product-description" type="button">Shuffle description</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="pmb-product-status" id="pmb-product-status"></div>
          </form>

          <form
            className="recipe-form pmb-product-form liquor-product-form add-product-form"
            id="liquor-product-form"
            data-add-product-form="liquor"
            role="tabpanel"
            aria-labelledby="add-product-liquor-tab"
            hidden
          >
            <div className="form-header">
              <div>
                <h2>Add liquor tap</h2>
              </div>
              <div className="form-actions">
                <button className="primary-button" id="liquor-product-submit" type="submit">Save liquor to queue</button>
              </div>
            </div>

            <div className="form-grid liquor-product-grid">
              <div className="form-field untappd-search-field">
                <label htmlFor="liquor-product-name">Liquor product name</label>
                <input
                  id="liquor-product-name"
                  type="search"
                  required
                  autoComplete="off"
                  placeholder="Search On Par products in Untappd"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="false"
                  aria-controls="liquor-untappd-results"
                />
                <div className="untappd-search-results" id="liquor-untappd-results" role="listbox" hidden></div>
              </div>
              <label>
                <span>Charge / oz</span>
                <input id="liquor-product-price" type="text" inputMode="decimal" required placeholder="3.50" />
              </label>
              <label>
                <span>Pour size oz</span>
                <input id="liquor-product-serving" type="text" inputMode="decimal" required defaultValue="1.5" />
              </label>
              <label>
                <span>ABV %</span>
                <input id="liquor-product-abv" type="text" inputMode="decimal" required defaultValue="40" />
              </label>
              <label>
                <span>Bottle cost</span>
                <input id="liquor-product-bottle-cost" type="text" inputMode="decimal" required placeholder="98.70" />
              </label>
              <label>
                <span>Bottle oz</span>
                <input id="liquor-product-bottle-oz" type="text" inputMode="decimal" required defaultValue="59.17" />
              </label>
              <label className="liquor-product-notes">
                <span>Notes</span>
                <textarea id="liquor-product-notes" rows="3" placeholder="Optional PMB tasting notes"></textarea>
              </label>
            </div>
            <div className="pmb-product-status" id="liquor-product-status"></div>
          </form>

          <section className="pmb-publish-queue dashboard-owner-only" aria-labelledby="pmb-publish-queue-title">
            <div className="pmb-publish-queue__header">
              <div>
                <h2 id="pmb-publish-queue-title">Pour My Beer publishing queue</h2>
              </div>
              <button className="ghost-button" id="check-pmb-queue-connection" type="button">Check PMB connection</button>
            </div>
            <div className="pmb-queue-connection" id="pmb-queue-connection" data-state="idle" aria-live="polite">
              PMB connection not checked.
            </div>
            <div className="pmb-publish-queue__summary" id="pmb-publish-queue-summary"></div>
            <div className="pmb-publish-queue__list" id="pmb-publish-queue-list"></div>
          </section>
          </div>
        </section>

        <section className="panel" id="ingredients-panel" role="tabpanel" aria-label="Ingredient and Keg Costs">
          <OperationsBar context="ingredients" />
          <div className="toolbar">
            <label className="search-field">
              <span>Find pricing item</span>
              <input id="ingredient-search" type="search" placeholder="Search ingredient or keg pricing..." />
            </label>
            <button className="ghost-button" id="clear-prices" type="button">Clear bottle overrides</button>
          </div>

          <div className="ingredient-layout">
            <aside className="ingredient-summary" id="ingredient-summary"></aside>
            <div className="pricing-sections">
              <section className="inventory-block">
                <div className="inventory-block__header">
                  <div>
                    <h2>Ingredient Pricing</h2>
                  </div>
                </div>
                <div className="ingredient-table-wrap">
                  <table className="ingredient-table">
                    <thead>
                      <tr>
                        <th>Ingredient</th>
                        <th>Current $/oz</th>
                        <th>Package size</th>
                        <th>Package price</th>
                        <th>Last updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody id="ingredient-table"></tbody>
                  </table>
                </div>
              </section>

              <section className="inventory-block">
                <div className="inventory-block__header pricing-section-header">
                  <div>
                    <h2>Keg Pricing</h2>
                  </div>
                  <button className="ghost-button" id="clear-keg-prices" type="button">Clear keg overrides</button>
                </div>
                <div className="ingredient-table-wrap">
                  <table className="ingredient-table">
                    <thead>
                      <tr>
                        <th>Keg</th>
                        <th>Vendor</th>
                        <th>Current $/oz</th>
                        <th>Keg oz</th>
                        <th>Keg price</th>
                        <th>Last updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody id="keg-pricing-table"></tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </section>

        <section className="panel" id="inventory-panel" role="tabpanel" aria-label="Inventory">
          <OperationsBar context="inventory" />
          <div className="toolbar">
            <label className="search-field">
              <span>Find inventory item</span>
              <input id="inventory-search" type="search" placeholder="Search liquor, mixers, reorder items..." />
            </label>
          </div>

          <div className="inventory-layout">
            <aside className="inventory-summary" id="inventory-summary"></aside>
            <div className="inventory-sections">
              <section className="inventory-block">
                <div className="inventory-block__header">
                  <div>
                    <h2>Current Inventory</h2>
                  </div>
                  <form className="custom-inventory-form" id="custom-inventory-form">
                    <label>
                      <span>Item</span>
                      <input id="custom-inventory-name" type="text" placeholder="Patron Silver" required />
                    </label>
                    <label>
                      <span>Group</span>
                      <select id="custom-inventory-group">
                        <option value="Liquor Cabinet">Liquor Cabinet</option>
                        <option value="Mixer Cabinet">Mixer Cabinet</option>
                        <option value="Other">Other</option>
                      </select>
                    </label>
                    <label>
                      <span>On hand (units)</span>
                      <input id="custom-inventory-on-hand" type="number" min="0" step="1" inputMode="numeric" placeholder="1" />
                    </label>
                    <label>
                      <span>Par (units)</span>
                      <input id="custom-inventory-par" type="number" min="0" step="1" inputMode="numeric" placeholder="0" />
                    </label>
                    <label>
                      <span>Pack size</span>
                      <input id="custom-inventory-pack-size" type="number" min="1" step="1" inputMode="numeric" defaultValue="1" />
                    </label>
                    <label>
                      <span>Case / unit cost (optional)</span>
                      <input id="custom-inventory-unit-cost" type="text" inputMode="decimal" placeholder="0.00" />
                    </label>
                    <div className="custom-inventory-form__actions">
                      <button className="primary-button" id="custom-inventory-submit" type="submit">Add item</button>
                      <button className="ghost-button" id="custom-inventory-cancel" type="button" hidden>Cancel</button>
                    </div>
                  </form>
                </div>
                <div className="inventory-table-wrap">
                  <table className="inventory-table inventory-table--stock">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>On hand (units)</th>
                        <th>Par (units)</th>
                        <th>Need (units)</th>
                        <th>Pack</th>
                        <th>Unit cost</th>
                        <th>Total value</th>
                      </tr>
                    </thead>
                    <tbody id="inventory-table"></tbody>
                  </table>
                </div>
              </section>

              <section className="inventory-block">
                <div className="inventory-block__header">
                  <div>
                    <h2>Needs To Be Ordered</h2>
                    <p className="formula-note inventory-note">Orders round to full cases.</p>
                  </div>
                </div>
                <div className="inventory-table-wrap">
                  <table className="inventory-table inventory-table--orders">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>On hand (units)</th>
                        <th>Par (units)</th>
                        <th>Order</th>
                        <th>Pack</th>
                        <th>Unit cost</th>
                        <th>Est. reorder cost</th>
                      </tr>
                    </thead>
                    <tbody id="inventory-order-table"></tbody>
                  </table>
                </div>
              </section>

              <section className="inventory-block">
                <div className="inventory-block__header">
                  <div>
                    <h2>Saved Inventory Snapshots</h2>
                  </div>
                </div>
                <div className="inventory-history-list" id="inventory-history-list"></div>
              </section>
            </div>
          </div>
        </section>

        <section className="panel" id="weekly-usage-panel" aria-labelledby="weekly-usage-tab">
          <div className="toolbar">
            <label className="search-field">
              <span>Find tap or product</span>
              <input id="weekly-usage-search" type="search" placeholder="Search tap, wall, liquor, beer, cocktail..." />
            </label>
            <label className="select-field weekly-usage-range-field">
              <span>History shown</span>
              <select id="weekly-usage-range" defaultValue="0">
                <option value="6">Recent 6 weeks</option>
                <option value="12">Recent 12 weeks</option>
                <option value="0">All history</option>
              </select>
            </label>
            <button className="ghost-button" id="pull-pmb-weekly-usage" type="button">Pull PMB report</button>
          </div>

          <div className="inventory-layout">
            <aside className="weekly-usage-summary" id="weekly-usage-summary"></aside>
            <div className="inventory-sections">
              <section className="inventory-block">
                <div className="inventory-block__header">
                  <div>
                    <h2>Weekly Usage Tracker</h2>
                  </div>
                </div>
                <div className="inventory-table-wrap">
                  <table className="inventory-table weekly-usage-table">
                    <thead id="weekly-usage-head"></thead>
                    <tbody id="weekly-usage-table"></tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </section>

      </main>

      <template
        id="recipe-card-template"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `
            <article class="recipe-card">
              <div class="recipe-card__header">
                <div>
                  <p class="recipe-card__batch"></p>
                  <h2></h2>
                </div>
                <span class="spirit-pill"></span>
              </div>
              <div class="recipe-card__actions"></div>
              <div class="recipe-card__numbers"></div>
              <div class="recipe-table-wrap">
                <table class="recipe-table">
                  <thead>
                    <tr>
                      <th>Recipe</th>
                      <th>$</th>
                      <th>Oz</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </article>
          `,
        }}
      />
    </div>
  );
}

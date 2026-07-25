"use client";

import { useEffect, useState } from "react";

function OperationsBar() {
  return (
    <div className="operations-bar">
      <div>
        <p className="eyebrow">Beverage ops</p>
        <h2>Levels, Pricing & Inventory</h2>
      </div>
      <div className="operation-tabs" aria-label="Beverage operations sections">
        <button className="operation-tab is-active" data-operation-tab="keg-levels" type="button">Keg Levels</button>
        <button className="operation-tab" data-operation-tab="inventory" type="button">Inventory</button>
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
        if (isMounted) setSessionRole(result?.role === "employee" ? "employee" : "owner");
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
            <p className="eyebrow">Batch cocktail costing</p>
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
          <p className="eyebrow">{isEmployee ? "Staff recipe view" : "Batch cocktail costing"}</p>
          <h1>Beverage Dashboard</h1>
        </div>
        <div className="top-actions dashboard-owner-only" aria-label="Dashboard controls">
          <button className="tab-button is-active" data-tab="recipes" type="button">Recipes</button>
          <button className="tab-button" data-tab="operations" type="button">Beverage Ops</button>
          <button className="tab-button" data-tab="weekly-usage" type="button">Weekly Usage</button>
          <button className="tab-button" data-tab="add" type="button">Add Product</button>
          <button className="tab-button" data-tab="old" type="button">Old Recipes</button>
        </div>
      </header>

      <main>
        <section className="panel is-active" id="recipes-panel" aria-labelledby="recipes-tab">
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
          <div className="recipe-grid" id="recipe-grid"></div>
        </section>

        <section className="panel" id="pricing-panel" aria-labelledby="pricing-tab">
          <OperationsBar />
          <div className="toolbar">
            <label className="search-field">
              <span>Find recipe</span>
              <input id="pricing-search" type="search" placeholder="Search charge pricing..." />
            </label>
            <button className="ghost-button" id="clear-charges" type="button">Clear charge overrides</button>
          </div>

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
        </section>

        <section className="panel" id="keg-levels-panel" aria-labelledby="keg-levels-tab">
          <OperationsBar />
          <div className="keg-layout">
            <aside className="keg-summary" id="keg-summary"></aside>
            <div className="keg-walls" id="keg-walls"></div>
          </div>
        </section>

        <section className="panel" id="add-panel" aria-labelledby="add-tab">
          <div className="add-workspace">
          <form className="recipe-form" id="recipe-form">
            <div className="form-header">
              <div>
                <p className="eyebrow">Product builder</p>
                <h2 id="recipe-form-title">Add cocktail product</h2>
              </div>
              <div className="form-actions">
                <button className="ghost-button" id="cancel-edit" type="button" hidden>Cancel edit</button>
                <button className="primary-button" id="recipe-submit-button" type="submit">Add product</button>
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
              <p className="formula-note">Put the liquor as the first ingredient. The dashboard uses that first row to calculate how many ounces of cocktail equal 1.5 oz of alcohol.</p>
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

          <form className="recipe-form pmb-product-form" id="pmb-product-form">
            <div className="form-header">
              <div>
                <p className="eyebrow">Pour My Beer</p>
                <h2>Add beer product</h2>
              </div>
              <div className="form-actions">
                <button className="primary-button" id="pmb-product-submit" type="submit">Send to PMB</button>
              </div>
            </div>

            <div className="form-grid pmb-product-grid">
              <input id="pmb-product-kind" type="hidden" value="beer" />
              <label>
                <span>Beer product name</span>
                <input id="pmb-product-name" type="text" required placeholder="Example: Garage Beer" />
              </label>
              <label>
                <span>Keg cost</span>
                <input id="pmb-product-keg-cost" type="text" inputMode="decimal" required placeholder="185" />
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
              <input id="pmb-product-keg-oz" type="hidden" />
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
            <div className="pmb-product-status" id="pmb-product-status">Ready to create a new beer keg product in Pour My Beer.</div>
          </form>

          <form className="recipe-form pmb-product-form liquor-product-form" id="liquor-product-form">
            <div className="form-header">
              <div>
                <p className="eyebrow">Pour My Beer</p>
                <h2>Add liquor tap</h2>
              </div>
              <div className="form-actions">
                <button className="primary-button" id="liquor-product-submit" type="submit">Send to PMB</button>
              </div>
            </div>

            <div className="form-grid liquor-product-grid">
              <label>
                <span>Liquor product name</span>
                <input id="liquor-product-name" type="text" required placeholder="Example: Patron Silver" />
              </label>
              <label>
                <span>Charge / oz</span>
                <input id="liquor-product-price" type="text" inputMode="decimal" required placeholder="3.50" />
              </label>
              <label>
                <span>Pour size oz</span>
                <input id="liquor-product-serving" type="text" inputMode="decimal" placeholder="1.5" />
              </label>
              <label>
                <span>ABV %</span>
                <input id="liquor-product-abv" type="text" inputMode="decimal" placeholder="40" />
              </label>
              <label>
                <span>Bottle cost</span>
                <input id="liquor-product-bottle-cost" type="text" inputMode="decimal" placeholder="98.70" />
              </label>
              <label>
                <span>Bottle oz</span>
                <input id="liquor-product-bottle-oz" type="text" inputMode="decimal" placeholder="59.17" />
              </label>
              <label className="liquor-product-notes">
                <span>Notes</span>
                <textarea id="liquor-product-notes" rows="3" placeholder="Optional PMB tasting notes"></textarea>
              </label>
            </div>
            <div className="pmb-product-status" id="liquor-product-status">Ready to create a straight liquor tap in Pour My Beer.</div>
          </form>
          </div>
        </section>

        <section className="panel" id="ingredients-panel" aria-labelledby="ingredients-tab">
          <OperationsBar />
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
                    <p className="eyebrow">Cocktail Ingredients</p>
                    <h2>Ingredient Pricing</h2>
                  </div>
                </div>
                <div className="ingredient-table-wrap">
                  <table className="ingredient-table">
                    <thead>
                      <tr>
                        <th>Ingredient</th>
                        <th>Current $/oz</th>
                        <th>Bottle oz</th>
                        <th>Bottle price</th>
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
                    <p className="eyebrow">Beer Kegs</p>
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

        <section className="panel" id="inventory-panel" aria-labelledby="inventory-tab">
          <OperationsBar />
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
                    <p className="eyebrow">Snapshot</p>
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
                      <span>Case / unit cost</span>
                      <input id="custom-inventory-unit-cost" type="text" inputMode="decimal" placeholder="0.00" />
                    </label>
                    <button className="primary-button" type="submit">Add item</button>
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
                    <p className="eyebrow">Reorder List</p>
                    <h2>Needs To Be Ordered</h2>
                    <p className="formula-note inventory-note">Counts and pars use individual units. Packaged products round up to their full case size.</p>
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
                    <p className="eyebrow">Weekly History</p>
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
                    <p className="eyebrow">Historical Usage</p>
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

        <section className="panel" id="old-panel" aria-labelledby="old-tab">
          <div className="toolbar">
            <label className="search-field">
              <span>Search old recipes</span>
              <input id="old-search" type="search" placeholder="Search deactivated cocktails..." />
            </label>
          </div>
          <div className="recipe-grid" id="old-recipe-grid"></div>
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

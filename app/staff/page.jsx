import Script from "next/script";

export const metadata = {
  title: "Weekly Plan | On Par Staff",
  description: "Weekly cocktail prep checklist and recipes for On Par staff.",
};

export default function StaffRecipePage() {
  return (
    <div className="shell staff-recipe-shell" data-staff-dashboard="true">
      <header className="topbar">
        <div>
          <p className="staff-view-mark">Staff View</p>
          <h1>Weekly Plan</h1>
        </div>
        <div className="topbar-actions">
          <span className="staff-recipe-badge">Prep + recipe access</span>
          <a className="logout-link" href="/api/logout">Log out</a>
        </div>
      </header>

      <nav className="staff-section-tabs" role="tablist" aria-label="Staff workspaces">
        <button className="staff-section-tab is-active" data-staff-section-tab="overview" type="button" role="tab" aria-controls="staff-overview-panel" aria-selected="true">Overview</button>
        <button className="staff-section-tab" data-staff-section-tab="prep" type="button" role="tab" aria-controls="staff-prep-panel" aria-selected="false" tabIndex={-1}>Cocktails to Make</button>
        <button className="staff-section-tab" data-staff-section-tab="recipes" type="button" role="tab" aria-controls="staff-recipes-panel" aria-selected="false" tabIndex={-1}>Recipes</button>
        <button className="staff-section-tab" data-staff-section-tab="orders" type="button" role="tab" aria-controls="staff-orders-panel" aria-selected="false" tabIndex={-1}>Orders to Receive</button>
      </nav>

      <main>
        <section className="panel is-active staff-overview-panel" id="staff-overview-panel" role="tabpanel" aria-labelledby="staff-overview-title">
          <div className="staff-recipe-intro">
            <div>
              <p className="eyebrow">Current weekly plan</p>
              <h2 id="staff-overview-title">Weekly overview</h2>
            </div>
            <p id="staff-overview-week" className="staff-overview-week">Loading this week&apos;s plan...</p>
          </div>
          <div className="staff-overview-grid">
            <button className="staff-overview-card" data-staff-section-target="prep" type="button">
              <span>Cocktails to make</span>
              <strong id="staff-overview-prep-value">—</strong>
              <small id="staff-overview-prep-detail">Loading prep plan...</small>
            </button>
            <button className="staff-overview-card" data-staff-section-target="orders" type="button">
              <span>Orders to receive</span>
              <strong id="staff-overview-order-value">—</strong>
              <small id="staff-overview-order-detail">Loading delivery plan...</small>
            </button>
            <button className="staff-overview-card" data-staff-section-target="recipes" type="button">
              <span>Cocktail recipes</span>
              <strong id="staff-overview-recipe-value">—</strong>
              <small id="staff-overview-recipe-detail">Loading recipes...</small>
            </button>
          </div>
        </section>

        <section className="panel staff-prep-panel" id="staff-prep-panel" role="tabpanel" aria-labelledby="staff-prep-title" hidden>
          <div className="staff-recipe-intro">
            <div>
              <p className="eyebrow">Current weekly plan</p>
              <h2 id="staff-prep-title">Cocktails to make</h2>
            </div>
            <p>Enter who prepared each cocktail, check it off, and save. Updates are shared with the current Monday–Sunday plan.</p>
          </div>
          <div id="staff-prep-status" className="staff-recipe-status" role="status" aria-live="polite">
            Loading this week&apos;s prep checklist...
          </div>
          <div id="staff-prep-summary" className="staff-prep-summary" aria-live="polite"></div>
          <div id="staff-prep-list" className="staff-prep-list" aria-busy="true"></div>
        </section>

        <section className="panel staff-order-panel" id="staff-orders-panel" role="tabpanel" aria-labelledby="staff-order-title" hidden>
          <div className="staff-recipe-intro">
            <div>
              <p className="eyebrow">Delivery checklist</p>
              <h2 id="staff-order-title">Orders to receive</h2>
            </div>
            <p>Check off a full delivery, or enter the quantity received when an order arrives short. Missing items alert the owner dashboard.</p>
          </div>
          <div id="staff-order-status" className="staff-recipe-status" role="status" aria-live="polite">
            Loading this week&apos;s order checklist...
          </div>
          <div id="staff-order-summary" className="staff-prep-summary" aria-live="polite"></div>
          <div id="staff-order-list" className="staff-order-list" aria-busy="true"></div>
        </section>

        <section className="panel" id="staff-recipes-panel" role="tabpanel" aria-labelledby="staff-recipes-title" hidden>
          <div className="staff-recipe-intro">
            <div>
              <p className="eyebrow">Batch preparation</p>
              <h2 id="staff-recipes-title">Cocktail recipes</h2>
            </div>
            <p>Search by cocktail or ingredient. This view contains recipe quantities only.</p>
          </div>

          <div className="recipe-view-switcher staff-recipe-view-switcher" role="tablist" aria-label="Recipe status">
            <button
              className="recipe-view-button is-active"
              data-staff-recipe-view="current"
              type="button"
              role="tab"
              aria-selected="true"
            >
              Current <span id="staff-current-recipe-count"></span>
            </button>
            <button
              className="recipe-view-button"
              data-staff-recipe-view="inactive"
              type="button"
              role="tab"
              aria-selected="false"
              tabIndex={-1}
            >
              Deactivated <span id="staff-inactive-recipe-count"></span>
            </button>
          </div>

          <div className="toolbar">
            <label className="search-field">
              <span>Search recipes or ingredients</span>
              <input id="staff-recipe-search" type="search" placeholder="Search cocktails, liquor, juice..." autoComplete="off" />
            </label>
            <label className="select-field">
              <span>Spirit</span>
              <select id="staff-category-filter" defaultValue="all">
                <option value="all">All spirits</option>
              </select>
            </label>
          </div>

          <div id="staff-recipe-status" className="staff-recipe-status" role="status" aria-live="polite">
            Loading current recipes...
          </div>
          <div className="stats-grid staff-stats-grid" id="staff-stats-grid" aria-label="Recipe summary"></div>
          <div className="recipe-grid" id="staff-recipe-grid" aria-busy="true"></div>
          <noscript><p className="empty-state">JavaScript is required to load the recipe cards.</p></noscript>
        </section>
      </main>

      <Script type="module" src="/staff-dashboard.js" strategy="afterInteractive" />
    </div>
  );
}

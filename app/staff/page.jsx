import Script from "next/script";

export const metadata = {
  title: "On Par Staff Prep",
  description: "Weekly cocktail prep checklist and recipes for On Par staff.",
};

export default function StaffRecipePage() {
  return (
    <div className="shell staff-recipe-shell" data-staff-dashboard="true">
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff preparation view</p>
          <h1>On Par Cocktail Prep</h1>
        </div>
        <div className="topbar-actions">
          <span className="staff-recipe-badge">Prep + recipe access</span>
          <a className="logout-link" href="/api/logout">Log out</a>
        </div>
      </header>

      <main>
        <section className="panel is-active staff-prep-panel" aria-labelledby="staff-prep-title">
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

        <section className="panel is-active" aria-labelledby="staff-recipes-title">
          <div className="staff-recipe-intro">
            <div>
              <p className="eyebrow">Batch preparation</p>
              <h2 id="staff-recipes-title">Cocktail recipes</h2>
            </div>
            <p>Search by cocktail or ingredient. This view contains recipe quantities only.</p>
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

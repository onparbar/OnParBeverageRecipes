import Script from "next/script";

export const metadata = {
  title: "On Par Staff Recipes",
  description: "Recipe-only preparation view for On Par staff.",
};

export default function StaffRecipePage() {
  return (
    <div className="shell staff-recipe-shell" data-staff-dashboard="true">
      <header className="topbar">
        <div>
          <p className="eyebrow">Staff recipe view</p>
          <h1>On Par Recipes</h1>
        </div>
        <div className="topbar-actions">
          <span className="staff-recipe-badge">Recipe access only</span>
          <a className="logout-link" href="/api/logout">Log out</a>
        </div>
      </header>

      <main>
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

# On Par dashboard audit — September 6, 2026

**Overall assessment: 6.8/10 today.** The dashboard has strong operational depth, a coherent visual identity, and useful manager/staff workflows. The main obstacles are disconnected controls, ambiguous data states, and incomplete reconciliation between related workflows. Completing those connections should take priority over adding more standalone features.

These are editorial scores for usefulness, usability, completeness, and trust, not an external benchmark. A 5 means usable with substantial friction; 7 means strong but with meaningful gaps; 9 means polished and dependable in ordinary use.

| Area | Score | What works | Most valuable next improvement |
|---|---:|---|---|
| Visual design and branding | 8/10 | Consistent cream/green palette and strong typography | Reduce large headers and wasted vertical space; bring decisions above the fold |
| Home and executive usefulness | 7/10 | Beverage Brief, guest favorites, actionable weekly progress | Add concise impact, data coverage, and ownership to the existing brief |
| Keg Levels | 6.5/10 | Physical taps, walls, On Deck, attention filter | Resolve partial Karaoke coverage and improve stale/unknown-state explanations |
| Inventory | 5.5/10 | Counts, pars, case rounding, cost links, snapshots | Distinguish uncounted from zero and separate current par gaps from locked orders |
| Weekly Plan and ordering | 7.5/10 | Guided Monday run, locked plan, delivery/prep follow-through | Close receiving into keg stock and expose mapping exceptions |
| Staff View | 7.5/10 | Focused workspaces and shared completion | Surface inventory reconciliation warnings and simplify remaining name instructions |
| Recipe library | 8/10 | Readable recipes, batch amounts, ABV/costs, archive | Add true draft/readiness states and catalog-based ingredient selection |
| Add Product / publishing | 6/10 | Beer/liquor/cocktail flows and PMB queue | Make enrichment optional; show one clear setup-completion checklist |
| Ingredient and keg costs | 6.5/10 | Substantial existing mapping and package-level pricing | Reconnect vendor controls and expose per-item verification/failures |
| Tap Pricing | 7.5/10 | Verified identity, margin suggestions, explicit approval | Make the review count clickable and route issues to their repair |
| Weekly Usage / snapshots | 6/10 | Extensive history, wall identity, preserved snapshots | Validate historical intervals and clarify snapshot/plan relationships |
| Performance | 6.5/10 | Volume and projected economics by wall | Expose already-computed trends, sample coverage, and missing-input reasons |
| Search | 4/10 | Useful calculation/search modules exist | Restore universal search and correct natural-language parsing/data gaps |
| Tap-sheet printing | 8/10 | Current/On Deck sheets and change detection | Add a separate dated management report for meetings |
| Technical reliability | 7.5/10 | Extensive tests, shared revisions, outboxes, recovery | Add browser smoke coverage and resilient startup |
| Mobile / keyboard usability | 5.5/10 provisional | Responsive styles and some keyboard-aware tabs | Fix sticky column widths, multiline Enter behavior, and dense count tables |

**Review coverage and limits.** I opened the live owner dashboard at onparbev.com and inspected Home, all four Beverage Ops areas, Search, Weekly Usage, Tap Pricing, Ingredient & Keg Costs, Recipes, Add Product, Performance, and Print. I also opened Staff View as the existing administrator and inspected its overview, delivery receiving, and cocktail prep. I reviewed the local frontend, APIs, integrations, calculations, tests, and operations documentation with three independent audit passes.

I did not submit orders, publish PMB products, repair tap connections, mark deliveries/prep complete, edit counts, or deploy changes. Navigation can trigger the dashboard's existing automatic refresh/sync behavior. Staff behavior under an actual employee login and final write operations were reviewed in code rather than exercised against business data. The connected browser did not apply the requested phone-size viewport; mobile findings are source-based and need device verification. Live deployment and local source differ in at least one visible label, so source-only findings are explicitly identified.

Validation passed: **673 tests, zero-warning lint, and the optimized build**. The available shell used Node 26.3.0; the project declares Node 22. This run is not a substitute for the production Node 22 release check. Existing uncommitted application changes were preserved.

**Highest-priority findings.**

1. **Current PMB coverage is incomplete — live verified.** Home reported 91 of 102 taps with current readings. Keg Levels listed sync issues on Karaoke taps **73, 75, 76, 77, 78, 85, 86, 95, 96, 99, and 100**. The underlying cause was not established; this may involve connectivity, physical configuration, current product assignment, or feed interpretation. Investigate each affected tap against PMB. Preserve unknown readings as unknown and show the last verified product/read time. The live Keg Levels sentence “Found live levels for 102 products” is confusing alongside a 91-live metric; align the wording to verified coverage.

   **Done when:** every expected active tap is verified, or explicitly classified with a specific reason and owner; all summaries use the same coverage definition.

2. **Inventory mixes unrelated estimates — live and source verified.** The live Inventory summary showed **21 items to reorder** and **$160 estimated purchase**, while its Par Gap Reference showed **$9,069.71 estimated reorder total**. The $160 was the locked Weekly Plan estimate; the reorder count and lower table reflected current inventory. These are different questions, but the interface does not explain that. [Inventory summary](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:13261) computes a current reorder cost but displays the weekly-plan global instead.

   **Done when:** “Current par gap” and “Locked weekly order” each show their own amount, item count, date, and explanation.

3. **Cleared counts look like counted zero — live observation plus confirmed design behavior.** The 39-item inventory displayed zero on hand and $0 current value. That does not prove the venue is empty. Missing/blank counts normalize to zero, and missing-count readiness always returns zero. This is currently intentional code behavior, but conflicts with the “fields remain blank” clearing message and makes the counting state ambiguous. [Count normalization](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:14320); [Missing-count readiness](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:5809).

   **Done when:** staff can distinguish “not counted,” “counted zero,” and a recorded quantity; the plan clearly identifies whether its input is a completed count or an explicit assumption.

4. **Historic data contains incompatible “weekly” intervals — live and pure-function verified.** All-history headers include **08/25/25–11/2/25**, overlapping **11/25/25–12/01/25** and **11/24/25–11/30/25**, and overlapping **11/11/25–11/17/25** and **11/10/25–11/16/25**. The importer accepts these labels, de-duplicates only exact text, and averages them as separate observations. Performance uses only the start date. A reproduction counted all five as five complete weeks with no conflicts. This can distort all-time averages/rankings; it does not establish that recent six-week results are wrong. [History admission/merge](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:17952); [Displayed average](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:8758); [Performance interval parsing](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/weekly-usage-seller-rankings.mjs:120).

   **Done when:** raw data is retained, weekly intervals are validated, and aggregate/overlapping records are reviewed or excluded from weekly comparisons. Do not automatically divide long-range values without verifying their meaning.

5. **Universal search is disconnected — live and source verified.** The global dialog and search index exist, but the required trigger is absent. The binding function returns before registering Cmd/Ctrl+K. The shortcut opened no dashboard dialog during review. The visible Search page is a separate usage query tool. [Search event binding](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:3452).

   **Done when:** a visible search launcher and keyboard shortcut can find a recipe, inventory item, tap, cost, and dashboard area, and open the correct destination.

6. **Natural-language search gives incorrect or unhelpful results — live and pure-function verified.** “Top 5 beers last week” asks whether 5 is a threshold; “highest profit beer last week” returns no matches, despite Performance displaying projected profit. Source periods never include profit. Additional module reproductions show 1.50 becoming 1, tap 42 being treated as a threshold, and unknown sales becoming zero via Number(null). [Search period data](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:3525); [Search parser](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/global-dashboard-search.mjs:1); [Numeric coercion](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/global-dashboard-search.mjs:334).

   **Done when:** list size, tap ID, decimal amount, metric, and period parse separately; unavailable values stay unavailable; profit is wired with correct units. Include visible example questions and editable interpreted filters.

7. **Vendor controls and feedback are unfinished — live and source verified.** Ingredient & Keg Costs contains a Vendor selector but no sync action. Selecting OHLQ left the same 83 table rows and no visible outcome. Source binding exits unless the missing Sync button exists, so the selection does not even update sync scope. Sync results/errors are assigned to a message variable that is never rendered. Automatic and individual row syncing do exist; this is not a claim that all pricing sync is absent. [Vendor controls](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:5064); [Disconnected binder](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:18245).

   **Done when:** a clearly labeled vendor filter/sync scope works, retry is available, and the screen reports verified prices, unresolved matches, package mismatches, and failed connections.

8. **Receiving does not fully update backup keg stock — source verified.** Beer receipt lines without cabinet items are skipped by inventory contributions, and the receipt workflow does not increment the backup-keg overrides used by the par agent. “Received” therefore does not mean “backup stock updated.” [Receipt contributions](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/inventory-contributions.mjs:381); [Receiving route](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/api/weekly-order-tracking/route.js:114); [Forecast stock source](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/par-agent.mjs:797).

   **Done when:** receiving allocates the quantity to the correct current/On Deck product and location, updates stock exactly once, and supports correction/reversal; alternatively, a mandatory follow-up count is unmistakable.

9. **Some mapping exceptions are silently omitted from the handoff — source verified.** Liquor-refill completion can return reviewRequired/reviewItems when the bottle cannot be deducted from inventory, but owner/staff clients only check warning. Cocktail ingredient contributions also skip some unresolved ingredients without distinguishing deliberate exclusions from accidental mapping gaps. [API review result](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/api/staff-prep-plan/route.js:198); [Staff feedback](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/staff-dashboard.js:1234); [Ingredient mapping](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/inventory-contributions.mjs:211).

   **Done when:** every required item is marked tracked, intentionally untracked, or mapping required; unresolved deductions produce a persistent manager task while accurately stating what was saved.

**Additional incomplete work and useful refinements.**

10. **Draft recipes are not truly drafts.** “Save recipe draft” only requires a name and adds the item to Current Recipes. Missing costs can resolve to zero and create misleading margins. Use Draft → Ready → Active with ingredient, quantity, cost, and mapping checks. [Recipe save](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:14984); [Zero-cost fallback](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:17170).

11. **New beer setup has avoidable lookup dependencies.** ABV is hidden and populated through Untappd, while saving requires positive ABV, a description, and an image. Add a reviewed manual fallback for missing catalog records or enrichment outages, plus sensible handling of 0.0% products if in scope. [Beer validation](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:15055); [Hidden ABV](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/page.jsx:562).

12. **The live PMB queue has unfinished business.** Octoberfest was marked Ready, saved August 15, with one item awaiting PMB review and zero published records in that queue. Its queued keg cost was $185 while the cost catalog displayed $182. Check whether this is an intentional draft and refresh/reconcile its economics before publication. Do not publish automatically based on this audit.

13. **Tap Pricing reports issues without a direct route to them.** The live screen showed 70 at/above the target and 31 Need review. “Need review” is a plain statistic; review rows can be hidden under Show all. Make it a filter and add “Fix cost,” “Verify identity,” or “Refresh portions” actions to the relevant reason. [Pricing summary and row selection](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:4421).

14. **Price verification needs item-level coverage.** Blue Rasp Powder and Non Alcoholic Beer showed “Price needed”; Bacardi was labeled Manual price. Many Bonbright costs were dated August 15 and Guinness August 10, while many OHLQ/Proof/Heidelberg rows refreshed September 6. Several bulk/food/in-house inputs said “Not updated.” Manual pricing can be intentional; label it as confirmed manual with date/source. A newly refreshed single item must not imply the whole order has current prices. [Aggregate price date](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:5798).

15. **Performance hides useful calculations it already has.** Sparklines, total value, sample counts, and reasons for unavailable economics are computed but not displayed. Expose trends, “4 of 6 weeks recorded,” total/average choices, and missing-price/cost actions. Add All walls with explicit aggregation rules, and make products open their detail. [Available performance data](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/weekly-usage-seller-rankings.mjs:434); [Rendered ranking row](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:6568). Keep projected economics labeled as estimates; they are not actual POS revenue.

16. **Loading is briefly presented as a PMB outage.** I observed this on initial load. The source places “Checking…” in an error field, then its normalizer maps the loading feed to offline. Preserve loading before error classification. [Feed builder](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:5945); [Feed normalizer](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard-overview.mjs:210).

17. **Startup and navigation need resilience.** Startup lacks a top-level failure UI; several shared loads complete before navigation binds. All sections are eagerly rendered, large scripts use per-visit cache busting, and tab navigation has no URL state. Add progressive section loading, bounded ancillary requests, Retry, release-version assets, and links that retain a selected section/tap. [Startup](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:1269); [Navigation](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:3379); [Script loading](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/page.jsx:73).

18. **Phone counting and text editing need focused attention.** Narrow-screen Keg Levels makes two columns sticky, while later rules force their combined width to 380px. On a typical 390px phone this can consume the count-table viewport. Verify on a physical device and use compact cards or only a sticky tap number. A document-level Enter handler also intercepts textareas; ordinary descriptions cannot use Enter normally. [Mobile sticky columns](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/globals.css:9186); [Forced widths](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/globals.css:10349); [Enter handler](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/public/dashboard.js:11364).

19. **Backup readiness misses one storage dependency.** Readiness omits pmb_data_backup, and the client ignores the pricing API's pmbBackupSaved:false flag. Add its provisioning check and a visible last-successful-backup signal. [Readiness tables](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/lib/supabase-readiness.mjs:3); [Pricing backup result](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/app/api/tap-pricing/route.js:444).

20. **The automated checks need a small real-browser layer.** The current passing suite contains many valuable domain tests, but some UI tests inspect source text rather than mounted controls. Add browser smoke tests for all sections, search, mocked count persistence, mobile counting, and a failed startup dependency. The disconnected controls found here should become regression cases. [Test command](/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main/package.json:16).

**Creative improvements most likely to impress a manager.**

- **Upgrade the existing Beverage Brief into a decision brief.** Three prioritized actions, each showing the reason, expected impact, owner, due date, and data confidence. Keep the weekly progress already built. Put this above the large decorative “This week” block.
- **One product detail drawer.** Bring together its recipe, PMB tap/PLU, vendor/SKU, package size, current cost and date, stock, On Deck status, usage trend, and incomplete mappings. Every table/search result should reach the same detail.
- **One mapping-completion workspace.** Explicit counts for missing PMB identity, inventory link, vendor SKU, package conversion, cost, and recipe. Every issue gets a repair action; manual or deliberately untracked items can be resolved explicitly.
- **A planned-versus-received-versus-used view.** Explain where inventory went and what changed after a delivery, prep batch, or count adjustment. Build on the existing contribution and audit systems.
- **A dated one-page manager report.** Weekly purchasing, top movers, projected gross profit with coverage, outstanding operational work, and measured improvements. Tap-sheet printing already works; management reporting is a separate deliverable.
- **A practical mobile Count mode.** One item at a time, large count controls, visible save state, location order, optional voice, and a completion summary. Reuse current counting logic.
- **Recipe finishing touches.** Catalog ingredient autocomplete, batch scaling, duplicate recipe, preparation steps, storage notes, and branded fallback imagery. These improve staff execution more than additional decoration.

**Recommended implementation order.**

| Pass | Deliverable | Success criterion |
|---|---|---|
| 1 — Trust and completion | PMB investigation, historical interval review, clear count states/KPIs, mapping exception visibility | Displayed facts reconcile and unknown inputs never masquerade as verified values |
| 2 — Daily usability | Search fixes, vendor controls, pricing-review filters, receiving stock reconciliation | Each common task works end to end and each problem links to its repair |
| 3 — Executive polish | Decision brief, product drawer, performance trends, management report, mobile Count mode | A manager understands this week and the next action within 30 seconds |
| 4 — Operational assurance | Browser smoke coverage, startup resilience, backup health, release checks on Node 22 | Normal failures are recoverable and core workflows remain usable across devices |

Before a boss walkthrough, verify the live weekly record is appropriate to present: the current snapshot's late-submission reason reads **“AI testing,”** and an earlier record reads **“Working on dashboard.”** These are observed labels, not proof that the underlying numbers are invalid. Review their meaning and preserve the audit trail rather than silently rewriting history. At review time there was also one unverified Bonbright delivery, one cocktail remaining, and a changed Karaoke tap sheet awaiting printing.

The system already has enough breadth to be impressive. The highest-value next release is one that makes its existing information consistent, its unfinished controls functional, and its recommendations easy to act on.

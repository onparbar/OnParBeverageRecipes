# Scratchpad

## Project

- Repo working copy on this Mac: `/Users/samanthawatkins/Desktop/OnParBeverageRecipes`
- Older downloaded copy exists at `/Users/samanthawatkins/Desktop/OnParBeverageRecipes-main`; use the real repo above for GitHub work.
- Stack: `Next.js` App Router
- Main UI: `app/page.jsx`
- Main styles: `app/globals.css`
- Main dashboard logic: `public/dashboard.js`
- Data files: `public/data`
- Local site: `http://localhost:3000`
- Main branch deploys to Vercel

## Login / Password Gate

- The dashboard has a site-wide password gate.
- Login page: `/login`
- Login API route: `app/api/login/route.js`
- Middleware: `middleware.js`
- Required env var:
  - `DASHBOARD_PASSWORD`
- The password is not committed; set it in `.env.local` for local dev and in Vercel environment variables for production.
- Successful login sets an HTTP-only signed cookie for 7 days.

## Main Tabs

- `Recipes`
- `Tap Wall Pricing`
- `Keg Levels`
- `Pricing`
- `Inventory`
- `Weekly Usage`
- `Add Recipe`
- `Old Recipes`

## Tap Wall Pricing

- Tap Wall Pricing now pulls current charge-per-ounce values from Pour My Beer.
- Route: `app/api/tap-pricing/route.js`
- PMB source endpoint: `/api/productlist`
- PMB field mapping:
  - `price_per_unit` is cents per ounce
  - `tapPosition` is the current order from PMB product list, displayed as `Tap 1` through `Tap 102`
- The screen is ordered by the live PMB tap/product order, not grouped by cocktail vs beer.
- Current behavior:
  - cocktail rows are matched back to recipes when possible so cost, profit, margin, pour oz, and charge per pour still calculate
  - beer rows are matched back to keg pricing when possible so keg cost/margin can display
  - unmapped PMB products still display with live charge per ounce
  - manual charge overrides still win over PMB pricing for matched cocktail recipe rows
  - CSV default charge is only a fallback when PMB does not have a matched cocktail row
- Verified examples:
  - `Tap 1` = `Jack Daniel's Whiskey 3`
  - `Tap 2` = `Tito's Vodka 2`
  - `Tap 3` = `Kona Big Wave 1`
  - `Pabst Blue Ribbon 1` and `Pabst Blue Ribbon 2` both appear as separate PMB rows
- Latest local verification showed `102` current PMB taps.

## Current Recipe Behavior

- Recipe cards support edit / deactivate / reactivate.
- Recipe cards show:
  - total cost
  - total oz
  - ABV
  - profit margin
- Recipe ingredient lines now:
  - show gallons on the recipe line for `Cranberry Juice`, `Lemonade`, `Strawberry Lemonade`, and `Simple Syrup`
  - keep ounces in the `oz` column
  - show bottle sizes in parentheses when bottle-based, like `(1L)`, `(1.75L)`, `(750mL)`
- `On Par Tee` is categorized as `Whiskey`.
- `Add Recipe` auto-calculates ounces from mapped bottle sizes or gallons.
- Recipes default to `12 gallon keg`.

## Cocktail Ingredients Notes

- Ingredient page includes update buttons and last-updated timestamps.
- `Used In` was removed.
- Schnapps were split out into:
  - `Blueberry Schnapps`
  - `Strawberry Schnapps`
  - `Raspberry Schnapps`
  - `Watermelon Schnapps`
  - `Peach Schnapps`
  - plus existing `Apple`, `Apple Pucker`, and `Pomegranate`
- Current category structure is aligned around vendor / storage logic, including:
  - `Liquor`
  - `Proof`
  - `Buckeye Beverage`
  - `Food Vendors`
  - `Made In House`
  - `Other`
- `Cold Brew` is in `Food Vendors`.
- `Creme de Cacao`, `Mint`, `Lemon Juice`, and `Lime Juice` are in `Proof`.
- `Simple Syrup` and `Blue Dot Juice` are `Made In House`.
- `Sweet and Sour` is treated as the same item as `Sour Mix`.
- Hidden/duplicate pricing cleanup:
  - duplicate `1152 Blue Dot Juice` was removed from pricing display
  - `Blue Dot Juice` stays under `Made In House`
- Current default ingredient pricing overrides in code:
  - `Blue Dot Juice`: 1 gallon / 128 oz from 6 flavor packets; 6-packet box costs `$1`
  - `Lemonade`: 3 gallon box diluted 5:1 = 18 finished gallons / 2304 oz, `$52`
  - `Cranberry Juice`, `Strawberry Lemonade`, and `Sweet Tea`: same 2304 oz yield, `$85`
  - `Simple Syrup`: `$0.03/oz`
  - `Sour Mix`: `$0.08/oz`
  - `Vanilla`: `$0.31/oz`
  - `Cold Brew`: 2 x 32 oz bottles plus 2.5 gallons water = 384 oz finished; case pricing maps to `$51.67`

## Vendor Price Sync

- Sync route: `app/api/vendor-sync/route.js`
- OHLQ pricing sync is currently routed through Provi session-based access.
- Proof mixer pricing is also pulled through Provi, but should always resolve from `Southern Glazer's Wine & Spirits`, not OHLQ.
- Mixer/liquor mappings live in `public/dashboard.js`.
- Price-change notes were added so ingredient rows can show prior price after sync.

## Provi / OHLQ Notes

- Preferred Provi location: `On Par Entertainment`
- User also has another location in Provi, so captures/sessions should always use `On Par Entertainment`
- Hosted Vercel setup expects env-based Provi session values rather than local session files
- Important env names already in use:
  - `PROVI_COOKIE_HEADER`
  - `PROVI_RETAILER_CONTEXT`
  - `PROVI_OHLQ_ACCOUNT_NUMBER`
  - `PROVI_OHLQ_DISTRIBUTOR_ID`
  - `PROVI_OHLQ_DISTRIBUTOR_ACCOUNT_ID`
  - `PROVI_OHLQ_RETAILER_DISTRIBUTOR_ID`

## Inventory Tab

- Inventory groups are matched to ingredient pricing organization, but inventory display is cabinet-based:
  - `Mixer Cabinet`
  - `Liquor Cabinet`
  - `Other`
- `On Hand` is editable.
- `Par` is intended to be visually distinct and less frequently edited.
- Negative reorder values should display as `0`.
- `Need to Order` updates automatically from `On Hand` vs `Par`.
- Mixer cabinet reorder values are rounded up to cases of `12`.
- Liquor reorder values stay bottle-based.
- Totals were added for:
  - current inventory dollar amount
  - reorder totals
  - vendor-specific reorder totals
- `Non Alcoholic Beer` belongs in `Other` inventory and reorder views, but should not count in beverage inventory dollar totals.
- `Sweet and Sour` should not populate `Need to Order`.
- Weekly inventory snapshots can be saved, recalled, resubmitted, timestamped, and deleted from browser storage.

## Inventory Display Order

### Mixer Cabinet order

1. `Blue Rasp Powder`
2. `Bitters`
3. `Lemon Juice`
4. `Raspberry Schnapps`
5. `Pomegranate Schnapps`
6. `Strawberry Schnapps`
7. `Triple Sec`
8. `Peach Schnapps`
9. `Blueberry Schnapps`
10. `Lime Juice`
11. `Watermelon Schnapps`
12. `Apple Schnapps`
13. `Creme de Cacao`
14. `Kahlua`
15. `Cold Brew`
16. `Sweet and Sour`

### Liquor Cabinet order

1. `Bulleit`
2. `Crown Royal`
3. `Svedka Blue Raspberry Vodka`
4. `Jose Cuervo Silver`
5. `Tito's`
6. `Ketel One Cucumber Vodka`
7. `Absolut Citron`
8. `Crown Apple`
9. `Captain Morgan`
10. `Bombay Sapphire`
11. `Jack Daniel's`

## Keg Levels

- Keg Levels is part of the regular dashboard now, not a separate app.
- Template CSV exists at `public/data/keg-levels-template.csv`.
- Keg levels now support:
  - `Current level`
  - editable `On hand kegs`
  - editable `Par kegs`
  - computed `Need`
  - `Refresh keg levels`
  - `Send config update`
- Layout was changed to vertical/stacked walls for easier smaller-screen use.
- Data routes:
  - `app/api/keg-levels/route.js`
  - `app/api/keg-config-update/route.js`
- PMB env values expected locally:
  - `PMB_API_BASE_URL`
  - `PMB_API_USERNAME`
  - `PMB_API_PASSWORD`
  - `PMB_API_CLIENT_ID`
  - `PMB_API_CLIENT_NAME`
  - keg device and line identities are auto-discovered from authenticated tap configuration
- Keg pricing notes:
  - beer style/type labels were removed from display/search because they were inaccurate
  - `Summer Ale` default keg pricing is set to 1/2 bbl / 1984 oz and `$185`

## Current Keg Matching Caveat

- PMB line/product matching is tricky.
- Matching logic was improved with alias handling and device-level mapping, but keg percentages may still need spot-checking tap by tap.
- Known examples that needed attention before:
  - `Goose IPA`
  - `Hennessy (Cognac) 3`
  - `Gin & Juice`

## Local Dev Notes

- Important recurring Next.js issue: stale `.next` chunks can cause:
  - `Cannot find module './331.js'`
  - `Cannot find module './833.js'`
  - `__webpack_modules__[moduleId] is not a function`
- Reliable fix on Mac:

```bash
lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill
rm -rf .next
npm run dev
```

- Reliable fix on Windows:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm.cmd run dev
```

- Build check before push:

```bash
npm run build
```

```powershell
npm.cmd run build
```

## Useful Commands

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd run provi:session
npm.cmd run provi:capture
npm.cmd run provi:extract
```

## Transfer Notes For New Computer

- Copy the repo folder.
- Copy `.env.local` manually and do not commit it.
- Reinstall dependencies with `npm install`.
- Start with `npm.cmd run dev` on Windows or `npm run dev` on Mac.
- If using Vercel-only vendor sync, make sure the same env vars are set in Vercel.
- If using local Provi/PMB testing, the new machine will need:
  - local env values
  - network access to the PMB local IP
  - fresh local login/session capture if browser session files are part of the flow

## New Mac PMB Connectivity Check - 2026-06-19

- New always-on Mac local IP observed as `192.168.10.93`.
- PMB / TTG server at `http://192.168.10.128:8585` is reachable from this Mac.
- `/api/authtoken` returned `AUTH_OK` with a 62-character token for client id `910423`.
- `/api/productlist` worked with the generated bearer token and returned `103` products.
- `/api/getkeglevels` worked for device `66952915841408`, line `1`.
- `.env.local` was created locally and is ignored by Git.
- Still needed on this Mac for normal operation:
  - install Node.js LTS so `npm run dev` and `npm run build` work outside Codex
  - install Apple Command Line Tools / Git so repo status and commits work
  - install and configure `cloudflared` as a persistent service for the Cloudflare tunnel
  - get the Cloudflare tunnel token or named-tunnel credentials/hostname before making it always-on

## Cloudflare Tunnel - 2026-06-19

- Cloudflare domain: `onparbev.com`.
- Named tunnel: `onparbev-dashboard`.
- Tunnel id: `35a2d83d-aa45-4ad0-a1ad-b0735a66fa63`.
- DNS routes created:
  - `onparbev.com`
  - `www.onparbev.com`
- Public dashboard verified at `https://onparbev.com`.
- Public keg API verified at `https://onparbev.com/api/keg-levels`.
- Tunnel routes to the dashboard app on `http://localhost:3000`; it does not expose the PMB server directly.
- macOS LaunchAgents installed:
  - `~/Library/LaunchAgents/com.onpar.beverage-dashboard.plist`
  - `~/Library/LaunchAgents/com.onpar.cloudflared.plist`
- Runtime service folder is `/Users/onpar/OnParBeverageRecipes-service` because macOS blocked launchd from executing reliably out of Desktop.
- Service logs live in `/Users/onpar/OnParBeverageRecipes-service/logs`.
- The Cloudflare cert and tunnel credentials are in `~/.cloudflared` and must stay secret.

## PMB Product Add Form - 2026-06-26

- Added a Pour My Beer product form to the `Add Recipe` tab.
- Route: `app/api/pmb-products/route.js`.
- The form supports:
  - cocktail products
  - beer keg products
  - charge per ounce
  - serving ounces
  - brewery / maker, style, ABV, IBU, notes
  - keg ounces and keg cost fields for beer keg entry
- Beer keg submissions also save a local custom keg-pricing item in browser storage so the keg can appear in the dashboard Pricing tab with its keg ounces / keg cost.
- Add Recipe now has a dedicated Beer Product section.
- Beer Product entry now only requires beer name and keg cost.
- The dashboard generates:
  - PMB charge per ounce from keg cost using standard 15.5 gal / 1984 oz and default 82% beer target margin
  - 16 oz serving
  - 1984 oz keg size
  - style / brewery when obvious from the name
  - description
  - picture
- New recipes and beer products auto-fill a generated description and default seeded picture.
- Shuffle buttons generate a different seeded picture URL.
- Beer product descriptions/images now come from internet lookup via `app/api/beer-lookup/route.js`.
- Beer lookup searches web results for the product, extracts usable page metadata/body text, rejects obvious shopping/copyright/script snippets, and returns source URLs.
- Beer lookup decodes HTML punctuation/entities such as `&rsquo;`, `&trade;`, numeric apostrophes, en/em dashes, and nested `&amp;...;` values.
- Beer lookup normalizes selected internet images to PMB-friendly `676x540` JPEG data URLs using `sharp`; tested Garage Beer output was under 5MB.
- Add Beer Product preview now uses the same `676/540` aspect ratio and shows the full normalized image with `object-fit: contain`, so the user can see the final crop before sending.
- Beer image shuffle cycles through alternate internet lookup results, not generated art.
- PMB product sends do not include the image data URL because PMB product write endpoint does not accept image blobs; the image is saved locally for Coming Soon/dashboard display.
- Dashboard PMB send parses non-JSON responses defensively so HTML restart/login pages show a readable error instead of `Unexpected token '<'`.
- Beer product Coming Soon cards include a margin field and Update PMB Pricing button for products with a PMB PLU.
- New beer products and new custom recipes are saved into a Coming Soon section at the bottom of Keg Levels.
- Coming Soon replace action locally marks a selected tap as replaced and updates the Keg Levels display; exact TTG tap-line assignment still needs a PMB endpoint if we want it to physically change the wall assignment.
- PMB `productlist` does not expose image/photo fields; the selected image is kept in dashboard data for now, but PMB image upload needs the exact TTG image endpoint if we want it synced into PMB screens.
- PMB field conversions used:
  - `price_per_unit` = charge per ounce in cents
  - `units_per_serving` = serving ounces x 100 in PMB API records
  - `abv` = ABV percent x 100
  - beer product type = `1`
  - cocktail product type = `3`
- The route fetches the current product list to generate an unused PLU, then saves through the TTG Product Database management form.
- Verified:
  - production build passes
  - service copy was rebuilt and restarted
  - `https://onparbev.com/` responds through Cloudflare
  - authenticated local `/api/pmb-products` validation path returns the expected error for an empty product

## Provi Session Refresh - 2026-06-19

- Fresh Provi browser session saved under `~/.FoodOrderAgent/provi`.
- Active retailer context captured as `402312`.
- `.env.local` was updated with `PROVI_COOKIE_HEADER` and `PROVI_RETAILER_CONTEXT` in both:
  - Desktop working copy
  - `/Users/onpar/OnParBeverageRecipes-service`
- Always-on dashboard LaunchAgent was restarted after env update.
- Public `https://onparbev.com/api/vendor-sync` verified for:
  - `Provi` scope
  - `OHLQ` scope

## Recent Fixes - 2026-06-19

- Beer keg pricing sync now only accepts standard 15.5 gal / 1984 oz keg packages by default.
- Summer Ale is not allowed to map to the available 1/6 bbl Provi item because On Par only uses 15.5 gal kegs for that beer.
- Stella Artois is the special keg-size exception:
  - expected size is 50 L / about 1690.7 oz
  - Provi price verified at `$170`
- Related commits pushed:
  - `ed62fe5` - require standard half-barrel beer keg pricing
  - `fa76674` - handle Stella 50L keg pricing exception

## Keg Levels Recovery - 2026-06-19

- Symptom: public `Keg Levels` tab stayed broken / stuck while PMB API was reachable.
- Root causes found:
  - `public/dashboard.js` called `isRoughlyEqual()` in browser code, but the helper only existed in the server vendor-sync route.
  - The always-on service copy at `/Users/onpar/OnParBeverageRecipes-service` was missing its `.next` production build, causing Cloudflare 502s until rebuilt.
  - Cloudflare was serving `/dashboard.js` with a 4-hour browser cache header, so an already-open browser tab could keep the old broken script.
- Fixes applied:
  - Added `isRoughlyEqual()` to `public/dashboard.js`.
  - Rebuilt the Desktop repo and service copy with `npm run build`.
  - Restarted `com.onpar.beverage-dashboard`.
  - Added `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` for `/dashboard.js` in `next.config.mjs`.
  - Restarted both `com.onpar.beverage-dashboard` and `com.onpar.cloudflared`.
- Verification after fix:
  - `https://onparbev.com/dashboard.js` returns `cf-cache-status: BYPASS`.
  - `https://onparbev.com/api/keg-levels` returns `103` live PMB products.
  - Browser automation opened `https://onparbev.com`, clicked `Keg Levels`, found `3` wall cards, and showed `Found live levels for 103 products`.
- Related commits pushed:
  - `92a5ef6` - restore dashboard keg tab helper
  - `f296b0f` - bypass Cloudflare cache for dashboard script

## Always-On Service Recovery Commands - Mac

```bash
cd /Users/onpar/OnParBeverageRecipes-service
PATH=/Users/onpar/OnParBeverageRecipes-service/.tools/node/bin:$PATH npm run build
launchctl kickstart -k gui/$(id -u)/com.onpar.beverage-dashboard
launchctl kickstart -k gui/$(id -u)/com.onpar.cloudflared
curl -sS https://onparbev.com/api/keg-levels | head -c 500
curl -I 'https://onparbev.com/dashboard.js?v=check'
```

## Add Beer Product Creative Controls - 2026-06-26

- Split the Add Recipe beer product shuffle control into two buttons:
  - `Shuffle image` only advances the normalized 676x540 preview image.
  - `Shuffle description` only advances the internet-sourced notes text.
- The first internet lookup still fills both fields together so a new beer starts with a complete suggestion.

## PMB Product Add 502 Follow-Up - 2026-06-26

- PMB auth and product list are reachable from the always-on Mac at `http://192.168.10.128:8585`.
- An attempted JSON-write fix was replaced after deeper testing showed TTG product creation is handled by the Digest-authenticated management form.
- Rebuilt and restarted the always-on dashboard service after deploying the PMB product route fix.
- Follow-up investigation found TTG Server `1.48.22.2` does not expose a reliable JSON product-add endpoint for this task.
- Product creation now uses the real TTG Product Database management form at `/pages/products` with Digest auth and TTG field names (`fd_name`, `fd_price_per_unit`, `fd_units_per_serving`, `submit_saveadd_product`, etc.).
- The dashboard verifies success by reading `/api/productlist` afterward and finding the saved PLU before reporting success.
- Duplicate product names now return the existing PMB product instead of trying to create another copy and falling into a 502.
- Removed the old guessed JSON write fallback paths so failures report the actual TTG form-save problem.
- Fixed future PMB product objects to use TTG's stored `units_per_serving` scale of serving ounces x 100.
- Final root cause for new-product 502:
  - TTG's add-product form requires `multipart/form-data`, not URL-encoded form data.
  - TTG also requires the `ttgsrv_sess` cookie from the initial `submit_add_product` request to be preserved into the `submit_saveadd_product` request.
  - The save request must take a fresh Digest auth challenge; reusing/preempting the previous challenge can produce `socket hang up`.
- Verified dashboard route success:
  - `/api/pmb-products` created `Codex Dashboard Test Beer 20260626 2`
  - PMB PLU `54185`
  - price per oz cents `38`
  - serving scale `1600`
  - config update path `/api/configupdate`
- Diagnostic PMB test products currently present and not assigned to taps:
  - `Codex UI Test Beer 20260626 1` PLU `74105`
  - `Codex Curl Test Beer 20260626 1` PLU `74106`
  - `Codex Node Fresh Digest Beer 20260626 1` PLU `74107`
  - `Codex Dashboard Test Beer 20260626 2` PLU `54185`

## Live Wall Safety Pause - 2026-06-26

- Smoke testing paused while guests are using the Pour My Beer tap walls.
- Do not run dashboard UI smoke tests that click product creation, product replacement, manual keg level changes, or config update controls until the user says the wall is safe to test.
- Do not call `/api/keg-config-update`, PMB `/api/configupdate`, or PMB `/m2m/api/configupdate` during business use unless the user explicitly approves that specific live-wall update.
- PMB product creation/update must not automatically send config updates. It should only send one when the request explicitly includes `sendConfigUpdate: true`.
- Tap replacement actions in the Keg Levels tab should save the dashboard replacement mapping only; the visible `Send config update` button is the manual live-wall push.
- A cocktail product was created before this pause:
  - `Codex Cocktail Recipe Test 20260626 02889` PLU `85138`
  - image upload verified at 676x540
  - a config update was sent during that pre-pause test

## Keg Level Adjustment Work - 2026-06-26

- Reverted Keg Levels display to use the exact PMB product/slot level returned by `/api/keg-levels`; removed the local manual percentage override as a display source.
- Fixed the extra dashboard-side device/line reordering layer that made Budweiser show the wrong percent. Budweiser PLU `112145` now displays the PMB read value (`95.5%` from device `66952915836764`, line `2`) instead of the mismatched `67.4%`.
- Added a per-tap adjustment UI:
  - `Oz +/-`
  - `Target %`
  - `Push`
  - typing `-1 oz` for Budweiser recalculates the target from `95.5%` to `95.4%` without writing to PMB.
- Added `/api/keg-level-adjust` to resolve a tap by PLU/device/line, calculate ounces/percent, call PMB `setkeglevels`, and only then attempt targeted config update for that device.
- Live Budweiser test result:
  - `/api/setkeglevels` returned `401 HTTP 401 - Not Authorized`
  - `/m2m/api/setkeglevels` returned socket/fetch failure
  - both generated and static `PMB_AUTHTOKEN` attempts were rejected
  - no config update was sent because the route stops before config update unless PMB accepts the one-line keg-level write.
- Product replacement dropdown on each Keg Levels row now includes PMB beverages, wall-list beverages, and Coming Soon items; read-only browser check showed `218` options and enabled buttons after live sync.

## Keg Level Adjustment Follow-Up - 2026-06-26

- Reworked the manual keg-level controls so inputs no longer sit inside the narrow `Current level` table cell.
- Each row now shows only the live PMB level plus an `Adjust` button.
- Clicking `Adjust` opens a full-width row-level panel with:
  - current ounces / full keg ounces
  - PMB PLU, device id, and line number
  - `Ounces +/-`
  - `Target %`
  - `Push to tap`
  - `Close`
- Browser layout check on Budweiser:
  - current level displayed: `95.5%`
  - target percent defaulted to `95.5`
  - panel width: `1150px`
  - all controls were on the same row at `40px` height
- Expanded PMB 401 audit for Budweiser PLU `112145`:
  - generated authtoken + `/api/setkeglevels` => `401`
  - generated authtoken + `/m2m/api/setkeglevels` => socket/fetch failure
  - configured `PMB_AUTHTOKEN` + `/api/setkeglevels` => socket/fetch failure
  - configured `PMB_AUTHTOKEN` + `/m2m/api/setkeglevels` => `401`
  - token-in-body variants also failed
  - no config update was sent because `setkeglevels` never succeeded
  - PMB level verification afterward stayed unchanged: raw `9549`, display `95.5%`, keg size `1984 oz`
- Current blocker is PMB/TTG authorization for the private keg-level write endpoint. Reads work, product writes work through TTG management forms, but keg-level writes are rejected by TTG for this API client/token.

## PMB Tap Product Replacement - 2026-06-26

- Keg Levels `Change product` no longer only writes a local replacement marker.
- Added `/api/pmb-tap-product`:
  - reads TTG `/pages/tapconfig` via Digest auth
  - resolves the real tap row by tap number
  - for Budweiser/Main tap 42, resolves device `66952915836764`, line `1`, PLU `112145`
  - overwrites the resolved tap PLU with the replacement product through the existing `/api/pmb-products` management-form writer
  - sends only that device's TTG `/pages/tapconfig` `fd_do_sendconfigupdate` action after product save
- Added `matchByPluOnly` to `/api/pmb-products` so tap replacement updates the tap's PLU even if another PMB product already has the same replacement name.
- Dashboard now waits for PMB success before saving `tapReplacementOverrides`; failed PMB writes should no longer show as replaced locally.
- Dry-run verification only, no live wall write:
  - local service `http://127.0.0.1:3000/api/pmb-tap-product` returned `200`
  - public Cloudflare URL `https://onparbev.com/api/pmb-tap-product` returned `200`
  - dry-run target: replace Budweiser tap 42 with Garage Beer
  - planned PMB product update: PLU `112145`, name `Garage Beer 1`, price `$0.38/oz`
- Rebuilt and restarted `com.onpar.beverage-dashboard`; Cloudflare tunnel `com.onpar.cloudflared` stayed running.

## Weekly Usage Product Changeovers - 2026-07-06

- Added `public/data/weekly-usage-changeovers.csv` as the source of truth for historical tap product changes that cannot be inferred from a renamed weekly usage row.
- Seeded tap `1`: `Bombay Sapphire` -> `Hennessy Cognac 3`, effective `2026-01-08`, with the change week assigned to the current product.
- Dashboard startup and PMB weekly sync now split matching current-product history by changeover date:
  - active Hennessy keeps week `1/5/26 - 1/11/26` and later
  - pre-change weeks move into hidden `Replaced product history` as Bombay Sapphire
- Browser validation on the always-on service showed:
  - Hennessy active history: `20` weeks, oldest `1/5/26 -1/11/26`, no pre-change weeks
  - Bombay hidden archive: `7` weeks, newest `12/22/25-12/28/25`, no current Hennessy weeks

## Weekly Usage Search Cleanup - 2026-07-06

- Removed the manual `Save this week` button and the live/`This week` entry column from Weekly Usage; PMB report pull is now the visible update path.
- Weekly Usage search now includes hidden replaced-product histories only while searching.
- Search matching now token-matches normalized names, so searches like `Jose Gold 2` can find `Jose Cuervo Gold Tequila 2`.
- Browser validation:
  - no `Save this week` button
  - no `.weekly-usage-input` fields
  - `Jose Gold 2` found the Jose Gold row
  - `Bombay` found the archived Bombay Sapphire row marked as replaced by Hennessy

## Keg Par Agent Formula Fix - 2026-08-10

- Beer recommendations now trigger only when current live-plus-backup stock is below average weekly usage plus `0.5` keg; the order quantity fills the gap up to the existing per-tap cap.
- Karaoke cocktail recommendations continue to use average weekly usage plus `0.25` keg.
- Patio taps `1-20` and Karaoke taps `83-92` now order when live keg ounces are below average weekly ounces plus `100` ounces. Backup counts do not affect this liquor rule.
- The Keg Levels par-agent panel and recommendation details now display the applicable formula and ounce-based liquor stock/usage.
- Verification passed: `112` automated tests, browser-script syntax check, diff check, and the optimized Next.js production build.
- Follow-up fixed browser/server tap-key drift for apostrophes and ampersands (`Tito's` was saved as `tito-s` but previously read as `titos`), which caused positive backup counts on Vodka Cran and Spiked Pink Lemonade to be ignored.
- The par agent now uses the exact shared averages displayed on Weekly Usage for all `102` taps instead of independently recalculating a six-week PMB average. Blue Dot 1 now uses `0.214` internally and displays `0.21`.
- Removed the obsolete par-agent PMB transaction calls; PMB supplies live levels while shared Weekly Usage supplies averages.
- Restored the missing Node filesystem/path imports required to load the keg tap template at runtime.
- Read-only live dry-run verification found `0` average mismatches and `0` positive on-hand mismatches across `102` taps. The full `116`-test suite and optimized production build pass.
- Keg Levels now includes a confirmed `Clear all on hand` action. It writes explicit zero overrides for every tap so the par agent sees a complete inventory state, while zero values render as blank inputs for fast entry.
- On-hand fields use numeric text entry instead of browser number spinners, select their contents on focus/click, strip accidental leading zeroes, and move vertically with Arrow Up/Arrow Down.
- On-hand edits save locally while typing and sync after leaving the field through a serialized, version-aware queue. This removes per-keystroke network waits and prevents older responses from overwriting newer entries.
- Added focused tests for blank-zero display, normalization, arrow navigation, and clear-all state generation. The full suite now contains `120` tests.
- Tap-change reconciliation now compares every saved On Deck selection with the current PMB product after a Keg Levels refresh. Matching PLUs or normalized names (including `Voodoo Ranger IPA`, `Voodoo Ranger Regular IPA`, `NB VD RGR IPA`, and wall-number suffixes) clear the On Deck assignment and archive the installed Coming Soon item.
- Successful in-dashboard tap changes clear the matching On Deck assignment immediately, and every visible On Deck label now has a direct `Remove` control for manual cleanup.
- Live read-only verification reproduced tap 42 showing PMB current `Voodoo Ranger IPA 1` while also retaining `On deck: Voodoo Ranger IPA`; the new matcher covers that exact state. The suite now contains `121` tests.
- Guinness is now a canonical `13.2`-gallon / `1,689.6`-ounce keg with a default keg price of `$185` (about `$0.1095/oz`). The known size overrides PMB's generic half-barrel size in Keg Levels, line-value calculations, Weekly Usage conversions, and the par agent.
- The keg-pricing catalog now replaces stale template products with the current PMB beer product on each physical beer tap, so installed products such as Guinness appear even when they are absent from the CSV tap template.
- Old saved/shared Guinness size values are normalized to `1,689.6` ounces while preserving any explicit updated keg price; bundled defaults migrate to the corrected `$185` record. Focused pricing and par-agent coverage brings the suite to `125` tests.

## On Par Tee / PMB Pricing Refresh - 2026-08-10

- On Par Tee now uses `2.5` gallons / `320` ounces of lemonade in both recipe CSV sources. At the existing lemonade rate, that ingredient costs `$7.23`.
- Recalculated On Par Tee totals: `1,452` ounces and `$532.84` batch cost. The canonical keg-yield lookup and saved-recipe repair path now use the same values, including migration from the older 2- and 3-gallon lemonade formulas.
- Recalculated all dependent On Par Tee pricing fields in both source files: `$0.37/oz`, `5.26 oz` pour, and the applicable profit, margin, and charge-per-pour figures for each file's charge rate.
- Reproduced Tap Pricing on `https://onparbev.com`; the PMB refresh succeeded on the next live attempt, confirming the reported HTML `520` was intermittent rather than a persistent login failure.
- Tap Pricing now retries transient Cloudflare/PMB gateway statuses once automatically, gives a correct gateway message if both attempts fail, and does not retry login errors.
- The tap-pricing API is explicitly pinned to the Node runtime, direct PMB API calls have a 15-second bound, and the optional management-page tap lookup has a shorter 6-second-per-request bound so it cannot hold the whole pricing refresh indefinitely.
- Verification passed: `128` automated tests, diff check, and optimized Next.js production build.

## Current Keg Cost Catalog / Missing Ingredient Prices - 2026-08-10

- Live dashboard verification confirmed Kahlua and Ketel One Cucumber Vodka were mapped to OHLQ and had saved 1L prices of `$27.26` and `$28.20`, but those values were not bundled defaults and the Ketel spelling alias could prevent the override from attaching to its recipe ingredient.
- Added those two OHLQ bottle prices as reliable defaults and normalized recipe ingredient identities before building the pricing catalog, so `Kettle One` source spelling resolves to the canonical `Ketel One Cucumber Vodka` price row.
- Reproduced the stale beer issue: Keg Costs showed `Breakfast Stout` on Main tap `39`, while the verified Keg Levels response showed `Guinness Draught` physically installed there.
- Tap Pricing API rows now disclose whether the tap assignment came from verified PMB tap configuration or the old template fallback.
- Keg Costs now uses verified live Keg Levels first, verified Tap Pricing assignments second, and the static template only before live data is available. Template-only products such as Breakfast Stout disappear once the current wall loads.
- Assigned On Deck beers are included in Keg Costs with an `On Deck for <wall> <tap>` source label; unassigned historical custom beers no longer keep cluttering the vendor lists.
- Opening Ingredient & Keg Costs now also loads verified Keg Levels so the catalog can replace stale template products without requiring a separate Keg Levels visit.
- Verification passed: `132` automated tests, JavaScript syntax checks, diff check, and optimized Next.js production build.

## Global Dashboard Search - 2026-08-12

- Added an owner-dashboard global search dialog in the header, available by button or `Command/Ctrl + K`.
- The search index covers dashboard sections, active and old recipes, recipe ingredients, ingredient and beer-keg costs, inventory, physical taps, and current/archived Weekly Usage products.
- Search normalizes punctuation and apostrophes, requires all query words, ranks direct title matches first, and supports keyboard arrow/Enter navigation.
- Choosing a result opens the correct main/operations tab, applies the existing section search when appropriate, scrolls to the exact row/card, and briefly highlights it.
- Added focused search-ranking tests. Full verification passed: `238` automated tests, lint with zero warnings, diff check, and the optimized Next.js production build.

## On Par Performance & Comparable Weekly Movement - 2026-08-12

- Replaced the general beverage-news panel with an On Par performance view and a silent, change-only Ohio compliance watch sourced from official Ohio pages.
- Top 5 and Bottom 3 rankings use saved PMB poured ounces (not GoTab), with filters for beverage type, physical wall, 1 week / 6 weeks / all saved weeks, and poured volume / estimated profit at today's verified economics.
- The same beverage remains a separate row on each physical wall so wider distribution does not inflate its rank. Historical rows without a verifiable wall and beverage type are excluded and counted rather than guessed.
- Estimated profit requires exact PMB tap + PLU identity, current verified price, and mapped cost. Liquor stays unavailable unless both PMB portion quantities resolve to the same price per ounce; historical realized profit is never implied.
- Tap-pricing refresh no longer reconciles Weekly Usage, because pricing responses are product-centric and can represent one PLU on multiple physical walls. Weekly Usage reconciliation remains tied to the complete physical-tap PMB report.
- Weekly Movement now compares only taps with valid PMB poured ounces in both consecutive weeks. Excluded taps are listed with tap number, product, and reason; taps with current data but no prior or older PMB history are identified as likely new/newly assigned. Missing readings are never treated as zero.

## Cocktail Label Prep Handoff - 2026-08-14

- Cocktail prep rows now preserve their wall suffix instead of merging matching Main and Karaoke batches. For example, Blue Dot is handed off as separate `Blue Dot 1` and `Blue Dot 2` labels while retaining the same recipe-yield mapping.
- Manager and staff prep lists show only label-ready details: product label, wall, recipe batch ounces, and label count. Blue Dot displays `Main wall · 1,508 oz` or `Karaoke wall · 1,508 oz`.
- Existing locked Monday snapshots are upgraded in memory without changing their total prep quantities. Legacy combined completion records carry forward to both split wall labels and migrate safely when edited.
- Redundant beer-keg, liquor-bottle, and mixer type text was removed from vendor and delivery rows; the internal line types remain intact for ordering IDs, units, exports, and receipt mappings.

## Monday Plan, Kahlua, and Prepared Ingredient Pricing - 2026-08-14

- Weekly Plan now has one `Lock Monday Plan` action. The CSV export and print controls, their readiness note, and the unused CSV-generation code were removed.
- Kahlua is mapped to the live OHLQ/Provi identity `Kahlúa`, 1 L, SKU `0893L`. Provi omits the line-level distributor name for this item, so OHLQ matching now safely accepts its exact distributor ID (`16114`) and normalizes the accented product name.
- Live owner-dashboard verification synced Kahlua at `$27.26` and stamped the row with the current sync time.
- Cold Brew Coffee is priced as a purchased 32 oz concentrate bottle. Two bottles plus 2.5 gallons of water make the 384 oz recipe batch; the prior `$51.67` batch default migrates to `$25.835` per bottle without changing batch cost.
- Blue Dot Juice is priced as one six-packet Starburst box per gallon of water. The 1,152 oz recipe line now displays `9 Starburst boxes (54 packets) + 9 gallons water`, costs nine box prices, and drops the old zero-ounce duplicate formula note.
- Both prepared ingredients show a fixed package/yield description and only an editable package-price field. Their recipe calculations still use the finished diluted yield, with water at no cost.
- Verification passed: `412` automated tests, zero-warning lint, optimized production build, and live browser checks for Weekly Plan controls, prepared-ingredient rows/recipe amounts, and Kahlua OHLQ sync.

## Triple Jam / Truly Mapping and Pricing Label Cleanup - 2026-08-14

- Removed the redundant `Provi`, `via Provi`, `OHLQ`, and `Proof` identifier badges from ingredient and keg pricing rows and their inline editors. Distributor names remain where they are operationally useful.
- Triple Jam now maps directly to Provi's `Blake's Hard Cider Triple Jam`, Heidelberg SKU `41189`, 15.5-gallon keg, `$189`.
- Truly Wild Berry now maps directly to Provi's `TRULY Hard Seltzer Wild Berry`, Heidelberg SKU `42517`, half-barrel keg, `$182`.
- The prior failures were product-name matching gaps, not absent Provi products. Live dashboard verification synced both rows and increased the successful automatic price count from 49 to 51.
- Verification passed: `414` automated tests, zero-warning lint, optimized production build, diff check, and live browser validation of both synced keg-price rows.

## Active Keg Pricing Scope and Guinness Recovery - 2026-08-14

- Keg Pricing now includes only products on the current physical beer walls plus active beer products in Coming Soon or assigned On Deck; the stale static tap template is no longer used as a pricing-list fallback.
- Current products are assembled per physical tap from saved active Weekly Usage assignments, then upgraded by verified Tap Pricing and live Keg Levels when those feeds are available. A partial PMB keg-level response can no longer drop an active tap from pricing.
- This repaired Main tap `39`: `Guinness Draught` now appears with its canonical `1,689.6` ounces and `$185` keg price, while the obsolete `Breakfast Stout` row is removed.
- Live browser validation covered all `36` physical beer taps as `26` distinct current products, including all Main taps `21-46` and Karaoke taps `73-82`.
- Verification passed: `416` automated tests, zero-warning lint, optimized production build, diff check, and live browser validation.

## Inventory Editing, Bottle Mapping, and Monday Snapshot Workflow - 2026-08-14

- Inventory rows now show one calm `Edit` action. Reordering controls, custom-item maintenance, price lookup, and par editing appear only while that row is being edited; on-hand counting remains directly available.
- The retired Bubbly section is omitted from current inventory. The custom Korbel Brut row remains in Other and is mapped to Proof/Provi for automatic pricing.
- Captain Morgan, Buffalo Trace, Jim Beam, and Maker's Mark are mapped to their OHLQ bottle products. Custom cabinet items now inherit canonical vendor mappings and participate in automatic price sync.
- Weekly Plan inventory orders are calculated from the saved snapshot for the current Monday, not later live counts or keg levels. Locking a plan is blocked until that Monday snapshot exists.
- A successful Monday snapshot preserves the saved count and pars, then clears only the current on-hand fields. Restoring the snapshot repopulates those fields so a corrected snapshot can be saved again.
- Verification passed: `421` automated tests, zero-warning lint, optimized production build, and a local production-browser check confirming no Bubbly section, one Korbel row, hidden reorder arrows, and row-scoped par editing.

## Dashboard Audit - 2026-09-06

- Completed the requested review of the live owner dashboard, administrator-access Staff View, local source, integration wiring, and usability. Findings, per-area scores, evidence, and a prioritized improvement plan are in `docs/dashboard-audit-2026-09-06.md`.
- Overall editorial assessment: 6.8/10. Highest-priority findings include partial Karaoke PMB coverage, ambiguous zero/uncounted inventory, mixed KPI scopes, overlapping historical report intervals, disconnected search/vendor controls, and incomplete receipt/prep inventory reconciliation.
- Validation passed: 673 tests, zero-warning lint, optimized build. Available shell was Node 26.3.0; production Node 22 validation remains a release prerequisite. Phone viewport override did not apply, so mobile findings remain provisional pending device verification.
- Audit only: no implementation or deployment performed; existing user changes in `public/dashboard.js` and `tests/dashboard-information-architecture.test.mjs` preserved. No orders, PMB writes, counts, or staff checkoffs were submitted. Normal live navigation can trigger built-in refreshes.

## Chrome Web Store Setup - 2026-09-15

- User requested hands-on Google developer setup for the cart builder extension. Followed the existing private-distribution plan.
- Prepared and archive-verified `release-artifacts/On-Par-Vendor-Cart-Builder-1.2.11.zip` with only nine manifest/runtime/icon files; kept 1.2.3 archive intact.
- Updated release guide and README to match actual local-storage retention. Added `docs/vendor-cart-builder-privacy-policy.md` as an unpublished draft.
- Validation: 27 focused cart tests passed, all four JavaScript syntax checks passed, and edited tracked documentation passed diff whitespace checks. No extension runtime changes, vendor transactions, deployment, or upload performed.
- Assistance required: developer console redirects samantha@onparbar.com to Google passkey re-verification. Kept Chrome tab 107953086 open for user sign-in. Account registration/payment status cannot yet be verified. Store imagery, hosted privacy policy, reviewer access, and private distribution remain pending.
- Lesson: background.js uses chrome.storage.local, removes pending state on completion, and cleans records older than 12 hours on worker startup; do not describe this as session-only storage or an exact 12-hour deletion timer.

### Chrome developer registration follow-up — 2026-09-15

- Google confirmed registration complete after user sign-in. Dashboard welcome completed; now blocked at mandatory trader/non-trader declaration. Asked for confirmation to declare trader because this is an On Par business tool; no declaration submitted yet.
- Created and visually checked `release-artifacts/store-assets/promo-440x280.png` with editable SVG source.
- Production build and lint passed. Initial concurrent lint collided with generated build files; reran after build and it passed. Full suite: 1,060 passed / 20 failed; focused extension suite: 27 passed. No unrelated fixes attempted.
- Developer tab 107953086 retained for the declaration and subsequent upload.

## Karaoke historical PMB report access — 2026-09-15

- User authorized adding read-only named-report access through the existing Cloudflare dashboard connection, then analyzing former Strawberry Margarita 2, House Margarita 2, and Whiskey Sour 2 performance. Vodka Cran and Espresso Martini remain accepted proposed additions.
- Production is commit b00a07db203bbc66c7a996f2e944d8392d5bcb5d; local workspace has substantial unrelated changes. Isolated production checkout: /tmp/onpar-karaoke-report-20260915. Do not deploy this workspace wholesale.
- Cloudflare routes onparbev.com to the dashboard only. Existing weekly reports retain unnamed retired product IDs. Existing PMB product-management code can open an exact product record read-only; never call save or activation for this analysis.
- Implementing owner-only fixed-route report/catalog inspection and exact-PLU name lookup. Test fixed paths, role boundary, no write handlers, and reject mismatched product identities. Capture actual controller report schema before adding report filters; do not invent backend report fields.
- Pending: production-runtime checks, isolated release, read-back through Cloudflare, named historical product comparison, updated recommendation.

### PMB history connection discovery — 2026-09-15

- The on-site dashboard is the supported bridge through Cloudflare. Owner login to `https://onparbev.com` then GET `/api/pmb-report-history` uses the existing PMB credentials privately on the service Mac.
- Isolated release checkout: `/tmp/onpar-karaoke-report-20260915`; only the new route, helper, and tests were released. Latest scoped commit at this point: `882b187`. Original unrelated workspace changes were not deployed.
- GET `?view=history` reads the observed product aggregate tables `dtb_ppbvm` (monthly poured ounces), `dtb_ppbvw` (weekly), `dtb_ppbvd` (daily), and `dtb_ppbmm` (monthly money). Use each table's own header dates. No customer/card report rows are returned.
- GET `?view=catalog&name=Margarita` reads PMB's actual name filter, omitting the active-only checkbox. Product IDs can be checked using `?view=products&plus=75698`; exact matching returned PLU is mandatory.
- Important PMB trap: `/pages/reporting/export?exp_what=tppb_v&exp_tu=w` returned only ten recent weeks and `exp_tu=m` only six recent months, despite reporting date fields accepting older dates. The HTML monthly table has 13 header months, September 2025–September 2026. Do not equate accepted date fields with export coverage.
- Controller HTML dates are `DD.MM.YYYY`. Read-only report filter POST uses `fd_reporting_date_start`, `fd_reporting_date_end`, `fd_update_reporting`; product search uses `fd_name`, `fd_plu`, `fd_descr`, `submit_apply_filter`. Never send product save, activation, or import fields during analysis.
- Connection errors occur on consecutive management requests; the history helper uses Connection: close and bounded retries. A failed ID lookup does not prove absence from history.

- Final readback: monthly Poured Oz table has 221 product rows, 101 unnamed historical PLUs, and Sept 2025–Sept 2026 header months. Former three Karaoke cocktail names are not retained. Unknown-unit `??` values must not be assumed ounces. Updated recommendation/source saved under output/. August current cocktail identities totaled 3,546.6 oz vs liquor 336.9 oz; modeled current-price contribution $6,782 vs $1,978. Five-liquor target retained; Vodka Cran/Espresso agreed, House/Whiskey Sour/Strawberry provisional trial choices.

### Forward-only product names — September 15, 2026

- Latest user instruction: start gathering from today; avoid introducing errors. Historical backfill/relabeling is out of the active scope.
- Before that steering arrived, 750 separate evidence rows for 119 verified PLUs had been appended to Supabase pmb_data_backup and readback verified. Existing reports, values, and assignments were not changed. 101 old unnamed PLUs remain unidentified.
- Final implementation: best-effort background capture of active Weekly Usage names on authorized reads/successful saves; no scanning archived items, report relabeling, or reporting dependency on the name store. Storage errors are caught and retried on later observations; concurrent/unchanged calls are skipped.
- Prepared commit f38038b in /tmp/onpar-karaoke-report-20260915, rebased on bb97e6c. All 1,096 tests, lint, and build passed. Matching scoped files copied to the main workspace without overwriting other work.
- Automatic approval review rejected an earlier broad integration; scope was reduced. It then blocked publishing the final narrow commit to main for lack of explicit release approval. An asynchronous approval question is pending. Do not push until the user answers it. Verified remote is https://github.com/onparbar/OnParBeverageRecipes.git with ADMIN permission.

### Forward name collection released — September 17, 2026

- User explicitly approved release (“ye”). Rebased the isolated change onto current main a3dcdb0; 1,113 tests, lint, and build passed.
- Released da3a4e835c7f0d4ef0533c36bbc55a159d7e8ed1 through existing Quality checks / Deploy on-site.
- Live readback: /api/weekly-usage-state returned HTTP 200, revision remained 103, and the full existing report data hash was unchanged.
- Supabase verified 102 of 102 current product names under evidenceSource weekly-usage-forward, all observed September 17, 2026. No names missing.
- No old report relabeling or retrospective recovery. Capture remains best-effort/non-blocking, with failed writes retried on future observations. Prior release approval blocker is resolved.

### Cabinet balances and snapshot order archive repair — September 17, 2026

- Restored only 33 Liquor Cabinet / Mixer Cabinet balances from September 14 snapshot through the deployed shared inventory mutation function. Verified 198 liquor units / 203 mixer units, preserving Other inventory and existing delivery receipts. Backup on service Mac: data/inventory-before-cabinet-restore-20260917.json.
- Released display-only commit 6976982365a9ecbec0e42aef254c8c75281709be. Bonbright and Heidelberg now show Received; OHLQ shows Awaiting delivery. All 1,118 tests, lint, build, CI and deployment passed; verified live.
- September 14 snapshot had no archived orders although all three placement records existed. Repaired with deployed archiveWeeklyOrderPlacement using the matching plan generatedAt 2026-09-14T20:36:33.772Z. Original vendor placement times and 4/3/2 order lines retained. Verified unchanged weekly recommendations and live inventory; no weekly plan rerun or duplicate receipt. Backup: data/inventory-before-order-archive-20260917.json on service Mac.

- Released 4c6b2dcf3433fbd18750f8e912fe32dddb8ccb61: Inventory footer no longer becomes a View weekly plan button after publishing; it hides instead. Submit inventory remains for a not-yet-published weekly plan. Full local checks, CI, and deployment passed.

### Weekly Plan tab heading — September 17, 2026

- Removed the redundant Weekly plan heading from the tab, preserving rehearsal labeling and plan actions. Omit the header container when there are no actions to avoid empty space.
- Verification: JavaScript syntax check and 48 relevant dashboard/Weekly Plan tests passed. Local change only.

### Estimated profit dollars and accuracy audit — September 17, 2026

- Restored category dollar amounts beside the percentages in Sales mix by estimated profit. Clarified that percentages are category shares of gross profit and liquor uses an estimated portion mix.
- Fixed multiweek mix calculation: resolve each usable week's rate before summing contributions, preserving duplicate/conflict handling and physical-wall grouping. Previously the first selected entry's rate was applied to all selected ounces.
- Read-only audit of shared Weekly Usage revision 105 found 12 liquor taps with older saved rates overwritten by the latest rate in the Aug 3–Sep 13 view, overstating these contributions by $96.577339. This isolates a saved-rate discrepancy, not a complete verification against actual receipts or historical costs.
- September 12 commit 2050ca6 changed the double serving calculation from 3 oz to 2 oz, another possible cause of increased estimates. Asked the user to confirm actual double serving size; no portion settings changed in this task.
- Full 1,120 tests, zero-warning lint, production build check, and rendered dollar/percentage check passed. Local changes only; no deployment or operational record changes.

### Different fresh-login Weekly Usage warnings — September 17, 2026

- User reports All is Well in her login but a new-product Weekly Usage warning in her boss's fresh login (confirmed fresh page, not an already-open tab).
- Read-only audit: shared Weekly Usage revision 105 contains usable Sept 7–13 readings for all 102 active taps. PsycHOPathy, Whiskey Smash, and Triple Jam have positive readings. No missing-current-week data found.
- Verified production identity 4c6b2dcf3433fbd18750f8e912fe32dddb8ccb61; retrieved that exact source via GitHub. Deployed dashboard-overview and weekly-usage-performance modules match local files. Both shared-report-only and live-assignment-history replay produce no weekly-usage alerts. 54 relevant tests pass.
- Fresh login normally loads shared state before exposing the briefing. A browser's unresolved Weekly Usage recovery outbox can intentionally retain an older local report, and an unavailable shared read can also differ between devices. Neither cause was confirmed on the boss's device. Do not claim a reproduced defect or suppress genuine missing data. Exact warning text/screenshot is needed to identify which path he saw. No application code or shared records changed for this audit.

- Follow-up clarified the warning as approximately 99/102 taps having data. Reproduced that exact warning in a local in-memory simulation by removing only the current readings for taps 42, 70, and 79. The actual shared report yields 102/102 and no warning. This identifies the missing readings represented by that result, but does not establish why the boss's fresh session lacked them. No saved data was removed or changed.

### Fresh-login stale Weekly Usage recovery fixed locally — September 17, 2026

- Continued investigation at user's request. Reproduced two defects with failing executable tests of the actual refresh function: an initial shared read failure made every later refresh return early because initialized was false; a non-conflict pending outbox made all display refreshes return early, with no retry after the login attempt.
- Removed the initialization prerequisite for read-only retries and routed all idle pending outboxes through the existing revision-checked recovery queue. Kept employee/session guards and in-flight edit/revision protection. Added a final shared report recheck after owner login sync before initial briefing completion.
- Added seven regression tests, including a 99/102 to 102/102 coverage replay, failed-read retry, network-failed outbox retry, edit-during-read protection, retry after repeated outage, active-save/employee exclusion, and deduplication of simultaneous reads.
- Full 1,127 tests, zero-warning lint, build:check, and git diff whitespace check passed. These defects can cause device-specific stale reports but the exact trigger on the boss's device remains unconfirmed. No production records changed; fixes remain local pending release alongside the prior header/profit changes.
- User confirmed doubles have always been 2 oz; keep the 2 oz estimate. Old 3 oz calculation was incorrect, not an actual serving-size change.

### Dashboard deep bug audit — September 17, 2026

- User requested a dashboard-wide bug deep dive. Reviewed startup/shared recovery, usage/pricing calculations, inventory mutations, prep API/client feedback, staff resilience, dates, and authorization coverage; walked main owner screens and staff Home/Cocktails/Liquor/Deliveries read-only using the existing admin session.
- Seven additional fixes: remove search's invalid-reading fallback; correct inventory-reality usage helper arguments and PMB case; clear count timestamps for individual/mixed blank edits; use calendar week shifts across DST; expose liquor inventory review as a visible warning on both staff prep panels; clone deduplicated staff Responses; invalidate fallback snapshots before/after writes including uncertain saves and prevent stale in-flight reads repopulating them.
- Added tests/dashboard-audit-regressions.test.mjs (5 tests) and tests/staff-read-recovery-regressions.test.mjs (5 tests). Full 1,137 tests, zero-warning lint, production build check, and whitespace check passed.
- Open HIGH, reproduced in memory: inventory starts at1, prep contribution-2 clamps to0, undo returns2 instead of1. Needs reversible adjustment/shortfall design with partial corrections, receipts, and recounts; not fixed or repaired in production. lib/inventory-store.mjs:680.
- Open MEDIUM, reproduced: all-time ranking accepts historical Aug25–Nov2 as one week and overlapping Nov25–Dec1/Dec1–7 without conflicts. Parser ignores interval end. No historical records changed.
- Live Weekly Run Complete measures count/snapshot/order placement, while staff can still have prep/deliveries remaining; label ambiguity, not proven save failure. Name-only draft claim from older audit is now prevented by recipe-setup validation, so do not repeat that obsolete finding.
- Report: docs/dashboard-audit-2026-09-17.md. All fixes remain local, alongside prior heading/profit/99-of-102 recovery fixes; not committed or deployed. No intentional live mutations. Boss's exact device failure remains unconfirmed.

### Weekly snapshot totals and syrup — September 17, 2026

- Added visible total beverage inventory dollars and next week's simple syrup gallons above saved counts.
- Future snapshots persist syrup ounces/gallons and calculation completeness. Older snapshots estimate from the saved cocktail plan and current recipes with an explicit estimate label; On Deck product substitutions use the planned product's recipe.
- Verified 18 focused tests, scoped zero-warning lint, whitespace checks, and frozen-value/zero/missing/incomplete syrup behavior. Local changes only; not deployed.

### Both remaining audit bugs fixed locally — September 17, 2026

- User authorized fixing inventory undo and historical intervals; then explicitly chose PMB-only usage and removal of CSV-derived history from reporting.
- Inventory now persists current.contributionShortfalls (positive shortage amounts), computes contribution deltas against the signed balance, and clamps only the display. Corrections/undo and consumed-receipt reversal conserve stock through retries and JSON/shared-store round trips. Physical counts clear shortage baselines; deletion/restore clear their applicable metadata. Contribution balanceVersion distinguishes new verified accounting from old records. Legacy negative credits require a newer count instead of guessing lost shortages; a retry does not upgrade old evidence. Recount errors survive checklist recovery and shortage warnings propagate through the durable queue.
- PMB policy: public/pmb-weekly-usage-policy.mjs validates exact Monday–Sunday periods and PMB provenance (legacy unlabelled exact-volume PMB captures retained; explicit CSV rejected). Common usability validation protects client/server demand and analytics. Shared/outbox/local histories are filtered; old averages recomputed. Removed usage-history CSV loading/import functions, preserving unrelated CSV setup/recipe/changeover data. All-time wording now says All saved PMB weeks.
- Read-only replay of /tmp/onpar-profit-usage.json, revision105: 5,722 entries total, 2,641 non-PMB excluded, all3,081 PMB retained with valid date ranges; Sept7–13 coverage remains102/102. No live database cleanup or record rewrite performed.
- Regression coverage: inventory-shortfall-regressions (10 tests), pmb-only-usage-regressions (4), plus durable recovery test extensions. Updated calculation fixtures to explicitly represent PMB records with complete week labels; legacy CSV ranking test now verifies exclusion.
- Final checks: all1,151 tests pass, lint zero warnings, build:check pass, git diff --check pass. Report updated docs/dashboard-audit-2026-09-17.md. Fixes local only, no commit/deploy. Concurrent unrelated snapshot/syrup changes appeared in shared workspace and were preserved.

### Production release verified — September 17, 2026

- Deployed all pending application changes in commit 3078dbdb2e2419062750e657dda0cbfeb64cf44a using an isolated checkout based on latest origin/main, preserving newer production commits and this working tree. Included associated tests/docs/prepared extension assets; generated output exports remain local.
- Combined 1,151 tests, lint, build, storage readiness, GitHub Quality checks 35300033296, and on-site Deploy 35300108960 all passed. Public /api/version confirms the exact release commit.
- Includes snapshot beverage inventory total, syrup gallons/frozen future calculation, prior profit/heading/recovery fixes, PMB-only usage and inventory shortfall accounting. Two-ounce doubles remain in Tap Pricing.
- Post-release public storage check briefly returned 503; after its 30-second cache expired, the fresh check returned ok:true with all seven resources provisioned and reachable. Health remains degraded solely by the previously recorded September 14 par-agent error, also present in deployment smoke output. No credentials or operational records changed during release verification.

### Liquor pricing combined thresholds — September 17, 2026

- Liquor portion price warnings now require both margin below 82% AND gross profit below $8. Reaching either threshold clears the price warning; Single/Double evaluated separately with the existing 2 oz double rule.
- Suggested increases stop at the first threshold reached; updated editor/confirmation copy. Data-quality warnings remain intact.
- 37 focused tests passed, scoped lint passed, whitespace check passed. Local change only; not deployed. Preserved concurrent PMB transaction-window work.

### PMB historical recovery through Cloudflare — September 18, 2026

- User specifically requested the existing Cloudflare connection, and chose PMB's first recorded pours instead of an assumed November 2023 opening date. Used authenticated onparbev.com reporting APIs. No further SSH/native remote access pursued after the earlier automatic approval review rejected accepting an unverified SSH host key.
- Shared Weekly Usage revision106 contains29 distinct PMB weeks, with25 missing weeks between September2025 and September2026. Recovered those25 gaps plus9 earlier summer2025 weeks through the existing daily-import endpoint, using two padded reads filtered by original pour timestamps.
- All238 target daily reports read back correctly from live shared storage:227 matching-overlap days and11 empty-unverified days;233 newly added and5 previously saved. Aggregates contain45,044 recorded pours and422,059.249oz across197 PLUs. These are retained-record totals, not certified complete business usage. No empty date was confirmed as zero.
- None of the recovered product rows has verified historical tap assignment. Preserved current names/taps as suggestions only; did not merge them into current product histories, weekly averages, or profit. Source reports are live in daily-report storage; weekly product-ID aggregates in output/pmb-recovered-weekly-history-2026-09-18.json and explanation in docs/pmb-history-recovery-2026-09-18.md. Historical scan still running; append its final result below.
- Found weekly PMB endpoint lacked original timestamp filtering. Local fix filters both full-week and pre-Thursday transactions before sparse review/grouping, uses explicit Eastern boundaries for requests/zero verification, and fails on unusable timestamps. It prevents out-of-range inclusion; it does not certify PMB completeness or recover omitted pours. Five new regression tests cover boundaries, seconds/milliseconds, DST, Thursday9am, malformed timestamps, and legitimate repeated pours.
- Validation: all1,156 tests pass (loopback-server tests required the normal sandbox escalation); scoped lint, build:check, whitespace check pass. No app deployment, weekly shared-state rewrite, inventory/price/PMB configuration change, or commit performed.
- Lesson: PMB query labels and accepted date parameters are not proof of coverage. Retain original timestamp evidence, unknown empty days, and historical identity uncertainty. Cloudflare origin502 and intermittent PMB401/tap-read errors occurred; bounded retries recovered every targeted missing-day import, preserving saved reports.

### Tap Pricing layout — September 17, 2026

- Added a clear page header/search area and short category target explanations. Converted the dense eight-column suggestions into comparison cards while retaining table headers, existing selectors, editors, confirmation flows, and full current price directory.
- Suggestions show tap/product, status, current price, margin/profit, suggestion and change, with room for the price editor. Expanded directory margin width; responsive two-column comparisons on phones.
- Production build and repository lint passed; focused pricing UI/search/shot tests passed. Rendered sample-data desktop (1280px) and mobile (390px) previews, inspected both with no horizontal overflow. Local only; not deployed.

### Tap Pricing deployment verified — September 17, 2026

- User approved deployment of the layout and combined liquor thresholds. Released only the five pricing-related files from the isolated production checkout; preserved concurrent PMB historical-recovery work locally.
- Live commit 7dd13e5ba2591ef41a04cd286f50534bb4222e4e verified at onparbev.com/api/version. All 1,152 tests, lint, build, storage readiness, GitHub quality run35301263644 and deployment run35301328341 passed. Final public health returned ok:true with all shared resources available; previously reported September14 par-agent error remains.

### Tap Pricing annotation cleanup — September 17, 2026

- Removed repeated gross-profit wording from per-serving figures, retaining metric headings. Single/Double money rows remain on one line, with contained scrolling if necessary.
- Moved the liquor editor from the charge column to the product cell and shortened its label to Edit prices with product-specific accessible names. Suggestion buttons open/focus the matching directory editor.
- Fourteen pricing tests, lint, production build and whitespace checks passed. Sample-data previews at1131px/390px show no page overflow. Local only; not deployed.

- Final source audit:102 overlapping Cloudflare transaction queries cover Oct31,2023–Jul4,2025;101 empty windows and3 records in the last window. Jun28–29 follow-up is empty, as are Jun30–Jul2 daily reports. Earliest returned day is Jul3,2025; this is not a first-ever opening date or a proven limit of all PMB report types.
- CRITICAL reconciliation finding: native PMB monthly poured-volume totals disagree materially with recovered daily records, even for months with every day retrieved. February2026 has12,348.692 recorded daily oz versus121,329.4 readable native monthly oz plus24 unreadable cells. December,March,April,May also disagree. Matching overlapping reads demonstrate repeatability, not completeness. Existing active weekly figures were NOT replaced. Recovery JSON now explicitly sets safeForWeeklyReplacement:false and retains monthly reconciliation evidence; complete weekly backfill remains unresolved.
- User asked specifically about other kinds of reports, especially weekly. Direct weekly exports for Dec1–7,2025 and Nov1–30,2023 accepted date filters but both returned2026W29–W38. Monthly export requestedNov2023 returnedApr–Sep2026; daily export requestedDec1–7,2025 returnedSep7–17,2026. Native monthly HTML retainsSep2025–Sep2026. No export was mislabeled or imported as the requested old period.
- Reporting metadata advertises additional explicit-date transaction, money, servings, cleaning, staff, and sold-versus-dispensed reports. These have NOT all been downloaded; the deployed read-only bridge supports poured-volume exports only. Do not claim all PMB report types exhausted or all pre-Jul2025 data permanently gone. Asked which report screen the user normally uses for older weekly usage; optional answer pending.
- Durable evidence: output/pmb-export-period-checks-2026-09-18.json, output/pmb-report-options-2026-09-18.json, output/pmb-older-history-scan-2026-09-18.json, output/pmb-native-report-history-2026-09-18.json, output/pmb-monthly-reconciliation-2026-09-18.json, and docs/pmb-history-recovery-2026-09-18.md. All imports/scans finished; no background runner remains.

### Remove snapshot options — September 17, 2026

- Removed Snapshot options and its Delete snapshot menu control from the saved snapshot header, plus the obsolete click binding to avoid a missing-element error. Saved records are unchanged.
- Seven dashboard simplification tests, scoped lint, and whitespace checks passed. Local only, pending deployment.

### Guest favorites 52-week option — September 17, 2026

- Added 52 weeks before All time, retaining shorter ranges. Kept the linked Drink rankings selector consistent and wired selection/period calculations to52. All-time crowd favorite now uses the all-time ranking instead of its52-week-capped recent window.
-43 focused tests, lint and whitespace checks passed. Additional60-week fixture verified52 versus60 reports across rankings, leaders and mix. Local only; not deployed.

## CSV fallback restoration — September 18, 2026

- User reversed the PMB-only preference and authorized restoring CSV usage where no usable PMB reading exists.
- Implemented common per-product/week source priority, CSV source labels, date validation, fresh-login/outbox restoration, demand/performance/ranking support, and later PMB upgrades. Known spreadsheet label variants resolve without merging distinct products or walls. Malformed/overlapping ranges remain excluded.
- Read original CSVs through the restored parser/changeover policy and rehearsed against fresh live revision 108. Candidate adds 979 CSV entries and two distinct former-product archives; all 5,066 PMB entries and current counts are unchanged. Latest coverage remains 102/102. No live write performed.
- Main workspace suite passed 1,164 tests before the final spelling regression; isolated release gate passed all 1,160 tests including the final regression, zero-warning lint, build, and whitespace checks. Isolated release excludes concurrent pricing/snapshot edits.
- Release commit a4f036c prepared in /tmp/onpar-csv-fallback-release. Push to origin/main was rejected by automatic approval review because it triggers shared production deployment and explicit deployment approval was required. Do not bypass. Asked user through async approval question. Live inspected version 7dd13e5 still has PMB-only filtering.
- Pending after explicit approval: push the exact tested isolated commit (handle a newer remote revision normally), verify GitHub quality/deploy and live version, re-read current shared history, recompute CSV-only gaps, check preservation, write via revision-checked POST /api/weekly-usage-state through Cloudflare, and read back. Private candidate, source fallback, and preservation verifier are in /tmp/onpar-history-20260918; do not expose the session cookie.

### Pre-deployment year-coverage question — September 18

- User paused deployment to ask whether every week in the last year has data. This is not deployment approval.
- Fresh Cloudflare read still revision 108. Audited all 52 completed Monday–Sunday weeks, September 15, 2025–September 13, 2026. Every week already has at least one usable PMB reading; no wholly blank week. Current partial week excluded.
- Coverage is not complete: many historical taps lack usable readings or verified assignments, and some recovered PMB entries explicitly flag reportComplete:false. CSV restoration fills product-level gaps across 25 weeks but does not establish complete annual usage. A reading on every tap also does not verify all pours. Do not describe the year as fully recovered.
- Detailed read-only coverage is output/weekly-history-year-coverage-2026-09-18.json. No deployment or shared-history mutation.

### Hennessy price button — September 18, 2026

- Reproduced the live Pricing Suggestions shortcut doing nothing for Hennessy. Opened the direct Patio Hennessy editor in the user's existing Chrome tab; both price fields are available. Save is disabled until at least one value changes. No price was changed or saved.
- Confirmed the already-pending local renderShotPricing change binds suggestion buttons after editors exist and opens/focuses the corresponding editor. Live HEAD lacks that binding.
- Added behavioral VM regression tests for Hennessy taps 1 and 84, checking matching editor, directory expansion, scroll and focus. All 11 focused tests and scoped ESLint passed. Shortcut fix remains local, not deployed; preserve other concurrent pending changes.

### Hennessy deployment approved — September 18, 2026

- User explicitly requested testing and deployment. Isolated release at /tmp/onpar-hennessy-button-release contains only the missing 13-line shortcut handler and regression tests; other pending edits remain excluded.
- Regression fails on production baseline for both taps (missing handler) and passes with fix. All 1,154 tests, lint, build passed. Commit c3e6cba0f7e2e6ea7d84c7d4400d1336c2a042c8 pushed to origin/main; GitHub quality run 35370183667 in progress, followed by automatic on-site deployment.
- First on-site attempt failed the 30-second startup smoke check and rolled back to 7dd13e5. Retried the same guarded deployment; attempt 2 succeeded. Live /api/version verified exact c3e6cba commit. /api/health?storage=1 returns ok:true and all shared resources available; pre-existing September 14 par-agent error still reported.
- Live browser reload: Karaoke Hennessy suggestion opens and focuses the correct editor. Initial PMB form verification was pending after restart; clicked its read-only recheck before final verification.
- Final live UI verification passed for both Hennessy suggestion buttons. PMB recheck succeeded. Patio shortcut opened and focused the correct editor; entering 11.17 enabled Save, restoring 11.00 disabled it again. No Save was submitted and no live prices changed. User's tab left with the Patio editor open and original prices. Deployment complete.

### Shared-data warning recovery — September 20, 2026

- Compared existing live Chrome dashboard tabs: one retained Dashboard setup/Inventory read failures; another also retained Keg Levels and an inventory timeout. Network-enabled read-only storage readiness passed all seven resources. Reloaded both tabs and verified both visibly show All is Well / No current issues and Weekly Plan Complete.
- Root cause of the stuck UI: failed startup reads for dashboard configuration and inventory were not retried by the visible refresh loop (Weekly Usage already retries). Added read-only recovery for unavailable dashboard configuration, inventory, and Keg Levels on startup completion, focus, visible timer, visibility, and online events.
- Recovery does not publish/import data or clear pending operations. It skips active forms, saves, outboxes/conflicts, and rejects reads raced by edits using mutation counters/revisions. Recipe collections and inventory catalog rebuild from the recovered data. Actual database outage cause remains unconfirmed; this fixes stale browser error recovery, not the Supabase incident itself.
- Nine new behavior regressions; 24 focused tests and scoped lint passed. Isolated production-baseline candidate at /tmp/onpar-shared-read-fix-20260920 based on deployed 04634a90b39512dd9052395d40135d54677ffd19 includes only public/dashboard.js and tests/shared-read-recovery.test.mjs. Full isolated gate: 1,165 tests, lint and build pass. Sandbox-only initial full check could not bind local test servers; network-enabled check passed.
- Existing unrelated working-tree changes preserved. Automatic retry change remains local and is not deployed. Live windows recovered through reload only.

### Proof eight-week minimum-order forecast — September 21, 2026

- Proof minimum-order top-ups now consider the full saved eight-week cocktail-ingredient forecast, including a shelf-stable case first needed in week eight. Selection remains earliest-need-first, deducts counted and already-ordered units, stops once the $350 threshold is reached, and never uses refrigerated, unknown-count, or unjustified products.
- The existing Monday flow recalculates and freezes this policy from the newly saved inventory/keg snapshot before publishing the weekly plan. Forecast calculation now fails closed to `unknown` with no candidates if malformed input throws, so it cannot interrupt snapshot saving or invent an order.
- The forecast is explicitly driven by each tap's expected weekly usage. Every future week carries forward the preceding week's projected closing stock, including projected prep batches, before subtracting that week's expected usage; locked prep is credited once rather than recommended again. Newly saved physical inventory and keg counts remain the next run's authoritative starting point, so completed receipts/prep from the prior operating week enter through the saved state rather than being assumed.
- All 57 focused Proof/rolling-order tests passed, scoped lint passed, production build passed, and whitespace checks passed. Full suite: 1,181/1,190 passed; two unrelated dirty-worktree NA-beer inventory assertions failed, and seven PMB loopback tests failed because sandbox networking cannot bind localhost. Local only; not deployed.

### Snapshot shared-save reliability — September 21, 2026

- Fixed the Monday snapshot retry trap where storage could commit successfully but the browser could time out before receiving the response. Every new snapshot attempt now carries a durable capture ID; retrying that exact attempt returns the already-saved state instead of reporting a false shared-inventory revision conflict or writing twice.
- The snapshot commit receives a 20-second browser deadline instead of racing the storage layer's own 8-second deadline. The normal snapshot workflow now reuses its initial verified inventory state through calculation and relies on the server's atomic revision check at commit, removing two redundant full shared-inventory reads.
- Added regressions for a lost response after commit, stable browser recovery IDs, the longer commit deadline, and the single-read save path. Fourteen focused reliability/store tests and five applicable Monday capture tests pass; scoped lint, production build, and whitespace checks pass. The broader 113-test inventory/weekly group has 111 passes and the same two pre-existing dirty-worktree NA-beer policy assertion failures noted above. Local only; not deployed.
- Follow-up regression coverage for weekly usage and prior-week action carry-forward raised the focused total to 59 passing tests.

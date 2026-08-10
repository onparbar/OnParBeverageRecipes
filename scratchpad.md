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
  - optional `PMB_KEG_DEVICE_ID`
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
- Runtime service folder is `/Users/onparmarketing/OnParBeverageRecipes-service` because macOS blocked launchd from executing reliably out of Desktop.
- Service logs live in `/Users/onparmarketing/OnParBeverageRecipes-service/logs`.
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
  - `/Users/onparmarketing/OnParBeverageRecipes-service`
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
  - The always-on service copy at `/Users/onparmarketing/OnParBeverageRecipes-service` was missing its `.next` production build, causing Cloudflare 502s until rebuilt.
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
cd /Users/onparmarketing/OnParBeverageRecipes-service
PATH=/Users/onparmarketing/OnParBeverageRecipes-service/.tools/node/bin:$PATH npm run build
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
- Karaoke cocktail recommendations continue to use average weekly usage plus `0.25` keg, and cocktail makes are no longer suppressed by beer cooler-capacity allocation.
- Patio taps `1-20` and Karaoke taps `83-92` now order when live keg ounces are below average weekly ounces plus `100` ounces. Backup counts and beer cooler capacity do not affect this liquor rule.
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

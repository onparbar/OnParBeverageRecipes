# Setup Checklist

## New Computer Setup

### 1. Install the basics

- Install `Node.js` LTS
- Install `Git`
- Install `VS Code` if you want a code editor
- Install the `Vercel` CLI only if you want local Vercel commands

### 2. Copy the project

- Clone or copy this repo to your new computer
- Main working repo:
  - `OnParBeverageRecipes`

### 3. Copy your local env file

- Copy `.env.local` from the old computer into the repo root
- Do not commit `.env.local`

### 4. Install packages

Run:

```bash
npm install
```

### 5. Start the app locally

Run:

```bash
npm run dev
```

Then open:

- [http://localhost:3000](http://localhost:3000)

### 6. If local Next.js gets weird

If you see chunk/module errors like:

- `Cannot find module './331.js'`
- `Cannot find module './833.js'`
- `__webpack_modules__[moduleId] is not a function`

Delete `.next` and restart:

```bash
rm -rf .next
npm run dev
```

On Windows PowerShell, use:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm.cmd run dev
```

### 7. Build before pushing

Run:

```bash
npm run build
```

### 8. Push / deploy flow

- GitHub `main` deploys to Vercel
- Before pushing:
  - run local check
  - run `npm run build`

### 9. Vercel env vars

Make sure Vercel has the same env vars your app needs.

Important ones used in this project include:

- `PROVI_COOKIE_HEADER`
- `PROVI_RETAILER_CONTEXT`
- `PROVI_OHLQ_ACCOUNT_NUMBER`
- `PROVI_OHLQ_DISTRIBUTOR_ID`
- `PROVI_OHLQ_DISTRIBUTOR_ACCOUNT_ID`
- `PROVI_OHLQ_RETAILER_DISTRIBUTOR_ID`
- `PMB_API_BASE_URL`
- `PMB_API_USERNAME`
- `PMB_API_PASSWORD`
- `PMB_API_CLIENT_ID`
- `PMB_API_CLIENT_NAME`
- `PMB_KEG_DEVICE_ID`
- `UNTAPPD_BUSINESS_EMAIL`
- `UNTAPPD_BUSINESS_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (server-only; never use a `NEXT_PUBLIC_` prefix)
- `PROVI_CAPTURE_RETENTION_DAYS` (defaults to `30`)
- `PROVI_CAPTURE_MAX_FILES` (defaults to `20`)

Before enabling shared prices, recipes, and product setup for the first time,
apply `supabase/migrations/20260730000000_create_dashboard_shared_state.sql` in
the Supabase SQL editor. The dashboard will then show a manager-only import
button; import from the service computer unless another browser definitely has
the complete saved setup.

Before enabling shared counts, pars, custom inventory items, and Monday
snapshots, also apply
`supabase/migrations/20260731000000_create_inventory_shared_state.sql`. This
creates only an empty shared container. The dashboard will not automatically
copy a browser's inventory into it. Perform the one-time inventory import from
the service computer, using the manager-only `Import from service computer`
button in Inventory. Until then, inventory edits remain saved only in the
browser where they were made.

Before sharing PMB Weekly Usage reports and replaced-product history, apply
`supabase/migrations/20260731010000_create_weekly_usage_shared_state.sql`.
This also creates an empty container only. Import the saved Weekly Usage data
from the service computer using the manager-only button in Weekly Usage; do
not initialize it from a home browser with incomplete PMB history.

Before sharing Keg Levels backup counts, pars, on-deck choices, and par-agent
recommendations, apply
`supabase/migrations/20260731020000_create_keg_par_agent_shared_state.sql`.
This creates an empty container only. Use the manager-only Keg Levels import
button from the service computer; do not initialize it from a home browser.

### 10. Local network note

For Pour My Beer / keg level work:

- the computer must be on the same network as the PMB server
- the PMB local IP must still be reachable
- live PMB calls begin only when you open a PMB-backed section or press its refresh button
- shared prices, recipes, and product setup use Supabase and remain available away from the work network when internet access is available
- after its one-time service-computer import, shared inventory also uses Supabase; saving a Monday snapshot still requires complete live PMB tap coverage
- after its one-time service-computer import, Weekly Usage reports use Supabase and can be viewed away from work; new PMB reports can still be pulled only while connected to the local PMB network
- after its one-time service-computer import, Keg Levels counts, pars, on-deck choices, cooler capacity, and recommendations use Supabase; live keg refreshes and par-agent PMB reads still require the work network
- the service computer being offline does not block Supabase-backed dashboard work, but it does block live Pour My Beer reads and writes

### 11. Provi security

- Run `npm run provi:session` under the same Windows account that will run the service
- The setup automatically locks `.FoodOrderAgent\provi` to that Windows account, `SYSTEM`, and local Administrators
- Provi diagnostic captures redact login, cookie, token, personal, and payment fields
- Old capture JSON files are removed after the configured retention window/count
- Do not copy or share the `.FoodOrderAgent\provi` folder; the live browser session state is still a credential

### 12. Helpful files

- [scratchpad.md](C:\Users\info\Projects\OnParBeverageRecipes\scratchpad.md)
- [app/page.jsx](C:\Users\info\Projects\OnParBeverageRecipes\app\page.jsx)
- [app/globals.css](C:\Users\info\Projects\OnParBeverageRecipes\app\globals.css)
- [public/dashboard.js](C:\Users\info\Projects\OnParBeverageRecipes\public\dashboard.js)

### 13. Quick sanity check after setup

- Open the dashboard
- Check `Recipes`
- Check `Ingredient & Keg Costs`
- Check `Inventory`
- Check `Keg Levels`
- Run a vendor sync test
- Make sure local edits refresh correctly

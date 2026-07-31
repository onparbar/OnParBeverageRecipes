# Shared dashboard state

Apply `migrations/20260730000000_create_dashboard_shared_state.sql` once in the
Supabase SQL editor, then configure these server-only environment variables:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

`SUPABASE_SERVICE_ROLE_KEY` is also supported for projects that still use a
legacy service-role JWT. Do not prefix either secret with `NEXT_PUBLIC_`.

The migration creates one uninitialized `dashboard-config` row. The application
does not create or populate that row automatically.

## API contract

`GET /api/dashboard-state` returns:

```json
{
  "version": 1,
  "id": "dashboard-config",
  "revision": 0,
  "initialized": false,
  "initializedAt": "",
  "updatedAt": "2026-07-30T12:00:00.000Z",
  "updatedByRole": "",
  "data": {
    "pricing": {
      "ingredientPriceOverrides": {},
      "kegPriceOverrides": {},
      "chargeOverrides": {}
    },
    "recipes": {
      "customRecipes": [],
      "inactiveRecipeIds": [],
      "editedRecipes": {}
    },
    "products": {
      "customBeerKegs": [],
      "customLiquorTaps": [],
      "comingSoonItems": [],
      "tapReplacementOverrides": {}
    }
  }
}
```

Owners receive the complete document. Employee GET responses keep the same
shape but return empty pricing and product slices. Their recipe slice retains
only an explicit allowlist of operational recipe and ingredient fields; cost,
price, charge, metric, supplier, and other unrecognized fields are omitted.

Only an owner may initialize or change state. Initialization is explicit and
must include all ten fields:

```json
{
  "action": "initialize",
  "expectedRevision": 0,
  "data": {
    "pricing": {
      "ingredientPriceOverrides": {},
      "kegPriceOverrides": {},
      "chargeOverrides": {}
    },
    "recipes": {
      "customRecipes": [],
      "inactiveRecipeIds": [],
      "editedRecipes": {}
    },
    "products": {
      "customBeerKegs": [],
      "customLiquorTaps": [],
      "comingSoonItems": [],
      "tapReplacementOverrides": {}
    }
  }
}
```

Send that body to `POST /api/dashboard-state`. Later changes may use either
`PATCH /api/dashboard-state` with the body below or `POST` with
`"action": "patch"`:

```json
{
  "expectedRevision": 1,
  "patch": {
    "recipes": {
      "customRecipes": []
    },
    "products": {
      "comingSoonItems": []
    }
  }
}
```

Every supplied leaf replaces that full leaf value, while omitted leaves remain
unchanged. All supplied leaves commit in one row update. A stale revision
returns `409 SHARED_STATE_REVISION_CONFLICT` with `expectedRevision` and
`currentRevision`; the client must GET the current state before retrying.

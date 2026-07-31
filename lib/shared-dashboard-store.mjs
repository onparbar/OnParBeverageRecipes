const DEFAULT_TABLE = "dashboard_shared_state";
const STATE_ID = "dashboard-config";
const MAX_STATE_BYTES = 2_000_000;
const OPERATIONAL_RECIPE_SCALAR_FIELDS = Object.freeze([
  "id",
  "title",
  "sourceTitle",
  "batch",
  "category",
  "status",
  "description",
  "imageUrl",
  "isCustom",
]);
const OPERATIONAL_INGREDIENT_SCALAR_FIELDS = Object.freeze([
  "id",
  "raw",
  "name",
  "quantity",
  "unit",
  "notes",
  "oz",
  "manualAbvPercent",
  "packageCount",
  "packageUnit",
  "packageSizeOz",
]);

const FIELD_SHAPES = Object.freeze({
  pricing: Object.freeze({
    ingredientPriceOverrides: "object",
    kegPriceOverrides: "object",
    chargeOverrides: "object",
  }),
  recipes: Object.freeze({
    customRecipes: "array",
    inactiveRecipeIds: "array",
    editedRecipes: "object",
  }),
  products: Object.freeze({
    customBeerKegs: "array",
    customLiquorTaps: "array",
    comingSoonItems: "array",
    pmbPublishQueue: "array",
    tapReplacementOverrides: "object",
  }),
});

export const SHARED_DASHBOARD_STATE_ID = STATE_ID;
export const SHARED_DASHBOARD_FIELD_SHAPES = FIELD_SHAPES;

export class SharedDashboardStoreError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "SharedDashboardStoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function storeError(code, message, status, details) {
  return new SharedDashboardStoreError(code, message, status, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw storeError("INVALID_SHARED_STATE", `${label} must contain valid JSON data.`, 400);
  }

  if (serialized === undefined) {
    throw storeError("INVALID_SHARED_STATE", `${label} must contain valid JSON data.`, 400);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw storeError(
      "SHARED_STATE_TOO_LARGE",
      `Shared dashboard state cannot exceed ${MAX_STATE_BYTES} bytes.`,
      413,
    );
  }
  return JSON.parse(serialized);
}

function assertKnownKeys(value, allowedKeys, label) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw storeError(
      "INVALID_SHARED_STATE",
      `${label} contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}.`,
      400,
    );
  }
}

function validateFieldValue(value, expectedShape, label) {
  if (expectedShape === "array" && !Array.isArray(value)) {
    throw storeError("INVALID_SHARED_STATE", `${label} must be an array.`, 400);
  }
  if (expectedShape === "object" && !isPlainObject(value)) {
    throw storeError("INVALID_SHARED_STATE", `${label} must be an object.`, 400);
  }
  return cloneJson(value, label);
}

export function createEmptySharedDashboardData() {
  return {
    pricing: {
      ingredientPriceOverrides: {},
      kegPriceOverrides: {},
      chargeOverrides: {},
    },
    recipes: {
      customRecipes: [],
      inactiveRecipeIds: [],
      editedRecipes: {},
    },
    products: {
      customBeerKegs: [],
      customLiquorTaps: [],
      comingSoonItems: [],
      pmbPublishQueue: [],
      tapReplacementOverrides: {},
    },
  };
}

function copyOperationalScalars(source, allowedFields) {
  const result = {};
  allowedFields.forEach((key) => {
    if (!Object.hasOwn(source, key)) return;
    const value = source[key];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      result[key] = value;
    }
  });
  return result;
}

function projectOperationalIngredient(value) {
  if (!isPlainObject(value)) return null;
  return copyOperationalScalars(value, OPERATIONAL_INGREDIENT_SCALAR_FIELDS);
}

function projectOperationalRecipe(value) {
  if (!isPlainObject(value)) return null;
  const result = copyOperationalScalars(value, OPERATIONAL_RECIPE_SCALAR_FIELDS);
  result.ingredients = Array.isArray(value.ingredients)
    ? value.ingredients.map(projectOperationalIngredient).filter(Boolean)
    : [];
  if (typeof value.instructions === "string") {
    result.instructions = value.instructions;
  } else if (Array.isArray(value.instructions)) {
    result.instructions = value.instructions.filter((entry) => typeof entry === "string");
  }
  return result;
}

export function projectSharedDashboardStateForRole(state, role) {
  const source = cloneJson(state, "Shared dashboard state");
  if (role === "owner") return source;

  const emptyData = createEmptySharedDashboardData();
  const recipes = isPlainObject(source?.data?.recipes) ? source.data.recipes : {};
  const customRecipes = Array.isArray(recipes.customRecipes)
    ? recipes.customRecipes.map(projectOperationalRecipe).filter(Boolean)
    : [];
  const inactiveRecipeIds = Array.isArray(recipes.inactiveRecipeIds)
    ? recipes.inactiveRecipeIds.filter((value) => typeof value === "string")
    : [];
  const editedRecipes = Object.fromEntries(
    Object.entries(isPlainObject(recipes.editedRecipes) ? recipes.editedRecipes : {})
      .map(([id, value]) => [id, projectOperationalRecipe(value)])
      .filter(([, value]) => value !== null),
  );

  return {
    version: source.version,
    id: source.id,
    revision: source.revision,
    initialized: source.initialized,
    initializedAt: source.initializedAt,
    updatedAt: source.updatedAt,
    updatedByRole: source.updatedByRole,
    data: {
      pricing: emptyData.pricing,
      recipes: {
        customRecipes,
        inactiveRecipeIds,
        editedRecipes,
      },
      products: emptyData.products,
    },
  };
}

function normalizeCompleteData(
  value,
  { requireEveryField = false, allowLegacyMissingPmbQueue = false } = {},
) {
  if (!isPlainObject(value)) {
    throw storeError("INVALID_SHARED_STATE", "Shared dashboard data must be an object.", 400);
  }

  const result = createEmptySharedDashboardData();
  assertKnownKeys(value, Object.keys(FIELD_SHAPES), "Shared dashboard data");

  for (const [group, fields] of Object.entries(FIELD_SHAPES)) {
    const groupValue = value[group];
    if (requireEveryField && !isPlainObject(groupValue)) {
      throw storeError("INVALID_SHARED_STATE", `Shared dashboard data.${group} is required.`, 400);
    }
    if (groupValue === undefined) continue;
    if (!isPlainObject(groupValue)) {
      throw storeError("INVALID_SHARED_STATE", `Shared dashboard data.${group} must be an object.`, 400);
    }

    assertKnownKeys(groupValue, Object.keys(fields), `Shared dashboard data.${group}`);
    for (const [field, expectedShape] of Object.entries(fields)) {
      const isLegacyQueueField = (
        allowLegacyMissingPmbQueue
        && group === "products"
        && field === "pmbPublishQueue"
      );
      if (requireEveryField && !isLegacyQueueField && !Object.hasOwn(groupValue, field)) {
        throw storeError(
          "INVALID_SHARED_STATE",
          `Shared dashboard data.${group}.${field} is required.`,
          400,
        );
      }
      if (!Object.hasOwn(groupValue, field)) continue;
      result[group][field] = validateFieldValue(
        groupValue[field],
        expectedShape,
        `Shared dashboard data.${group}.${field}`,
      );
    }
  }

  cloneJson(result, "Shared dashboard data");
  return result;
}

function normalizePatch(patch) {
  if (!isPlainObject(patch)) {
    throw storeError("INVALID_SHARED_STATE", "Shared dashboard patch must be an object.", 400);
  }

  assertKnownKeys(patch, Object.keys(FIELD_SHAPES), "Shared dashboard patch");
  const result = {};
  let fieldCount = 0;

  for (const [group, groupPatch] of Object.entries(patch)) {
    if (!isPlainObject(groupPatch)) {
      throw storeError("INVALID_SHARED_STATE", `Shared dashboard patch.${group} must be an object.`, 400);
    }
    const fields = FIELD_SHAPES[group];
    assertKnownKeys(groupPatch, Object.keys(fields), `Shared dashboard patch.${group}`);
    result[group] = {};

    for (const [field, value] of Object.entries(groupPatch)) {
      result[group][field] = validateFieldValue(
        value,
        fields[field],
        `Shared dashboard patch.${group}.${field}`,
      );
      fieldCount += 1;
    }
  }

  if (!fieldCount) {
    throw storeError("EMPTY_SHARED_STATE_PATCH", "At least one shared dashboard field is required.", 400);
  }
  return result;
}

export function applySharedDashboardPatch(currentData, patch) {
  const current = normalizeCompleteData(currentData, { requireEveryField: true });
  const normalizedPatch = normalizePatch(patch);
  const next = cloneJson(current, "Shared dashboard data");

  for (const [group, fields] of Object.entries(normalizedPatch)) {
    for (const [field, value] of Object.entries(fields)) {
      next[group][field] = value;
    }
  }

  cloneJson(next, "Shared dashboard data");
  return next;
}

function normalizeRevision(value, { initialization = false } = {}) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw storeError(
      "INVALID_SHARED_STATE_REVISION",
      "expectedRevision must be a non-negative integer.",
      400,
    );
  }
  if (initialization && revision !== 0) {
    throw storeError(
      "INVALID_SHARED_STATE_REVISION",
      "Shared dashboard initialization requires expectedRevision 0.",
      400,
    );
  }
  return revision;
}

function normalizeTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeRole(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 30);
}

function normalizeRow(row) {
  if (!isPlainObject(row)) {
    throw storeError(
      "SHARED_STATE_INVALID_RESPONSE",
      "Shared dashboard storage returned an invalid response.",
      503,
    );
  }

  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw storeError(
      "SHARED_STATE_INVALID_RESPONSE",
      "Shared dashboard storage returned an invalid revision.",
      503,
    );
  }

  const initialized = row.initialized === true;
  let data;
  try {
    data = normalizeCompleteData(row.data || {}, {
      requireEveryField: initialized,
      allowLegacyMissingPmbQueue: true,
    });
  } catch (error) {
    if (error instanceof SharedDashboardStoreError) {
      throw storeError(
        "SHARED_STATE_INVALID_RESPONSE",
        "Shared dashboard storage contains invalid data.",
        503,
      );
    }
    throw error;
  }

  return {
    version: 1,
    id: STATE_ID,
    revision,
    initialized,
    initializedAt: normalizeTimestamp(row.initialized_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedByRole: normalizeRole(row.updated_by_role),
    data,
  };
}

function getConfiguration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(
    env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();
  const table = DEFAULT_TABLE;

  if (!baseUrl || !secret) {
    throw storeError(
      "SHARED_STATE_UNAVAILABLE",
      "Shared dashboard storage is not configured.",
      503,
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw storeError(
      "SHARED_STATE_UNAVAILABLE",
      "Shared dashboard storage is not configured correctly.",
      503,
    );
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  const allowInsecureLoopback = (
    String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").trim().toLowerCase() === "true"
    && isLoopback
  );
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && allowInsecureLoopback)) {
    throw storeError(
      "SHARED_STATE_UNAVAILABLE",
      "Shared dashboard storage is not configured correctly.",
      503,
    );
  }

  return { baseUrl, secret, table };
}

function getHeaders(secret, method) {
  const headers = {
    Accept: "application/json",
    apikey: secret,
  };
  if (secret.split(".").length === 3) {
    headers.Authorization = `Bearer ${secret}`;
  }
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  return headers;
}

function getRequestUrl(configuration, filters = {}) {
  const requestUrl = new URL(
    `${configuration.baseUrl}/rest/v1/${encodeURIComponent(configuration.table)}`,
  );
  requestUrl.searchParams.set("select", "id,revision,initialized,data,initialized_at,updated_at,updated_by_role");
  requestUrl.searchParams.set("id", `eq.${STATE_ID}`);
  Object.entries(filters).forEach(([key, value]) => {
    requestUrl.searchParams.set(key, `eq.${value}`);
  });
  return requestUrl;
}

function providerFailureStatus(responseStatus, body) {
  const providerCode = String(body?.code || "");
  if (
    [400, 401, 403, 404].includes(responseStatus)
    || ["42P01", "42501", "PGRST205"].includes(providerCode)
  ) {
    return 503;
  }
  return 502;
}

async function parseProviderResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON response is handled as an unavailable provider below.
  }

  if (!response.ok) {
    throw storeError(
      "SHARED_STATE_UNAVAILABLE",
      "Shared dashboard storage is unavailable.",
      providerFailureStatus(response.status, body),
    );
  }
  if (!Array.isArray(body)) {
    throw storeError(
      "SHARED_STATE_INVALID_RESPONSE",
      "Shared dashboard storage returned an invalid response.",
      503,
    );
  }
  return body;
}

export function createSharedDashboardStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  async function request(method, filters = {}, body) {
    const configuration = getConfiguration(env);
    if (typeof fetchImpl !== "function") {
      throw storeError(
        "SHARED_STATE_UNAVAILABLE",
        "Shared dashboard storage is unavailable.",
        503,
      );
    }

    let response;
    try {
      response = await fetchImpl(getRequestUrl(configuration, filters), {
        method,
        headers: getHeaders(configuration.secret, method),
        cache: "no-store",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw storeError(
        "SHARED_STATE_UNAVAILABLE",
        "Shared dashboard storage is unavailable.",
        503,
      );
    }
    return parseProviderResponse(response);
  }

  async function read() {
    const rows = await request("GET");
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) {
      throw storeError(
        "SHARED_STATE_ROW_MISSING",
        "Shared dashboard storage has not been provisioned.",
        503,
      );
    }
    return normalizeRow(row);
  }

  async function explainCasMiss(expectedRevision, expectedInitialized) {
    const current = await read();
    if (expectedInitialized === false && current.initialized) {
      throw storeError(
        "SHARED_STATE_ALREADY_INITIALIZED",
        "Shared dashboard state has already been initialized.",
        409,
        { currentRevision: current.revision },
      );
    }
    if (expectedInitialized === true && !current.initialized) {
      throw storeError(
        "SHARED_STATE_NOT_INITIALIZED",
        "Shared dashboard state must be initialized before it can be updated.",
        409,
        { currentRevision: current.revision },
      );
    }
    throw storeError(
      "SHARED_STATE_REVISION_CONFLICT",
      "Shared dashboard state changed in another session. Reload before saving again.",
      409,
      { expectedRevision, currentRevision: current.revision },
    );
  }

  async function compareAndSwap(expectedRevision, expectedInitialized, changes) {
    const rows = await request(
      "PATCH",
      { revision: expectedRevision, initialized: expectedInitialized },
      changes,
    );
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) return explainCasMiss(expectedRevision, expectedInitialized);
    return normalizeRow(row);
  }

  async function initialize({ expectedRevision, data }, role = "owner") {
    const revision = normalizeRevision(expectedRevision, { initialization: true });
    const current = await read();
    if (current.initialized) {
      throw storeError(
        "SHARED_STATE_ALREADY_INITIALIZED",
        "Shared dashboard state has already been initialized.",
        409,
        { currentRevision: current.revision },
      );
    }
    if (current.revision !== revision) {
      throw storeError(
        "SHARED_STATE_REVISION_CONFLICT",
        "Shared dashboard state changed in another session. Reload before initializing.",
        409,
        { expectedRevision: revision, currentRevision: current.revision },
      );
    }

    const normalizedData = normalizeCompleteData(data, { requireEveryField: true });
    const timestamp = now().toISOString();
    return compareAndSwap(revision, false, {
      revision: revision + 1,
      initialized: true,
      data: normalizedData,
      initialized_at: timestamp,
      updated_at: timestamp,
      updated_by_role: normalizeRole(role) || "owner",
    });
  }

  async function patch({ expectedRevision, patch: patchValue }, role = "owner") {
    const revision = normalizeRevision(expectedRevision);
    const current = await read();
    if (!current.initialized) {
      throw storeError(
        "SHARED_STATE_NOT_INITIALIZED",
        "Shared dashboard state must be initialized before it can be updated.",
        409,
        { currentRevision: current.revision },
      );
    }
    if (current.revision !== revision) {
      throw storeError(
        "SHARED_STATE_REVISION_CONFLICT",
        "Shared dashboard state changed in another session. Reload before saving again.",
        409,
        { expectedRevision: revision, currentRevision: current.revision },
      );
    }

    const nextData = applySharedDashboardPatch(current.data, patchValue);
    return compareAndSwap(revision, true, {
      revision: revision + 1,
      data: nextData,
      updated_at: now().toISOString(),
      updated_by_role: normalizeRole(role) || "owner",
    });
  }

  return Object.freeze({ read, initialize, patch });
}

export function readSharedDashboardState() {
  return createSharedDashboardStore().read();
}

export function initializeSharedDashboardState(payload, role = "owner") {
  return createSharedDashboardStore().initialize(payload, role);
}

export function patchSharedDashboardState(payload, role = "owner") {
  return createSharedDashboardStore().patch(payload, role);
}

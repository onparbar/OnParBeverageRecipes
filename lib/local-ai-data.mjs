// Closed, read-only query language. Never execute model-generated code or SQL.
export const LOCAL_AI_COLUMNS = {
  usage: ["name", "tapNumber", "wall", "category", "weekIndex", "weekLabel", "ounces", "estimatedSales", "estimatedProfit", "kegEquivalents"],
  inventory: ["name", "group", "onHand", "countCurrent", "countedAt", "orderUnits", "orderHoldReason", "orderReason", "unitCost"],
  prices: ["name", "unit", "price", "oz", "vendor", "updatedAt"],
  recipes: ["name", "oz", "cost", "costComplete", "abv"],
  recipe_ingredients: ["recipe", "ingredient", "oz"],
  levels: ["name", "tapNumber", "wall", "fraction", "ounces"],
  health: ["name", "initialized", "savePending", "saveError", "unsavedCount"],
};
const numericFields = new Set(["tapNumber", "weekIndex", "ounces", "estimatedSales", "estimatedProfit", "kegEquivalents", "onHand", "orderUnits", "unitCost", "price", "oz", "cost", "abv", "fraction", "unsavedCount"]);
const numeric = (value) => typeof value === "number" && Number.isFinite(value);
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\u2019']/g, "").trim();
const fail = (message) => { throw new Error(message); };

export function sanitizeLocalAiSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") fail("Dashboard snapshot is missing.");
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt) || Math.abs(Date.now() - capturedAt) > 300000) fail("Reload dashboard data before asking again.");
  const tables = {};
  let totalRows = 0;
  for (const [dataset, fields] of Object.entries(LOCAL_AI_COLUMNS)) {
    const rows = snapshot.tables?.[dataset];
    if (!Array.isArray(rows) || rows.length > 20000) fail(`Invalid ${dataset} snapshot.`);
    totalRows += rows.length;
    if (totalRows > 30000) fail("Dashboard snapshot is too large.");
    tables[dataset] = rows.map((row) => Object.fromEntries(fields.map((field) => {
      const value = row?.[field];
      return [field, numericFields.has(field) ? numeric(value) ? value : null
        : typeof value === "boolean" ? value : typeof value === "string" ? value.slice(0, 1500) : null];
    })));
  }
  return { capturedAt: new Date(capturedAt).toISOString(), tables };
}

export const LOCAL_AI_TOOLS = [
  { type: "function", function: {
    name: "query_dashboard",
    description: "Read a dashboard dataset. All filters are AND. Group and aggregate before sorting/limiting. Unknown numeric values are null, never zero. Results report unknown counts. For OR use the in operator. weekIndex 0 is the latest completed saved week; last N weeks means weekIndex < N.",
    parameters: { type: "object", required: ["dataset"], properties: {
      dataset: { type: "string", enum: Object.keys(LOCAL_AI_COLUMNS) },
      filters: { type: "array", items: { type: "object", required: ["field", "op"], properties: {
        field: { type: "string" }, op: { type: "string", enum: ["eq", "ne", "contains", "in", "lt", "lte", "gt", "gte", "is_unknown"] },
        value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "array", items: { type: "string" } }] },
      } } },
      columns: { type: "array", items: { type: "string" } },
      groupBy: { type: "array", items: { type: "string" } },
      measures: { type: "array", items: { type: "object", required: ["field", "op", "as"], properties: {
        field: { type: "string" }, op: { type: "string", enum: ["sum", "avg", "min", "max", "known_count", "unknown_count"] }, as: { type: "string" },
      } } },
      sort: { type: "object", required: ["field"], properties: { field: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] } } },
      limit: { type: "integer", minimum: 1, maximum: 60 },
    } },
  } },
  { type: "function", function: {
    name: "calculate",
    description: "Perform arithmetic on values obtained from query_dashboard. For weighted margin use ratio_percent(sum profit, sum estimated sales). For percent_change use [previous, current]. Do not invent inputs.",
    parameters: { type: "object", required: ["operation", "values"], properties: {
      operation: { type: "string", enum: ["sum", "average", "subtract", "multiply", "divide", "ratio_percent", "percent_change"] },
      values: { type: "array", items: { type: "number" }, minItems: 1, maxItems: 100 },
    } },
  } },
];

export function executeLocalAiTool(snapshot, name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) fail("Tool arguments must be an object.");
  if (name === "calculate") {
    const values = args.values;
    if (!Array.isArray(values) || !values.length || values.length > 100 || !values.every(numeric)) fail("Use finite numeric calculation inputs.");
    const sum = values.reduce((a, b) => a + b, 0);
    let value;
    if (args.operation === "sum") value = sum;
    else if (args.operation === "average") value = sum / values.length;
    else if (args.operation === "multiply") value = values.reduce((a, b) => a * b, 1);
    else {
      if (values.length !== 2) fail("This calculation requires exactly two values.");
      const [a, b] = values;
      if (args.operation === "subtract") value = a - b;
      else if (args.operation === "divide") value = b === 0 ? null : a / b;
      else if (args.operation === "ratio_percent") value = b === 0 ? null : a / b * 100;
      else if (args.operation === "percent_change") value = a === 0 ? null : (b - a) / a * 100;
      else fail("Unsupported calculation.");
    }
    return { value: numeric(value) ? value : null, note: numeric(value) ? "Calculated from the supplied inputs." : "Undefined result; do not substitute zero." };
  }
  if (name !== "query_dashboard" || !Object.hasOwn(LOCAL_AI_COLUMNS, args.dataset)) fail("Unknown read-only tool or dataset.");
  const fields = LOCAL_AI_COLUMNS[args.dataset];
  const fieldAllowed = (field) => fields.includes(field) || fail(`Unknown field: ${String(field).slice(0, 80)}`);
  const filters = args.filters ?? [];
  const groupBy = args.groupBy ?? [];
  const measures = args.measures ?? [];
  const columns = args.columns ?? fields;
  if (![filters, groupBy, measures, columns].every(Array.isArray) || filters.length > 12 || groupBy.length > 3 || measures.length > 8 || columns.length > fields.length) fail("Too many query operations.");
  groupBy.forEach(fieldAllowed);
  columns.forEach(fieldAllowed);
  for (const measure of measures) {
    fieldAllowed(measure.field);
    if (!["sum", "avg", "min", "max", "known_count", "unknown_count"].includes(measure.op)
      || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(measure.as) || fields.includes(measure.as)
      || ["constructor", "prototype", "readingCount", "unknownCounts"].includes(measure.as)) fail("Invalid measure.");
    if (!["known_count", "unknown_count"].includes(measure.op) && !numericFields.has(measure.field)) fail("Aggregate a numeric field.");
  }
  if (new Set(measures.map((measure) => measure.as)).size !== measures.length) fail("Measure aliases must be unique.");
  for (const filter of filters) {
    fieldAllowed(filter.field);
    if (!["eq", "ne", "contains", "in", "lt", "lte", "gt", "gte", "is_unknown"].includes(filter.op)) fail("Invalid filter operator.");
    if (filter.op === "in" && (!Array.isArray(filter.value) || filter.value.length > 100)) fail("Invalid in filter.");
    if (["lt", "lte", "gt", "gte"].includes(filter.op) && !numeric(filter.value)) fail("A numeric threshold is required.");
    if (filter.op === "contains" && typeof filter.value !== "string") fail("A search string is required.");
  }
  const rows = snapshot.tables[args.dataset].filter((row) => filters.every((filter) => {
    const value = row[filter.field];
    if (filter.op === "is_unknown") return value === null;
    if (value === null) return false;
    if (filter.op === "eq") return normalize(value) === normalize(filter.value);
    if (filter.op === "ne") return normalize(value) !== normalize(filter.value);
    if (filter.op === "contains") return normalize(value).includes(normalize(filter.value));
    if (filter.op === "in") return filter.value.some((candidate) => normalize(value) === normalize(candidate));
    if (!numeric(value)) return false;
    return filter.op === "lt" ? value < filter.value : filter.op === "lte" ? value <= filter.value : filter.op === "gt" ? value > filter.value : value >= filter.value;
  }));
  let result;
  if (measures.length || groupBy.length) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify(groupBy.map((field) => row[field]));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    if (!rows.length && !groupBy.length) groups.set("[]", []);
    result = [...groups.values()].map((members) => {
      const output = Object.fromEntries(groupBy.map((field) => [field, members[0]?.[field] ?? null]));
      output.readingCount = members.length;
      output.unknownCounts = {};
      for (const measure of measures) {
        const values = members.map((row) => row[measure.field]).filter((value) => value !== null);
        const numbers = values.filter(numeric);
        output.unknownCounts[measure.as] = members.length - values.length;
        output[measure.as] = measure.op === "known_count" ? values.length : measure.op === "unknown_count" ? members.length - values.length
          : !numbers.length ? null : measure.op === "sum" ? numbers.reduce((a, b) => a + b, 0)
            : measure.op === "avg" ? numbers.reduce((a, b) => a + b, 0) / numbers.length
              : measure.op === "min" ? Math.min(...numbers) : Math.max(...numbers);
      }
      return output;
    });
  } else result = rows.map((row) => Object.fromEntries(columns.map((field) => [field, row[field]])));
  if (args.sort) {
    const allowed = measures.length || groupBy.length ? [...groupBy, ...measures.map((measure) => measure.as), "readingCount"] : columns;
    if (!allowed.includes(args.sort.field)) fail("Sort by a returned field.");
    result.sort((a, b) => {
      const left = a[args.sort.field], right = b[args.sort.field];
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const difference = numeric(left) && numeric(right) ? left - right : String(left).localeCompare(String(right));
      return args.sort.direction === "desc" ? -difference : difference;
    });
  }
  const limit = Math.max(1, Math.min(60, Math.floor(Number(args.limit) || 30)));
  return { dataset: args.dataset, capturedAt: snapshot.capturedAt, matchedReadings: rows.length, resultCount: result.length,
    truncated: result.length > limit, rows: result.slice(0, limit) };
}

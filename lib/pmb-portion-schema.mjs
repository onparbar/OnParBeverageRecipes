import { normalizePmbPortionItem } from "./pmb-portion-price-update.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function usableRows(itemRows) {
  return (Array.isArray(itemRows) ? itemRows : []).filter((row) => (
    positiveInteger(row?.product_plu)
    && clean(row?.portion_name)
    && Number(row?.price) > 0
    && Number.isSafeInteger(Number(row?.price_dp))
  ));
}

function failure(code, message, details = {}) {
  return { ok: false, code, message, details, schema: null, source: "" };
}

function stableId(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  const text = clean(value);
  return text && text.length <= 128 ? text : "";
}

function idFieldScore(field) {
  const key = field.toLowerCase();
  if (key === "item_id") return 1000;
  if (key === "itemid") return 950;
  if (key === "id") return 900;
  if (/item.*id|id.*item/.test(key)) return 800;
  if (/_id$/.test(key)) return 300;
  return 0;
}

function quantityFieldScore(field) {
  const key = field.toLowerCase();
  if (key === "quantity") return 1000;
  if (key === "portion_quantity") return 950;
  if (key === "quantity_oz" || key === "portion_quantity_oz") return 925;
  if (/quantity/.test(key)) return 800;
  if (/^qty|_qty/.test(key)) return 700;
  if (/volume.*oz|oz.*volume/.test(key)) return 600;
  if (key === "volume" || key === "ounces") return 500;
  return 0;
}

function quantityDpCandidates(quantityField, keys) {
  const lower = new Map(keys.map((key) => [key.toLowerCase(), key]));
  const names = [
    `${quantityField}_dp`,
    quantityField.replace(/_raw$/i, "_dp"),
    "quantity_dp",
    "portion_quantity_dp",
    "qty_dp",
    "volume_dp",
  ];
  return ["", ...new Set(names.map((name) => lower.get(name.toLowerCase())).filter(Boolean))];
}

function validateSchema(rows, schema) {
  const normalized = rows.map((row) => normalizePmbPortionItem(row, schema));
  if (new Set(normalized.map((item) => item.itemId)).size !== normalized.length) {
    throw new Error("The proposed PMB item ID is not unique across the live item list.");
  }
  const groups = new Map();
  normalized.forEach((item) => {
    if (!groups.has(item.productPlu)) groups.set(item.productPlu, []);
    groups.get(item.productPlu).push(item);
  });
  const verifiedPair = [...groups.entries()].find(([, items]) => (
    items.length === 2
    && new Set(items.map((item) => item.portionName.toLowerCase())).size === 2
    && new Set(items.map((item) => item.quantityOz)).size === 2
  ));
  if (!verifiedPair) {
    throw new Error("The live PMB item list did not contain an unambiguous two-portion product.");
  }
  return { normalized, samplePlu: verifiedPair[0] };
}

function discoverIdField(rows, keys) {
  const candidates = keys
    .map((field) => ({ field, score: idFieldScore(field) }))
    .filter(({ field, score }) => (
      score > 0
      && !/^product_plu$/i.test(field)
      && rows.every((row) => stableId(row?.[field]))
      && new Set(rows.map((row) => stableId(row?.[field]))).size === rows.length
    ))
    .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));
  if (!candidates.length) return null;
  if (candidates[1] && candidates[1].score === candidates[0].score) return null;
  return candidates[0].field;
}

function discoverQuantityField(rows, keys, itemIdField) {
  const candidates = [];
  keys.forEach((field) => {
    const score = quantityFieldScore(field);
    if (!score || field === itemIdField || /price|plu|product|portion_name|active|type/i.test(field)) return;
    quantityDpCandidates(field, keys).forEach((quantityDpField) => {
      const values = rows.map((row) => {
        const raw = Number(row?.[field]);
        const dp = quantityDpField ? Number(row?.[quantityDpField]) : 0;
        if (!Number.isFinite(raw) || !Number.isSafeInteger(dp) || dp < 0 || dp > 6) return NaN;
        return raw / (10 ** dp);
      });
      if (values.some((value) => !Number.isFinite(value) || value <= 0 || value > 128)) return;
      const grouped = new Map();
      rows.forEach((row, index) => {
        const plu = positiveInteger(row?.product_plu);
        if (!grouped.has(plu)) grouped.set(plu, []);
        grouped.get(plu).push(values[index]);
      });
      if (![...grouped.values()].some((group) => group.length === 2 && new Set(group).size === 2)) return;
      candidates.push({
        field,
        quantityDpField,
        score: score + (quantityDpField ? 25 : 0),
      });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));
  if (!candidates.length) return null;
  if (
    candidates[1]
    && candidates[1].score === candidates[0].score
    && (candidates[1].field !== candidates[0].field || candidates[1].quantityDpField !== candidates[0].quantityDpField)
  ) return null;
  return candidates[0];
}

export function resolvePmbPortionSchema(itemRows, configured = {}) {
  const rows = usableRows(itemRows);
  if (!rows.length) {
    return failure("PMB_PORTION_ITEMS_UNAVAILABLE", "PMB did not return any priced portion records.");
  }
  const requested = {
    itemIdField: clean(configured.itemIdField ?? process.env.PMB_PORTION_ITEM_ID_FIELD),
    quantityField: clean(configured.quantityField ?? process.env.PMB_PORTION_QUANTITY_FIELD),
    quantityDpField: clean(configured.quantityDpField ?? process.env.PMB_PORTION_QUANTITY_DP_FIELD),
  };
  if (requested.itemIdField || requested.quantityField || requested.quantityDpField) {
    if (!requested.itemIdField || !requested.quantityField) {
      return failure("PMB_PORTION_SCHEMA_INVALID", "The configured PMB portion schema is incomplete.");
    }
    try {
      const verified = validateSchema(rows, requested);
      return { ok: true, code: "", message: "", schema: requested, source: "configured", ...verified };
    } catch (error) {
      return failure("PMB_PORTION_SCHEMA_INVALID", error.message);
    }
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const itemIdField = discoverIdField(rows, keys);
  const quantity = itemIdField ? discoverQuantityField(rows, keys, itemIdField) : null;
  if (!itemIdField || !quantity) {
    return failure(
      "PMB_PORTION_SCHEMA_UNVERIFIED",
      "The live PMB item identity or portion quantity could not be identified unambiguously.",
    );
  }
  const schema = {
    itemIdField,
    quantityField: quantity.field,
    quantityDpField: quantity.quantityDpField,
  };
  try {
    const verified = validateSchema(rows, schema);
    return { ok: true, code: "", message: "", schema, source: "discovered", ...verified };
  } catch (error) {
    return failure("PMB_PORTION_SCHEMA_UNVERIFIED", error.message);
  }
}


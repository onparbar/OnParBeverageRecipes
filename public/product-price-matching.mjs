export function normalizeProductPriceKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[123]\s*$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btito s\b/g, "titos")
    .replace(/\bdaniel s\b/g, "daniels")
    .replace(/\bvodka|whisk(?:e)?y|tequila|rum|gin|bourbon|cognac\b/g, " ")
    .replace(/\bfireball cinnamon\b/g, "fireball")
    .replace(/\s+/g, " ")
    .trim();
}

export function getProductPriceAliases(value) {
  const text = String(value || "");
  const withoutParenthetical = text.replace(/\([^)]*\)/g, " ");
  return [...new Set([
    normalizeProductPriceKey(text),
    normalizeProductPriceKey(withoutParenthetical),
  ].filter(Boolean))];
}

export function productPriceKeysMatch(left, right) {
  const leftAliases = getProductPriceAliases(left);
  const rightAliases = getProductPriceAliases(right);
  return leftAliases.some((alias) => rightAliases.includes(alias));
}

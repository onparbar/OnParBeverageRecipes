export function normalizeGlobalSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getSearchFields(item) {
  const title = normalizeGlobalSearchText(item?.title);
  const section = normalizeGlobalSearchText(item?.section);
  const subtitle = normalizeGlobalSearchText(item?.subtitle);
  const extra = (Array.isArray(item?.searchText) ? item.searchText : [item?.searchText])
    .map(normalizeGlobalSearchText)
    .filter(Boolean)
    .join(" ");
  return {
    title,
    secondary: [section, subtitle, extra].filter(Boolean).join(" "),
    combined: [title, section, subtitle, extra].filter(Boolean).join(" "),
  };
}

function getSearchScore(item, query, tokens) {
  const fields = getSearchFields(item);
  if (!tokens.every((token) => fields.combined.includes(token))) return null;

  let score = 0;
  if (fields.title === query) score += 1_000;
  else if (fields.title.startsWith(query)) score += 800;
  else if (fields.title.includes(query)) score += 650;
  else if (fields.combined.includes(query)) score += 350;

  const titleWords = fields.title.split(" ");
  const titleTokenCount = tokens.filter((token) => fields.title.includes(token)).length;
  score += titleTokenCount * 90;
  if (titleTokenCount === tokens.length) score += 220;
  score += tokens.filter((token) => titleWords.some((word) => word.startsWith(token))).length * 30;
  score += tokens.filter((token) => fields.secondary.includes(token)).length * 12;
  if (item?.kind === "section") score += 5;
  return score;
}

export function searchDashboardItems(items, rawQuery, { limit = 12 } = {}) {
  const safeLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 12);
  if (!safeLimit) return [];

  const uniqueItems = [];
  const seenIds = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    uniqueItems.push(item);
  });

  const query = normalizeGlobalSearchText(rawQuery);
  if (!query) {
    return uniqueItems.filter((item) => item?.kind === "section").slice(0, safeLimit);
  }

  const tokens = query.split(" ").filter(Boolean);
  return uniqueItems
    .map((item, index) => ({ item, index, score: getSearchScore(item, query, tokens) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (
      right.score - left.score
      || String(left.item.title || "").localeCompare(String(right.item.title || ""))
      || left.index - right.index
    ))
    .slice(0, safeLimit)
    .map((entry) => entry.item);
}

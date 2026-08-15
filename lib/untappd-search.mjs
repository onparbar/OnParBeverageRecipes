function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeUntappdDescription(value) {
  return clean(
    String(value ?? "")
      .replace(/\\r\\n/g, " ")
      .replace(/\\[nr](?=\s|$|[-*•]|\d+[.)])/g, " ")
    .replace(/\\([A-Za-z0-9][^\\\r\n]{1,400})\\"/g, '"$1"')
      .replace(/\\"/g, '"'),
  );
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toOptionalNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeUntappdItem(item, context = {}) {
  const type = clean(item?.type).toLowerCase();
  const name = clean(item?.custom_name || item?.name || item?.original_name);
  const producer = clean(
    item?.custom_brewery
      || item?.brewery
      || item?.producer
      || item?.original_brewery,
  );
  const description = normalizeUntappdDescription(
    item?.custom_description
      || item?.description
      || item?.original_description,
  );
  const style = clean(
    item?.custom_style
      || item?.style
      || item?.category
      || item?.original_style,
  );
  const imageUrl = clean(
    item?.custom_label_image
      || item?.label_image_hd
      || item?.original_label_image_hd
      || item?.label_image
      || item?.default_image,
  );

  return {
    id: clean(item?.id || `${type}:${item?.untappd_id || name}`),
    untappdId: item?.untappd_id == null ? null : Number(item.untappd_id),
    name,
    type,
    producer,
    brewery: producer,
    description,
    style,
    category: clean(item?.category),
    abv: toOptionalNumber(item?.custom_abv ?? item?.abv ?? item?.original_abv),
    ibu: toOptionalNumber(item?.custom_ibu ?? item?.ibu ?? item?.original_ibu),
    imageUrl,
    rating: toOptionalNumber(item?.rating),
    carried: Boolean(context.carried),
    menuName: clean(context.menuName),
    sectionName: clean(context.sectionName),
    sourceName: context.carried ? "On Par Untappd menu" : "Untappd",
  };
}

export function isUntappdItemKind(item, kind) {
  if (kind === "beer") return item?.type === "beer" && !/^spirit\s*-/i.test(clean(item?.style));
  if (kind === "liquor") {
    return item?.type === "spirit"
      || (item?.type === "beer" && /^spirit\s*-/i.test(clean(item?.style)));
  }
  return false;
}

function scoreItem(item, query) {
  const normalizedQuery = normalize(query);
  const name = normalize(item.name);
  const producer = normalize(item.producer);
  const style = normalize(item.style);
  const haystack = `${name} ${producer} ${style}`.trim();
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactName = name.replace(/\s+/g, "");
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  let score = item.carried ? 100 : 0;

  if (name === normalizedQuery || compactName === compactQuery) score += 80;
  else if (name.startsWith(normalizedQuery) || compactName.startsWith(compactQuery)) score += 50;
  else if (name.includes(normalizedQuery) || compactName.includes(compactQuery)) score += 35;

  if (producer === normalizedQuery) score += 35;
  else if (producer.includes(normalizedQuery)) score += 20;

  score += queryWords.reduce((total, word) => {
    if (name.split(" ").includes(word)) return total + 8;
    if (haystack.includes(word)) return total + 3;
    return total;
  }, 0);

  if (item.rating != null) score += Math.min(5, item.rating);
  return score;
}

function mergeDuplicate(existing, item) {
  if (!existing) return item;
  const richness = (value) => (
    (value.carried ? 100 : 0)
    + ["producer", "description", "style", "imageUrl"]
      .filter((field) => clean(value[field])).length
    + ["abv", "ibu", "rating"]
      .filter((field) => value[field] != null).length
  );
  const preferred = richness(item) > richness(existing) ? item : existing;
  const fallback = preferred === existing ? item : existing;
  const menuNames = [existing.menuName, item.menuName].filter(Boolean);
  const sectionNames = [existing.sectionName, item.sectionName].filter(Boolean);
  return {
    ...fallback,
    ...Object.fromEntries(
      Object.entries(preferred).filter(([, value]) => value !== "" && value != null),
    ),
    carried: existing.carried || item.carried,
    menuName: [...new Set(menuNames)].join(", "),
    sectionName: [...new Set(sectionNames)].join(", "),
  };
}

export function buildUntappdSearchResults({
  globalItems = [],
  catalogItems = [],
  query,
  kind,
  limit = 10,
} = {}) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !["beer", "liquor"].includes(kind)) return [];

  const normalizedItems = [
    ...catalogItems.map((item) => (
      item?.sourceName
        ? { ...item, carried: true }
        : normalizeUntappdItem(item, { carried: true })
    )),
    ...globalItems.map((item) => (
      item?.sourceName
        ? item
        : normalizeUntappdItem(item)
    )),
  ].filter((item) => item.name && isUntappdItemKind(item, kind));

  const matchingItems = normalizedItems.filter((item) => {
    const haystack = normalize(`${item.name} ${item.producer} ${item.style}`);
    const compactHaystack = haystack.replace(/\s+/g, "");
    const compactQuery = normalizedQuery.replace(/\s+/g, "");
    return compactHaystack.includes(compactQuery)
      || normalizedQuery.split(" ").filter(Boolean).every((word) => haystack.includes(word));
  });

  const deduped = new Map();
  matchingItems.forEach((item) => {
    const normalizedName = normalize(item.name);
    const normalizedProducer = normalize(item.producer);
    const key = normalizedName && normalizedProducer
      ? `${item.type}:${normalizedName}:${normalizedProducer}`
      : item.untappdId
        ? `untappd:${item.untappdId}`
        : `${item.type}:${normalizedName}`;
    deduped.set(key, mergeDuplicate(deduped.get(key), item));
  });

  return [...deduped.values()]
    .sort((a, b) => scoreItem(b, query) - scoreItem(a, query) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}

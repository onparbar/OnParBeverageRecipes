const NUMBER_WORDS = Object.freeze({
  zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});
const NUMBER_TOKENS = new Set([...Object.keys(NUMBER_WORDS), "hundred", "point"]);

export function normalizeSpeechInventoryText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/-/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(schnapps)(?:\s+\1)+\b/g, "$1")
    .replace(/\btito\s+s\b/g, "titos")
    .replace(/\bmaker\s+s\s+mark\b/g, "makers mark")
    .replace(/\babsolute\s+citron\b/g, "absolut citron")
    .replace(/\bgym\s+beam\b/g, "jim beam")
    .replace(/\bcream\s+to\s+cacao\b/g, "creme de cacao")
    .replace(/\bsweet\s+and\s+sour\b/g, "sour mix")
    .replace(/\b(?:corbell?|korbell?)\s+brew\b/g, "korbel brut")
    .replace(/\bfor\s+(?=bacardi\b)/g, "four ")
    .replace(/\bto\s+(?=makers\s+mark\b)/g, "two ")
    .replace(/\b(?:course|cores)\b/g, "coors")
    .replace(/\bmiller\s+light\b/g, "miller lite")
    .replace(/\bpaps?\s+blue\s+ribbon\b/g, "pabst blue ribbon")
    .replace(/\b(?:scentsy|sensei|cincinnati)\s+light\b/g, "cincy light")
    .replace(/\bdortmund+er\b/g, "dortmunder")
    .replace(/\bgarage\s+(?:rear|bear|we\s+are)\s+regular\b/g, "regular garage beer")
    .replace(/\bgarage\s+for\s+(?:your|you)\s+lime\b/g, "garage beer lime")
    .replace(/\bgarage\s+beer\s+(?:line|lion)\b/g, "garage beer lime")
    .replace(/\bvoodoo\s+(?:ranger\s+)?juicy\s+hayes\b/g, "voodoo juicy haze")
    .replace(/\bwashington\s+apple(?:\s+schnapps)+\b/g, "washington apple")
    .replace(/\bmich(?:\s+club)?\s+ultra\b/g, "michelob ultra")
    .replace(/\bspike\s+strawberry\s+lemonade\b/g, "spiked strawberry lemonade")
    .replace(/\bblue\s+berry\s+margarita\b/g, "blueberry margarita")
    .replace(/\b(?:okay\s+)?i\s+have\b/g, " ")
    .replace(/\bwhiskey\s+smash\b(?!\s+jim\s+beam\b)/g, "whiskey smash jim beam")
    .replace(/\bspiked\s+strawberry\s+lemonade\b(?!\s+titos\b)/g, "spiked strawberry lemonade titos")
    .trim();
}

export function parseSpokenInventoryNumber(value) {
  const normalized = normalizeSpeechInventoryText(value);
  if (!normalized) return null;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  const tokens = normalized.split(" ");
  if (!tokens.every((token) => NUMBER_TOKENS.has(token) || /^\d+$/.test(token))) return null;
  let current = 0;
  let decimal = "";
  let afterPoint = false;
  for (const token of tokens) {
    if (token === "point") {
      if (afterPoint) return null;
      afterPoint = true;
      continue;
    }
    const number = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
    if (afterPoint) {
      if (!Number.isFinite(number) || number > 9) return null;
      decimal += String(number);
    } else if (token === "hundred") {
      current = Math.max(1, current) * 100;
    } else if (Number.isFinite(number)) {
      current += number;
    } else {
      return null;
    }
  }
  return Number(`${current}${decimal ? `.${decimal}` : ""}`);
}

function catalogAliases(item) {
  const normalizedName = normalizeSpeechInventoryText(item.name);
  const suppliedAliases = [item.name, ...(item.aliases || [])]
    .map(normalizeSpeechInventoryText)
    .filter(Boolean);
  const tapSuffixlessAliases = suppliedAliases
    .map((alias) => alias.replace(/\s+[123]$/, "").trim())
    .filter(Boolean);
  const spokenAliases = [];
  if (normalizedName.includes("michelob ultra")) {
    spokenAliases.push("mic ultra", "mick ultra", "mich ultra", "mitch ultra", "mc ultra", "m c ultra", "mcultra");
  }
  if (normalizedName.includes("pabst blue ribbon")) spokenAliases.push("pbr");
  if (normalizedName.includes("coors light")) spokenAliases.push("coors");
  if (normalizedName.includes("kona big wave")) spokenAliases.push("kona");
  if (normalizedName.includes("garage beer lime")) spokenAliases.push("garage lime");
  if (normalizedName.includes("voodoo ranger juicy haze")) spokenAliases.push("voodoo juicy haze", "juicy haze");
  if (normalizedName.includes("dortmunder gold")) spokenAliases.push("dortmunder", "dortmunder gold");
  if (normalizedName.includes("guinness draught")) spokenAliases.push("guinness");
  if (normalizedName.includes("triple jam cider")) spokenAliases.push("triple jam");
  if (normalizedName.includes("truly wild berry")) spokenAliases.push("truly");
  if (normalizedName.includes("astra red cream soda")) spokenAliases.push("astra");
  if (normalizedName.includes("boozy cucumber lemonade")) spokenAliases.push("boozy cucumber");
  if (normalizedName.includes("bulleit bourbon")) spokenAliases.push("bulleit", "bullet");
  if (normalizedName === "crown royal") spokenAliases.push("crown");
  if (normalizedName.includes("svedka blue raspberry")) spokenAliases.push("svedka");
  if (normalizedName.includes("jose cuervo silver")) spokenAliases.push("jose", "cuervo");
  if (normalizedName.includes("ketel one cucumber")) spokenAliases.push("ketel one");
  if (normalizedName.includes("absolut citron")) spokenAliases.push("absolute citron");
  if (normalizedName.includes("jack daniel")) spokenAliases.push("jack daniels");
  if (normalizedName.includes("jim beam")) spokenAliases.push("gym beam");
  if (normalizedName.includes("raspberry schnapps")) spokenAliases.push("raspberry");
  if (normalizedName.includes("pomegranate schnapps")) spokenAliases.push("pomegranate");
  if (normalizedName.includes("strawberry schnapps")) spokenAliases.push("strawberry");
  if (normalizedName.includes("peach schnapps")) spokenAliases.push("peach");
  if (normalizedName.includes("blueberry schnapps")) spokenAliases.push("blueberry");
  if (normalizedName.includes("watermelon schnapps")) spokenAliases.push("watermelon");
  if (normalizedName.includes("apple schnapps")) spokenAliases.push("apple");
  if (normalizedName.includes("lime juice")) spokenAliases.push("lime");
  if (normalizedName.includes("creme de cacao")) spokenAliases.push("cream to cacao", "cream de cacao");
  if (normalizedName.includes("sour mix")) spokenAliases.push("sweet and sour");
  if (normalizedName.includes("korbel brut")) spokenAliases.push("corbell brew", "korbel");
  if (normalizedName.includes("angry orchard")) spokenAliases.push("apple", "apple cider");
  if (normalizedName.includes("sour monkey")) spokenAliases.push("sour mix");
  return [...new Set([...suppliedAliases, ...tapSuffixlessAliases, ...spokenAliases]
    .filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

export function buildSpeechInventoryCatalog(items = []) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    if (!id || !name) return [];
    return [{
      id,
      name,
      target: item.target === "keg" ? "keg" : "inventory",
      group: String(item.group || item.wall || "Inventory").trim(),
      wall: String(item.wall || "").trim(),
      unit: String(item.unit || (item.target === "keg" ? "kegs" : "units")).trim(),
      packSize: Math.max(1, Math.round(Number(item.packSize) || 1)),
      currentValue: item.currentValue == null ? "" : String(item.currentValue),
      aliases: catalogAliases(item),
    }];
  });
}

function findAliasOccurrences(text, catalog) {
  const matches = [];
  catalog.forEach((item) => item.aliases.forEach((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g");
    let match;
    while ((match = pattern.exec(text))) {
      matches.push({ start: match.index + match[1].length, end: match.index + match[0].length, alias });
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    }
  }));
  matches.sort((left, right) => left.start - right.start || right.alias.length - left.alias.length);
  const selected = [];
  matches.forEach((match) => {
    if (selected.some((entry) => match.start >= entry.start && match.start < entry.end)) return;
    selected.push(match);
  });
  return selected.sort((left, right) => left.start - right.start);
}

function findSpokenQuantityStart(value) {
  const tokens = [...String(value || "").matchAll(/[a-z0-9.]+/g)];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index][0];
    if (!NUMBER_TOKENS.has(token) && !/^\d+(?:\.\d+)?$/.test(token)) continue;
    let end = index + 1;
    while (end < tokens.length) {
      const next = tokens[end][0];
      if (!NUMBER_TOKENS.has(next) && !/^\d+(?:\.\d+)?$/.test(next)) break;
      end += 1;
    }
    const quantity = parseSpokenInventoryNumber(tokens.slice(index, end).map((entry) => entry[0]).join(" "));
    if (quantity !== null && quantity <= 500) return tokens[index].index;
  }
  return null;
}

function findQuantityClauseStarts(value, catalog) {
  const text = String(value || "");
  const aliasRanges = findAliasOccurrences(text, catalog);
  const tokens = [...text.matchAll(/[a-z0-9.]+/g)];
  const starts = [];
  let inQuantity = false;
  tokens.forEach((token) => {
    const protectedByProduct = aliasRanges.some((range) => token.index >= range.start && token.index < range.end);
    const numeric = NUMBER_TOKENS.has(token[0]) || /^\d+(?:\.\d+)?$/.test(token[0]);
    if (protectedByProduct || !numeric) {
      inQuantity = false;
      return;
    }
    if (!inQuantity) starts.push(token.index);
    inQuantity = true;
  });
  return starts;
}

function findIncrementStart(value) {
  const match = String(value || "").match(/(?:^|\s)((?:(?:okay|ok|and|then)\s+)*(?:i\s+(?:need|want)\s+to\s+)?(?:oh\s+)?(?:whoops|oops)?\s*(?:please\s+)?(?:add\s+(?:another|one\s+more)|plus\s+(?:another|one)))\s*$/);
  if (!match) return null;
  return match.index + match[0].indexOf(match[1]);
}

function splitQuantityFirstTranscript(transcript, catalog) {
  const text = normalizeSpeechInventoryText(transcript);
  const matches = findAliasOccurrences(text, catalog);
  const quantityStarts = findQuantityClauseStarts(text, catalog);
  if (quantityStarts.length >= 2 && quantityStarts[0] <= (matches[0]?.start ?? text.length)) {
    const incrementStarts = matches.flatMap((match, index) => {
      const gapStart = index ? matches[index - 1].end : 0;
      const localStart = findIncrementStart(text.slice(gapStart, match.start));
      return localStart === null ? [] : [gapStart + localStart];
    });
    const clauseStarts = [...new Set([...quantityStarts, ...incrementStarts])]
      .sort((left, right) => left - right);
    return clauseStarts.map((start, index) => text
      .slice(start, clauseStarts[index + 1] ?? text.length)
      .trim())
      .filter(Boolean);
  }
  if (matches.length < 2) return null;
  const starts = matches.map((match, index) => {
    const gapStart = index ? matches[index - 1].end : 0;
    const gap = text.slice(gapStart, match.start);
    const localStart = findIncrementStart(gap) ?? findSpokenQuantityStart(gap);
    return localStart === null ? null : gapStart + localStart;
  });
  const supported = starts.filter((start) => start !== null).length;
  if (starts[0] === null || supported < Math.ceil(matches.length * 0.75)) return null;
  const resolvedStarts = starts.map((start, index) => start ?? matches[index].start);
  return resolvedStarts.map((start, index) => text
    .slice(start, resolvedStarts[index + 1] ?? text.length)
    .trim())
    .filter(Boolean);
}

function splitTranscript(transcript, catalog) {
  const quantityFirst = splitQuantityFirstTranscript(transcript, catalog);
  if (quantityFirst) return quantityFirst;
  return String(transcript || "")
    .split(/[,;\n.]+/)
    .flatMap((rawPart) => {
      const part = normalizeSpeechInventoryText(rawPart);
      if (!part) return [];
      const matches = findAliasOccurrences(part, catalog);
      if (matches.length < 2) return [part];
      const leadingQuantity = parseSpokenInventoryNumber(part.slice(0, matches[0].start).trim());
      if (leadingQuantity !== null && leadingQuantity <= 500) {
        const starts = matches.map((match, index) => {
          const searchStart = index === 0 ? 0 : matches[index - 1].end;
          const prefix = part.slice(searchStart, match.start);
          const quantityMatch = prefix.match(/(?:^|\s)((?:(?:zero|no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|\d+(?:\.\d+)?)\s*)+)$/);
          if (!quantityMatch) return match.start;
          const quantityOffset = prefix.lastIndexOf(quantityMatch[1]);
          return searchStart + Math.max(0, quantityOffset);
        });
        return starts.map((start, index) => part.slice(start, starts[index + 1] ?? part.length).trim()).filter(Boolean);
      }
      return matches.map((match, index) => {
        const start = index === 0 ? 0 : match.start;
        const end = matches[index + 1]?.start ?? part.length;
        return part.slice(start, end).trim();
      }).filter(Boolean);
    });
}

function stripListLeadIn(value) {
  return String(value || "")
    .replace(/^(?:(?:okay|ok|so|and|then)\s+)*/, "")
    .replace(/^(?:(?:i|we)\s+(?:have|got)|there\s+(?:is|are))\s+/, "")
    .trim();
}

function extractQuantityAndProduct(clause, catalog = []) {
  let text = stripListLeadIn(normalizeSpeechInventoryText(clause))
    .replace(/^(?:oh\s+)?(?:whoops|oops)\s+/, "")
    .replace(/^(?:i\s+(?:need|want)\s+to\s+)?(?:oh\s+)?(?:whoops|oops)?\s*(?:please\s+)?(?:add\s+(?:another|one\s+more)|plus\s+(?:another|one))\s+/, "one ")
    .replace(/\bfor now\b/g, " ")
    .replace(/\bon hand\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const unitMatch = text.match(/\b(cases?|bottles?|kegs?|units?|ounces?|oz)\b/);
  const rawUnit = unitMatch?.[1] || "";
  const unit = /^(?:ounce|ounces|oz)$/.test(rawUnit) ? "oz" : rawUnit.replace(/s$/, "") || "unit";
  text = text.replace(/\b(cases?|bottles?|kegs?|units?|ounces?|oz)\b/g, " ").replace(/\s+/g, " ").trim();
  const noMatch = text.match(/^(?:i have\s+)?no\s+(.+)$/);
  if (noMatch) return { product: noMatch[1], quantity: 0, unit };
  const markerMatch = [...text.matchAll(/\b(to|is|has)\b/g)].pop();
  if (markerMatch) {
    const product = text.slice(0, markerMatch.index).replace(/^(change|set|i have)\s+/, "").trim();
    const quantity = parseSpokenInventoryNumber(
      text.slice(markerMatch.index + markerMatch[0].length)
        .replace(/\b(main|patio|karaoke)(?: wall)?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (quantity !== null) return { product, quantity, unit };
  }
  const productMatches = findAliasOccurrences(text, catalog);
  if (productMatches.length) {
    const productMatch = [...productMatches].sort((left, right) => right.alias.length - left.alias.length)[0];
    const wall = text.match(/\b(main|patio|karaoke)(?: wall)?\b/)?.[1] || "";
    const quantityOnly = (value) => normalizeSpeechInventoryText(value)
      .replace(/\b(main|patio|karaoke)(?: wall)?\b/g, " ")
      .replace(/^(actually make|make|change|set|i have|have|of|for)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    const beforeQuantity = parseSpokenInventoryNumber(quantityOnly(text.slice(0, productMatch.start)));
    const afterQuantity = parseSpokenInventoryNumber(quantityOnly(text.slice(productMatch.end)));
    const recognizedQuantity = beforeQuantity !== null ? beforeQuantity : afterQuantity;
    if (recognizedQuantity !== null && recognizedQuantity <= 500) {
      return {
        product: `${productMatch.alias}${wall ? ` ${wall} wall` : ""}`,
        quantity: recognizedQuantity,
        unit,
      };
    }
  }
  const tokens = text.split(" ");
  let quantityStart = tokens.length;
  while (quantityStart > 0) {
    const token = tokens[quantityStart - 1];
    if (NUMBER_TOKENS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) quantityStart -= 1;
    else break;
  }
  const quantity = parseSpokenInventoryNumber(tokens.slice(quantityStart).join(" "));
  const product = tokens.slice(0, quantityStart).join(" ")
    .replace(/^(actually make|make|change|set|i have|have)\s+/, "")
    .trim();
  if (quantity === null) {
    let quantityEnd = 0;
    while (quantityEnd < tokens.length) {
      const token = tokens[quantityEnd];
      if (NUMBER_TOKENS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) quantityEnd += 1;
      else break;
    }
    const leadingQuantity = parseSpokenInventoryNumber(tokens.slice(0, quantityEnd).join(" "));
    const leadingProduct = tokens.slice(quantityEnd).join(" ")
      .replace(/^(of|for)\s+/, "")
      .trim();
    if (leadingQuantity !== null && leadingQuantity <= 500 && leadingProduct) {
      return { product: leadingProduct, quantity: leadingQuantity, unit };
    }
  }
  return { product, quantity, unit };
}

function extractSharedWallContext(transcript) {
  const source = String(transcript || "");
  const patterns = [
    /\b(?:this|the)?\s*(?:whole\s+)?list\s+(?:is\s+)?for\s+(?:the\s+)?(main|patio|karaoke)(?:\s+wall)?\b/i,
    /\b(?:everything|all\s+of\s+(?:this|these)|these)\s+(?:is|are)\s+for\s+(?:the\s+)?(main|patio|karaoke)(?:\s+wall)?\b/i,
    /^\s*(?:this\s+is\s+)?for\s+(?:the\s+)?(main|patio|karaoke)(?:\s+wall)?\b[\s:,-]*/i,
    /^\s*(main|patio|karaoke)(?:\s+wall)?(?:\s+(?:list|inventory|count))?\b[\s:,-]*/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return { wall: match[1].toLowerCase(), transcript: source.replace(match[0], " ") };
  }
  return { wall: "", transcript: source };
}

function matchProduct(productText, unit, catalog) {
  const product = normalizeSpeechInventoryText(productText);
  const requestedWall = product.match(/\b(main|patio|karaoke)(?: wall)?\b/)?.[1] || "";
  const withoutWall = product.replace(/\b(main|patio|karaoke)(?: wall)?\b/g, " ").replace(/\s+/g, " ").trim();
  const target = unit === "keg" || unit === "oz" ? "keg" : unit === "bottle" || unit === "case" ? "inventory" : "";
  const candidates = catalog.flatMap((item) => {
    if (target && item.target !== target) return [];
    if (requestedWall && item.target === "keg" && normalizeSpeechInventoryText(item.wall) !== requestedWall) return [];
    const canonicalName = normalizeSpeechInventoryText(item.name).replace(/\s+[123]$/, "").trim();
    if (withoutWall === canonicalName) return [{ item, score: 2000 + canonicalName.length }];
    const score = Math.max(...item.aliases.map((alias) => {
      if (withoutWall === alias) return 1000 + alias.length;
      if (withoutWall.includes(alias) || alias.includes(withoutWall)) return 500 + Math.min(alias.length, withoutWall.length);
      return 0;
    }), 0);
    return score ? [{ item, score }] : [];
  }).sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name));
  if (!candidates.length) return { status: "unmatched", candidates: [] };
  const best = candidates.filter((candidate) => candidate.score === candidates[0].score);
  if (best.length > 1) return { status: "ambiguous", candidates: best.map((candidate) => candidate.item) };
  return { status: "matched", item: best[0].item, confidence: best[0].score >= 1000 ? "high" : "medium", candidates: [best[0].item] };
}

function resolveContextualAmbiguities(proposals, catalog, sharedWall) {
  const itemsById = new Map(catalog.map((item) => [item.id, item]));
  const wallCounts = proposals.reduce((counts, proposal) => {
    if (proposal.status !== "matched") return counts;
    const wall = normalizeSpeechInventoryText(itemsById.get(proposal.matchedId)?.wall);
    if (wall) counts.set(wall, (counts.get(wall) || 0) + 1);
    return counts;
  }, new Map());
  const rankedWalls = [...wallCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const inferredWall = sharedWall || (
    rankedWalls[0]?.[1] >= 2 && rankedWalls[0][1] > (rankedWalls[1]?.[1] || 0)
      ? rankedWalls[0][0]
      : ""
  );
  proposals.forEach((proposal, proposalIndex) => {
    if (proposal.status !== "ambiguous" || proposal.candidateIds.length < 2) return;
    const candidates = proposal.candidateIds.map((id) => itemsById.get(id)).filter(Boolean);
    const scored = candidates.map((candidate) => {
      let score = 0;
      let evidence = 0;
      proposals.forEach((neighbor, neighborIndex) => {
        if (neighborIndex === proposalIndex || neighbor.status !== "matched") return;
        const neighborItem = itemsById.get(neighbor.matchedId);
        const distance = Math.abs(neighborIndex - proposalIndex);
        if (distance > 2) return;
        const weight = distance === 1 ? 2 : 1;
        if (candidate.target === neighbor.target) {
          score += 2 * weight;
          evidence += 1;
        }
        if (normalizeSpeechInventoryText(candidate.group) === normalizeSpeechInventoryText(neighbor.group)) {
          score += 3 * weight;
          evidence += 1;
        }
        if (candidate.wall && normalizeSpeechInventoryText(candidate.wall) === normalizeSpeechInventoryText(neighborItem?.wall)) {
          score += 4 * weight;
          evidence += 1;
        }
      });
      if (inferredWall && candidate.target === "keg" && normalizeSpeechInventoryText(candidate.wall) === inferredWall) {
        score += sharedWall ? 8 : 5;
        evidence += 1;
      }
      return { candidate, score, evidence };
    }).sort((left, right) => right.score - left.score || right.evidence - left.evidence || left.candidate.name.localeCompare(right.candidate.name));
    if (!scored.length || scored[0].score <= scored[1]?.score || scored[0].evidence === 0) return;
    const selected = scored[0].candidate;
    Object.assign(proposal, {
      status: "matched",
      matchedId: selected.id,
      matchedName: selected.name,
      target: selected.target,
      group: selected.group,
      wall: selected.wall,
      unit: selected.unit,
      confidence: "medium",
      warning: "",
      contextualMatch: true,
    });
    if (proposal.spokenUnit === "case") proposal.quantity *= selected.packSize;
  });
}

export function parseInventoryTranscript(transcript, sourceItems = []) {
  const catalog = buildSpeechInventoryCatalog(sourceItems);
  const sharedContext = extractSharedWallContext(transcript);
  const proposals = [];
  splitTranscript(sharedContext.transcript, catalog).forEach((rawClause, index) => {
    const clause = sharedContext.wall && !/\b(main|patio|karaoke)(?: wall)?\b/.test(rawClause)
      ? `${rawClause} ${sharedContext.wall} wall`
      : rawClause;
    const actionableClause = stripListLeadIn(normalizeSpeechInventoryText(clause));
    const skipped = /^(skip|leave)\b/.test(actionableClause);
    const correction = /^(actually|change|set)\b/.test(actionableClause);
    const increment = /^(?:i\s+(?:need|want)\s+to\s+)?(?:oh\s+)?(?:whoops|oops)?\s*(?:please\s+)?(?:add\s+(?:another|one\s+more)|plus\s+(?:another|one))\b/.test(actionableClause);
    const extracted = extractQuantityAndProduct(clause.replace(/^(skip|leave)\s+/, ""), catalog);
    if (correction && /^(actually make|change|set)\s+that\b/.test(clause)) {
      const prior = [...proposals].reverse().find((proposal) => proposal.status === "matched");
      if (prior && extracted.quantity !== null) {
        prior.quantity = extracted.quantity;
        prior.phrase = clause;
        prior.corrected = true;
        return;
      }
    }
    const match = matchProduct(extracted.product, extracted.unit, catalog);
    const proposal = {
      id: `speech-${index + 1}`,
      phrase: clause,
      status: skipped ? "skipped" : match.status,
      matchedId: match.item?.id || "",
      matchedName: match.item?.name || "",
      target: match.item?.target || "",
      group: match.item?.group || "",
      wall: match.item?.wall || "",
      quantity: extracted.quantity,
      spokenUnit: extracted.unit,
      unit: match.item?.unit || extracted.unit,
      confidence: match.confidence || "review",
      candidateIds: (match.candidates || []).map((item) => item.id),
      warning: extracted.quantity === null ? "Quantity not recognized" : match.status === "ambiguous" ? "Choose one product" : match.status === "unmatched" ? "Product not recognized" : "",
    };
    if (proposal.status === "matched" && proposal.spokenUnit === "case") {
      proposal.quantity *= match.item.packSize;
      proposal.unit = match.item.unit;
    }
    const duplicateIndex = proposal.matchedId
      ? proposals.findIndex((entry) => entry.matchedId === proposal.matchedId && entry.status === "matched")
      : -1;
    if (duplicateIndex >= 0 && increment) {
      const prior = proposals[duplicateIndex];
      const priorQuantity = Number(prior.quantity);
      const addedQuantity = Number(proposal.quantity);
      proposals[duplicateIndex] = {
        ...prior,
        phrase: `${prior.phrase}; ${clause}`,
        quantity: Number.isFinite(priorQuantity) && Number.isFinite(addedQuantity)
          ? priorQuantity + addedQuantity
          : prior.quantity,
        corrected: true,
      };
    } else if (duplicateIndex >= 0) {
      proposals[duplicateIndex] = { ...proposal, corrected: true };
    } else if (increment && proposal.status === "matched") {
      const currentQuantity = Number(match.item.currentValue);
      const addedQuantity = Number(proposal.quantity);
      proposals.push(Number.isFinite(currentQuantity) && Number.isFinite(addedQuantity)
        ? {
          ...proposal,
          quantity: currentQuantity + addedQuantity,
          confidence: "medium",
          warning: "",
          incrementedFromCurrent: true,
        }
        : {
          ...proposal,
          quantity: null,
          confidence: "review",
          warning: "Enter the current count before adding another",
        });
    } else proposals.push(proposal);
  });
  resolveContextualAmbiguities(proposals, catalog, sharedContext.wall);
  return { transcript: String(transcript || ""), catalog, proposals };
}

export function buildSpeechInventoryChanges(proposals = []) {
  return (Array.isArray(proposals) ? proposals : []).flatMap((proposal) => {
    const quantity = Number(proposal?.quantity);
    if (proposal?.status !== "matched" || !proposal.matchedId || !Number.isFinite(quantity) || quantity < 0) return [];
    return [{ id: proposal.matchedId, target: proposal.target === "keg" ? "keg" : "inventory", value: String(quantity) }];
  });
}

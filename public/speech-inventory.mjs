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
  const spokenAliases = [];
  if (normalizedName.includes("michelob ultra")) {
    spokenAliases.push("mic ultra", "mick ultra", "mich ultra", "mc ultra", "m c ultra", "mcultra");
  }
  if (normalizedName.includes("apple") || normalizedName.includes("angry orchard")) spokenAliases.push("apple");
  if (normalizedName.includes("angry orchard")) spokenAliases.push("apple cider");
  if (normalizedName.includes("sour monkey")) spokenAliases.push("sour mix");
  return [...new Set([item.name, ...(item.aliases || []), ...spokenAliases]
    .map(normalizeSpeechInventoryText)
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

function splitTranscript(transcript, catalog) {
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

function extractQuantityAndProduct(clause, catalog = []) {
  let text = normalizeSpeechInventoryText(clause)
    .replace(/^(?:oh\s+)?(?:whoops|oops)\s+/, "")
    .replace(/^(?:please\s+)?add\s+(?:another|one\s+more)\s+/, "one ")
    .replace(/^plus\s+(?:another|one)\s+/, "one ")
    .replace(/\bfor now\b/g, " ")
    .replace(/\bon hand\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const unitMatch = text.match(/\b(cases?|bottles?|kegs?|units?)\b/);
  const unit = unitMatch ? unitMatch[1].replace(/s$/, "") : "unit";
  text = text.replace(/\b(cases?|bottles?|kegs?|units?)\b/g, " ").replace(/\s+/g, " ").trim();
  const noMatch = text.match(/^i have no\s+(.+)$/);
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
  const target = unit === "keg" ? "keg" : unit === "bottle" || unit === "case" ? "inventory" : "";
  const candidates = catalog.flatMap((item) => {
    if (target && item.target !== target) return [];
    if (requestedWall && item.target === "keg" && normalizeSpeechInventoryText(item.wall) !== requestedWall) return [];
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
  proposals.forEach((proposal, proposalIndex) => {
    if (proposal.status !== "ambiguous" || proposal.candidateIds.length < 2) return;
    const candidates = proposal.candidateIds.map((id) => itemsById.get(id)).filter(Boolean);
    const scored = candidates.map((candidate) => {
      let score = 0;
      let evidence = 0;
      proposals.forEach((neighbor, neighborIndex) => {
        if (neighborIndex === proposalIndex || neighbor.status !== "matched") return;
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
      });
      if (sharedWall && candidate.target === "keg" && normalizeSpeechInventoryText(candidate.wall) === sharedWall) {
        score += 2;
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
    const skipped = /^(skip|leave)\b/.test(clause);
    const correction = /^(actually|change|set)\b/.test(clause);
    const increment = /^(?:oh\s+)?(?:whoops|oops)?\s*(?:please\s+)?(?:add\s+(?:another|one\s+more)|plus\s+(?:another|one))\b/.test(clause);
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
      proposals.push({
        ...proposal,
        quantity: null,
        confidence: "review",
        warning: "Say the original count first, then add another",
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

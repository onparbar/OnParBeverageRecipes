import { normalizeDashboardQuestion, searchDashboardItems } from "./global-dashboard-search.mjs";
import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";

export const BEVERAGE_QUESTION_EXAMPLES = [
  ["Usage", ["How much Angry Orchard have we poured in the last 3 weeks?", "Average beer usage last 8 weeks", "How many kegs of Miller Lite did we pour last week?", "What had zero pours last week?"]],
  ["Compare & trends", ["Compare Angry Orchard and Miller Lite last 4 weeks", "Compare main and karaoke walls last 6 weeks", "What is growing fastest?", "Is Angry Orchard declining?", "What was our busiest week in the last 8 weeks?"]],
  ["Pricing & recipes", ["Top 5 cocktails by profit last 6 weeks", "Lowest profit margin last week", "What is the keg cost of Corona?", "Who supplies Miller Lite?", "Which recipes use Tito's?", "What is in Blue Dot?", "What does a batch of Blue Dot cost?"]],
  ["Stock & planning", ["How many bottles of Tito's are on hand?", "What do we need to order?", "Why do we need to order Tito's?", "Which counts are missing?", "Which taps are empty?", "What is the level of tap 24?", "Are my changes saved?", "What if beer demand is 25% higher?"]],
];

const fmt = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const known = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const positive = (value) => known(value) && Number(value) > 0;
const total = (values) => values.reduce((sum, value) => sum + value, 0);
const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const words = "a an the how much many what whats which who where when why is are was were has have had do did does can could would you we i our my us me please tell show find about of for to from in on at by during over across last past recent previous prior week weeks weekly total average avg combined overall altogether poured pour pours volume usage ounces ounce oz kegs keg pints pint gallons gallon beer beers cocktail cocktails liquor liquors drink drinks beverage beverages wall walls main karaoke patio compare compared comparison versus vs and or between with than busiest slowest highest lowest peak high low top bottom most least more less growing growth gaining increasing declining falling dropping fastest trending trend changed change doing doing better worse now then per sales revenue estimated projected gross profit profits margin cost costs price prices bottle bottles package supplier supplies supplied vendor buy buying purchased purchase order ordering need needs needed enough stock inventory cabinet liquor mixer current currently left level levels tap taps full empty nearly out zero no recorded batch recipe recipes ingredients ingredient contains contain uses use using made make into missing uncounted received count counts saved pending changes save failed status sync connection pmb percent percentage share mix explanation explain calculation percent rise risen dropped increased decreased strongest weakest expensive cheapest expensive expensive";
const ignored = new Set(words.split(" "));
const answer = (title, text, rows = [], notes = []) => ({ title, text, rows: rows.slice(0, 40), notes: [...notes, ...(rows.length > 40 ? [`Showing 40 of ${rows.length} matching records.`] : [])] });
const question = (text) => answer("One quick question", text);

function nameTerms(query) {
  return query.split(" ").filter((word) => word && !ignored.has(word) && !/^\d+$/.test(word)).join(" ");
}

function select(items, query, { allowAll = true } = {}) {
  const tap = query.match(/\btap\s+(\d+)\b/);
  const walls = ["main", "karaoke", "patio"].filter((wall) => new RegExp(`\\b${wall}\\b`).test(query));
  const categories = ["beer", "cocktail", "liquor"].filter((category) => new RegExp(`\\b${category}s?\\b`).test(query));
  let available = items.filter((item) => (!tap || Number(item.tapNumber) === Number(tap[1]))
    && (!walls.length || !item.wall || walls.includes(normalizeDashboardQuestion(item.wall).replace(/ wall$/, "")))
    && (!categories.length || !item.category || categories.includes(item.category)));
  const cleaned = query.replace(/\b(?:last|past|recent|previous|prior)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+weeks?\b/g, " ");
  const names = cleaned.split(/\b(?:versus|vs|and)\b/).map(nameTerms).filter(Boolean);
  if (!names.length) return { items: allowAll || tap ? available : [], unmatched: false };
  const matching = new Map();
  for (const name of names) {
    const matches = searchDashboardItems(available.map((item, index) => ({
      ...item, id: String(index), title: item.name, searchText: item.aliases || [], section: "",
    })), name, { limit: available.length });
    if (!matches.length) return { items: [], unmatched: true };
    matches.forEach((item) => matching.set(item.id, available[Number(item.id)]));
  }
  return { items: [...matching.values()], unmatched: false };
}

function getWindow(query, labels, trend) {
  const match = query.match(/\b(?:last|past|recent)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+weeks?\b/);
  const weeks = match ? wordNumbers[match[1]] || Number(match[1]) : /\blast week\b/.test(query) || trend ? 1 : 6;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) return { error: "Choose between 1 and 104 saved weeks." };
  if (/\b(?:this|current) week\b/.test(query)) return { error: "This week is still in progress. Ask for last week or a number of completed saved weeks for a comparable result." };
  if (/\b(?:today|yesterday|month|year|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(query)) {
    return { error: "This search uses saved weekly reports. Which completed week or how many saved weeks should I use?" };
  }
  const offset = /\b(?:previous week|week before last)\b/.test(query) && !trend ? 1 : 0;
  return { weeks, labels: labels.slice(offset, offset + weeks), prior: labels.slice(offset + weeks, offset + 2 * weeks) };
}

function groupUsage(items, labels, grouping, metric) {
  const groups = new Map();
  for (const item of items) {
    const key = grouping === "wall" ? item.wall || "Unassigned wall" : grouping === "category" ? item.category || "Other" : normalizeDashboardQuestion(item.name).replace(/\s+[123]$/, "");
    if (!groups.has(key)) groups.set(key, { name: grouping === "product" ? item.name.replace(/\s+[123]$/, "") : key, rows: new Map() });
    const group = groups.get(key);
    for (const label of labels) {
      const entry = item.history.find((week) => week.label === label);
      const oz = entry?.ounces;
      const identity = `${item.tapNumber || item.id}|${normalizeDashboardQuestion(item.name)}|${label}`;
      let value = known(oz) ? Number(oz) : null;
      if (value !== null && metric === "profit") value = known(item.profitPerOz) ? value * item.profitPerOz : null;
      if (value !== null && metric === "sales") value = positive(item.sellingPricePerOz) ? value * item.sellingPricePerOz : null;
      if (value !== null && metric === "kegs") value = positive(item.kegOz) ? value / item.kegOz : null;
      const existing = group.rows.get(identity);
      if (existing && known(existing.value) && known(value) && Math.abs(existing.value - value) > 0.001) {
        group.rows.set(identity, { label, value: null, conflict: true });
      } else if (!existing || (!existing.conflict && !known(existing.value) && known(value))) {
        group.rows.set(identity, { label, value });
      }
    }
  }
  return [...groups.values()];
}

function usageAnswer(raw, query, context) {
  const trend = /\b(?:trend|trending|growing|gaining|declining|falling|dropping|increasing|changed|change|improved|improving|slowing|growth)\b/.test(query)
    || /\b(?:versus|vs|compared)\b.*\b(?:previous|prior|before)\b/.test(query);
  const peak = /\b(?:busiest|slowest|peak)\b|\b(?:highest|lowest|best|worst|high|low) week\b|\bweek (?:high|low)\b/.test(query);
  const compare = /\b(?:compare|comparison|versus|vs)\b/.test(query);
  const quantitative = /\b(?:how much|how many|total|average|avg|combined)\b/.test(query);
  const zeros = /\b(?:zero|no) (?:pours?|usage|volume)\b/.test(query);
  if (!trend && !peak && !compare && !quantitative && !zeros) return null;
  if (/\b(?:margin|percent|percentage|share)\b/.test(query)) return null;
  if (/\b(?:bottles?|drinks?|servings?)\b/.test(query) && /\bhow many\b/.test(query)) return question("Should I report ounces or keg equivalents? I cannot infer the number of servings or bottle sizes from poured volume.");
  if (/\d+[/-]\d+/.test(raw)) return question("Please use a completed saved-week window, such as last 3 weeks. Calendar-date ranges are not supported by this search yet.");
  const data = context.usage();
  const window = getWindow(query, data.labels, trend);
  if (window.error) return question(window.error);
  const selected = select(data.items, query);
  if (!selected.items.length) return question("Which product, tap, or wall should I use? Try a product name such as Angry Orchard or tap 24.");
  if (!window.labels.length) return answer("Usage unavailable", "There are no saved weekly reports available for this question.");
  const grouping = /\bwalls?\b/.test(query) && !nameTerms(query.replace(/\b(?:last|past|recent) \w+ weeks?\b/g, "")) ? "wall"
    : /\b(?:by category|categories|beer and cocktails)\b/.test(query) ? "category" : "product";
  const metric = /\bprofits?\b/.test(query) ? "profit" : /\b(?:sales|revenue)\b/.test(query) ? "sales" : /\bkegs?\b/.test(query) ? "kegs" : "ounces";
  const unit = metric === "kegs" ? "keg equivalents" : "oz";
  const display = (value) => metric === "profit" || metric === "sales" ? money(value) : `${fmt(value)} ${unit}`;
  const groups = groupUsage(selected.items, window.labels, grouping, metric);
  const notes = ["Source: saved PMB weekly usage. Missing, conflicting, or unverified readings are excluded, never assumed to be zero."];
  if (metric === "profit" || metric === "sales") notes.push("Estimates use current pricing, not historical price snapshots, actual POS sales, or net profit.");
  if (metric === "kegs") notes.push("Keg equivalents use each product's configured keg size; these are not a count of physical keg changes.");
  const period = `${window.labels[window.labels.length - 1]} through ${window.labels[0]}`;
  const missing = groups.some((group) => [...group.rows.values()].some((row) => row.value === null)) || window.labels.length < window.weeks;
  if (missing) notes.push("Coverage is partial. Totals below are recorded subtotals, not a complete count of all pours.");
  if (trend) {
    if (window.prior.length < window.weeks || window.labels.length < window.weeks) return answer("More history needed", `A fair comparison needs ${2 * window.weeks} saved weeks.`, [], notes);
    const prior = groupUsage(selected.items, window.prior, grouping, metric);
    const changes = groups.map((group, index) => {
      const before = prior[index];
      const pairs = [...group.rows.entries()].map(([key, row]) => {
        const labelIndex = window.labels.indexOf(row.label);
        const oldKey = key.slice(0, -row.label.length) + window.prior[labelIndex];
        return [row.value, before.rows.get(oldKey)?.value];
      }).filter(([current, previous]) => known(current) && known(previous));
      if (!pairs.length) return { name: group.name, text: "No comparable verified readings in both periods.", delta: null };
      const current = total(pairs.map(([value]) => value));
      const previous = total(pairs.map(([, value]) => value));
      const delta = current - previous;
      const percentage = previous > 0 ? `${fmt(Math.abs(delta / previous * 100))}% ${delta >= 0 ? "up" : "down"}` : current > 0 ? "up from zero; percentage change is undefined" : "unchanged at zero";
      return { name: group.name, delta, text: `${display(previous)} to ${display(current)}; ${percentage}. ${pairs.length}/${group.rows.size} comparable readings.` };
    });
    const declining = /\b(?:declining|falling|dropping|slowing|down)\b/.test(query);
    changes.sort((a, b) => (declining ? 1 : -1) * ((a.delta ?? 0) - (b.delta ?? 0)));
    return answer("Usage trend", `Latest ${window.weeks} saved week(s): ${period}. Compared with the preceding ${window.weeks} saved week(s).`, changes, [...notes, "Comparisons use only the same tap/product readings available in both windows."]);
  }
  if (peak) {
    const weeks = window.labels.map((label) => {
      const readings = groups.flatMap((group) => [...group.rows.values()].filter((row) => row.label === label));
      const values = readings.filter((row) => known(row.value));
      return { name: label, value: values.length ? total(values.map((row) => row.value)) : null, complete: values.length === readings.length, text: "" };
    });
    const complete = weeks.filter((week) => week.complete && week.value !== null);
    const low = /\b(?:slowest|lowest|worst|low)\b/.test(query);
    complete.sort((a, b) => (low ? 1 : -1) * (a.value - b.value));
    if (!complete.length) return answer("Cannot establish a peak week", "None of the requested weeks has complete verified coverage for these products.", [], notes);
    return answer(low ? "Lowest recorded week" : "Highest recorded week", `${complete[0].name}: ${display(complete[0].value)} across the selected products.`, complete.map((week) => ({ name: week.name, text: display(week.value) })), [...notes, "Only fully covered weeks are ranked; missing weeks could change the result."]);
  }
  const average = /\b(?:average|avg|per week|weekly)\b/.test(query);
  const rows = groups.map((group) => {
    const readings = [...group.rows.values()];
    const values = readings.filter((row) => known(row.value));
    const completeWeeks = window.labels.filter((label) => readings.filter((row) => row.label === label).every((row) => known(row.value)));
    const included = average ? values.filter((row) => completeWeeks.includes(row.label)) : values;
    const value = included.length ? total(included.map((row) => row.value)) / (average ? completeWeeks.length : 1) : null;
    return { name: group.name, value, verifiedZero: values.length === readings.length && window.labels.length === window.weeks && value === 0,
      text: value === null ? "No verified usage available." : `${display(value)}${average ? " per week" : " total"}; ${values.length}/${readings.length} verified readings${average ? `, ${completeWeeks.length} fully covered weeks` : ""}.` };
  });
  if (zeros) {
    const zeroRows = rows.filter((row) => row.verifiedZero);
    return answer("Verified zero usage", zeroRows.length ? `${zeroRows.length} products have verified zero pours for ${period}.` : `No fully verified zero-usage products were found for ${period}. Unknown readings are not zeros.`, zeroRows, notes);
  }
  const available = rows.filter((row) => known(row.value));
  const summary = !available.length ? "No verified values are available for this selection."
    : average ? "Weekly averages use fully covered weeks for each matching product."
      : `${display(total(available.map((row) => row.value)))} ${missing ? "recorded subtotal" : "total"} across ${available.length} matching groups.`;
  return answer(compare ? "Comparison" : "Saved usage", `${summary} Period: ${period}.`, rows, notes);
}

export function answerLocalBeverageQuestion(raw, context) {
  const query = normalizeDashboardQuestion(raw);
  if (!query || /\bwhat if\b/.test(query)) return null;
  if (/\b(?:what can (?:i|we|you) ask|what can you answer|help|examples)\b/.test(query)) return answer("Ask the dashboard", "I can answer questions about saved usage, comparisons, trends, costs, recipes, stock, counts, and saved ordering needs. I cannot invent missing data or change anything from search.", BEVERAGE_QUESTION_EXAMPLES.map(([name, examples]) => ({ name, text: examples.join(" | ") })));
  if (/\b(?:actual|pos|net)\b.*\b(?:sales|profit|revenue)\b|\b(?:labor|payroll|weather|customers|attendance)\b/.test(query)) return answer("That data is not available here", "This dashboard has poured usage and pricing estimates, not actual POS sales, net profit, labor costs, weather, or guest counts.");
  if (/^(?:please )?(?:save|delete|remove|clear|change|update|set|place|submit|refresh|repair|unlock|lock)\b/.test(query)) return answer("Search is read-only", "I can explain saved data, but I will not change counts, prices, orders, or tap connections. Use the corresponding dashboard controls.");
  if (/\b(?:are .*saved|save status|unsaved|failed save|sync status|connection status|are we ready|monday blockers)\b/.test(query)) {
    const sources = context.health();
    return answer("Saved-state status", "This reads the dashboard's current save status; it does not run a connection test or guarantee Monday readiness.", sources.map(({ name, state }) => ({ name, text: state.saveError ? `Save error: ${state.saveError}` : state.savePending || state.unsavedCount || state.hasOutbox ? "Changes are pending; not confirmed saved." : !state.initialized ? "Shared state is not initialized or unavailable." : "No pending save is reported." })));
  }
  if (/\b(?:missing|uncounted|received|still need|not current)\b.*\bcounts?\b|\bcounts?\b.*\b(?:missing|uncounted|received|not current)\b/.test(query)) {
    const { items, countedAt } = context.inventory();
    const filtered = select(items, query).items;
    const missing = filtered.filter((item) => item.physicalCountRequired && !isRecommendationForOperatingWeek(countedAt[item.id]));
    return answer("Weekly count receipts", `${missing.length} matching items still need a count receipt for the operating week.`, missing.map((item) => ({ name: item.name, text: item.group })), ["This does not mark anything counted or assume unmentioned items were submitted."]);
  }
  if (/\b(?:order|ordering|buy|reorder|enough|run out|running out)\b/.test(query)) {
    if (/\b(?:tomorrow|next month|event|party|guests|people|run out|running out)\b/.test(query)) return question("I can show the saved weekly-plan needs, but cannot guarantee when stock will run out. Ask what needs ordering, or use a what-if demand scenario.");
    const { items, countedAt, state } = context.inventory();
    if (state.saveError || state.savePending || state.unsavedCount || !state.initialized) return answer("Ordering needs are not ready", "Inventory saves must finish successfully before I can present reliable order quantities.");
    const matched = select(items, query).items;
    if (!matched.length) return question("Which inventory item should I explain? Try 'Why do we need to order Tito's?'");
    const rows = matched.filter((item) => nameTerms(query) || item.orderHoldReason || positive(item.orderUnits)).map((item) => {
      const current = !item.physicalCountRequired || isRecommendationForOperatingWeek(countedAt[item.id]);
      return { name: item.name, text: !current ? "Held: this week's physical count has not been received." : item.orderHoldReason ? `Held: ${item.orderHoldReason}` : !known(item.orderUnits) ? "A current order calculation is unavailable." : `${fmt(item.orderUnits)} units${positive(item.unitCost) ? `; ${money(item.orderUnits * item.unitCost)} estimated item cost` : "; cost unavailable"}. ${item.orderReason || ""}` };
    });
    return answer("Saved inventory ordering needs", rows.length ? "These are the inventory component of the plan, not an order submission or the complete vendor order." : "No matching inventory shortages are currently reported.", rows, ["Open Weekly Plan for keg orders, tap refills, vendor minimums, and final placed orders."]);
  }
  if (/\b(?:level|levels|empty|nearly empty|on tap|which tap|where is)\b/.test(query)) {
    const items = select(context.levels(), query).items;
    const onlyEmpty = /\bempty\b/.test(query);
    const low = /\b(?:low|nearly)\b/.test(query);
    const selected = items.filter((item) => !onlyEmpty || (known(item.fraction) && (low ? item.fraction <= 0.1 : item.fraction === 0)));
    return answer("Tap levels", low ? "Showing available readings at 10% full or below." : "Latest available PMB readings, not a new live measurement.", selected.map((item) => ({ name: `${item.name} / Tap ${item.tapNumber}`, text: !known(item.fraction) ? "Level unavailable; do not treat it as empty." : `${fmt(item.fraction * 100)}% full${known(item.ounces) ? `; ${fmt(item.ounces)} oz` : ""}. ${item.wall || ""}` })), [`${items.filter((item) => !known(item.fraction)).length} matching taps have unavailable readings.`]);
  }
  if (/\b(?:recipe|recipes|ingredients|what is in|whats in|batch|abv|alcohol content)\b/.test(query)) {
    const recipes = context.recipes();
    const reverse = /\b(?:use|uses|using|contain|contains)\b/.test(query);
    const terms = nameTerms(query.replace(/\b(?:abv|alcohol content)\b/g, ""));
    const matched = reverse ? recipes.filter((recipe) => select(recipe.ingredients, terms, { allowAll: false }).items.length)
      : select(recipes, query.replace(/\b(?:abv|alcohol content)\b/g, ""), { allowAll: false }).items;
    if (!matched.length) return question("Which recipe or ingredient should I look up? Try 'What is in Blue Dot?' or 'Which recipes use Tito's?'");
    return answer("Recipe facts", "Current recipe quantities and pricing; no recipe is changed.", matched.map((recipe) => ({ name: recipe.name, text: reverse ? recipe.ingredients.map((item) => item.name).join(", ") : `${recipe.ingredients.map((item) => `${item.name}: ${fmt(item.oz)} oz`).join("; ")}. Batch: ${fmt(recipe.oz)} oz; ${recipe.costComplete ? `${money(recipe.cost)} ingredient cost` : "complete ingredient cost unavailable"}; ${known(recipe.abv) ? `${fmt(recipe.abv)}% calculated ABV` : "ABV unavailable"}.` })));
  }
  if (/\b(?:cost|costs|price|prices|supplier|supplies|vendor|expensive|cheapest)\b/.test(query) && !/\b(?:profit|sales|revenue|margin)\b/.test(query)) {
    const vendor = ["bonbright", "heidelberg", "ohlq", "provi", "proof"].find((name) => new RegExp(`\\b${name}\\b`).test(query));
    const catalog = context.prices().filter((item) => !vendor || normalizeDashboardQuestion(item.vendor).includes(vendor));
    const matched = select(catalog, vendor ? query.replace(new RegExp(`\\b${vendor}\\b`, "g"), "") : query).items;
    if (!matched.length) return question("Which ingredient or keg price should I look up?");
    return answer("Current purchase pricing", "Saved purchase costs, not tap selling prices or a new vendor quote.", matched.map((item) => ({ name: item.name, text: `${positive(item.price) ? money(item.price) : "Price unavailable"} per ${item.unit}; ${positive(item.oz) ? `${fmt(item.oz)} oz` : "package size unavailable"}. Supplier: ${item.vendor || "not mapped"}. ${item.updatedAt ? `Price record: ${item.updatedAt}.` : "No price timestamp saved."}` })));
  }
  return usageAnswer(raw, query, context);
}

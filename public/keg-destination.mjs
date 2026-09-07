export function kegDestination(item = {}, { cocktail = false } = {}) {
  const taps = (Array.isArray(item.tapNumbers) ? item.tapNumbers : [item.tapNumber])
    .map(Number).filter((tap) => Number.isInteger(tap) && tap > 0);
  const isKeg = cocktail || /keg|beer|cocktail/i.test(`${item.unit || ""} ${item.lineType || ""}`);
  if (!isKeg) return "";
  const destinations = [];
  for (const [label, min, max] of [["Main cooler", 21, 72], ["Karaoke cooler", 73, 102]]) {
    const assigned = [...new Set(taps.filter((tap) => tap >= min && tap <= max))];
    if (assigned.length) destinations.push(`${label} (Tap${assigned.length > 1 ? "s" : ""} ${assigned.join(", ")})`);
  }
  if (destinations.length) return `Store in: ${destinations.join("; ")}`;
  const wall = String(item.wall || "").trim().toLowerCase();
  if (!taps.length && ["main", "karaoke"].includes(wall)) {
    return `Store in: ${wall === "main" ? "Main" : "Karaoke"} cooler`;
  }
  return "Cooler assignment needed - check with manager";
}

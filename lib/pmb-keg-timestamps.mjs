// Read only the server-rendered keg cards; never execute the report's scripts.
export function parsePmbKegTimestamps(html) {
  const records = new Map();
  const plain = value => String(value || "").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:0?39);|&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (const match of String(html || "").matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const card = match[1];
    const slot = card.match(/\bid=["'](\d+)_(\d+)_text["']/i);
    const tap = plain(card).match(/Tap Number:\s*(\d+)/i);
    const timestamp = plain(card).match(/tapped on:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i);
    const name = card.match(/<p\b[^>]*class=["']desc["'][^>]*>([\s\S]*?)<\/p>/i);
    if (!slot || !tap || !timestamp || !name) continue;
    const key = `${slot[1]}:${slot[2]}`;
    // Ambiguous cards must not attach a timestamp to the wrong physical tap.
    if (records.has(key)) { records.set(key, null); continue; }
    records.set(key, {
      deviceId: Number(slot[1]), lineNum: Number(slot[2]), tapNumber: Number(tap[1]),
      name: plain(name[1]), tappedOn: timestamp[1],
    });
  }
  return [...records.values()].filter(Boolean);
}

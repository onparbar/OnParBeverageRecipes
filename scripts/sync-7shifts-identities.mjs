import { readFile, writeFile, rename } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// Run locally with --env-project PATH to reuse an existing server connection.
// Only credential hashes are written; tokens and punch IDs never leave memory.
const envIndex = process.argv.indexOf("--env-project");
if (envIndex >= 0 && !process.argv[envIndex + 1]) throw new Error("Supply an environment project path.");
nextEnv.loadEnvConfig(envIndex >= 0 ? process.argv[envIndex + 1] : process.cwd(), false, { info() {}, error() {} });

async function main() {
  const env = process.env;
  if (!env.SEVENSHIFTS_ACCESS_TOKEN || !env.SEVENSHIFTS_COMPANY_ID) throw new Error("7shifts server credentials are missing.");
  const headers = { accept: "application/json", authorization: `Bearer ${env.SEVENSHIFTS_ACCESS_TOKEN}` };
  if (env.SEVENSHIFTS_API_VERSION) headers["x-api-version"] = env.SEVENSHIFTS_API_VERSION;
  if (env.SEVENSHIFTS_COMPANY_GUID) headers["x-company-guid"] = env.SEVENSHIFTS_COMPANY_GUID;
  const users = [];
  const cursors = new Set();
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://api.7shifts.com/v2/company/${encodeURIComponent(env.SEVENSHIFTS_COMPANY_ID)}/users`);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`7shifts employee request failed (${response.status}); roster unchanged.`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error("Invalid employee response; roster unchanged.");
    users.push(...payload.data);
    cursor = payload.meta?.cursor?.next || "";
    if (!cursor) break;
    if (cursors.has(cursor) || page === 19) throw new Error("Incomplete employee pagination; roster unchanged.");
    cursors.add(cursor);
  }
  const path = fileURLToPath(new URL("../lib/dashboard-identities.mjs", import.meta.url));
  const source = await readFile(path, "utf8");
  const rosterPattern = /(const dashboardIdentities = Object\.freeze\(\s*)(\[[\s\S]*?\])(?=\.map\(\(entry\))/;
  const match = source.match(rosterPattern);
  const salt = source.match(/const PIN_HASH_SALT = "([^"]+)"/)?.[1];
  const iterations = Number(source.match(/const PIN_HASH_ITERATIONS = (\d+)/)?.[1]);
  if (!match || !salt || !iterations) throw new Error("Unrecognized identity format; roster unchanged.");
  const prior = JSON.parse(match[2]);
  const nameKey = value => String(value).trim().replace(/\s+/g, " ").toLowerCase();
  const identities = [];
  const ids = new Set();
  const hashes = new Set();
  for (const user of users.filter(entry => entry.active === true)) {
    const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const pin = String(user.punch_id ?? "").trim();
    if (!name || !/^\d{4}$/.test(pin) || !user.id) throw new Error("An active employee is missing a valid name, ID, or four-digit punch ID; roster unchanged.");
    const candidates = prior.filter(entry => entry.sevenShiftsId
      ? String(entry.sevenShiftsId) === String(user.id)
      : nameKey(entry.name) === nameKey(name));
    if (candidates.length > 1) throw new Error("Ambiguous employee mapping; roster unchanged.");
    const existing = candidates[0];
    const id = existing?.id || `7shifts-${user.id}`;
    const pinHash = pbkdf2Sync(pin, salt, iterations, 32, "sha256").toString("hex");
    if (ids.has(id) || hashes.has(pinHash)) throw new Error("Duplicate employee identity or punch ID; roster unchanged.");
    ids.add(id);
    hashes.add(pinHash);
    identities.push({ id, name, role: existing?.role || "employee", pinHash, sevenShiftsId: String(user.id) });
  }
  if (!identities.length) throw new Error("Empty active roster; import stopped.");
  if (prior.some(entry => entry.role === "owner" && !ids.has(entry.id))) {
    throw new Error("An existing administrator is missing from the active roster. Resolve their mapping before syncing; roster unchanged.");
  }
  identities.sort((a, b) => a.name.localeCompare(b.name));
  let updated = source.replace(rosterPattern, (_, prefix) => prefix + JSON.stringify(identities, null, 2));
  if (JSON.stringify(prior) === JSON.stringify(identities)) {
    console.log("7shifts roster already current.");
    return;
  }
  // Invalidate old sessions when employee access or credentials change.
  updated = updated.replace(/DASHBOARD_IDENTITY_AUTH_VERSION = (\d+)/, (_, version) => `DASHBOARD_IDENTITY_AUTH_VERSION = ${Number(version) + 1}`);
  const temp = `${path}.sync-tmp`;
  await writeFile(temp, updated, { mode: 0o600 });
  await rename(temp, path);
  console.log(`Imported ${identities.length} active employees from 7shifts. Existing roles preserved; new identities are staff. Deploy to activate.`);
}

main().catch(() => {
  console.error("7shifts identity sync stopped. No credentials were printed. Check connection, active employee punch IDs, duplicate IDs, and administrator mappings before retrying.");
  process.exitCode = 1;
});

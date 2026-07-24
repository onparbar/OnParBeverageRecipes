import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runParAgentUpdate } from "../lib/par-agent.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const index = trimmed.indexOf("=");
  if (index <= 0) return null;

  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

async function loadDotEnv() {
  const envPath = path.join(projectRoot, ".env.local");
  let raw = "";
  try {
    raw = await readFile(envPath, "utf8");
  } catch {
    return;
  }

  raw.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || process.env[parsed.key] != null) return;
    process.env[parsed.key] = parsed.value;
  });
}

function hasFlag(name) {
  return process.argv.includes(name);
}

await loadDotEnv();

const dryRun = hasFlag("--dry-run");
const result = await runParAgentUpdate({ dryRun });
const summary = result.recommendations?.summary || {};
const generatedAt = result.recommendations?.generatedAt || new Date().toISOString();

console.log(JSON.stringify({
  ok: true,
  dryRun,
  generatedAt,
  statePath: result.statePath,
  orderItemCount: summary.orderItemCount || 0,
  orderTotal: summary.orderTotal || 0,
  capacityEnabled: Boolean(summary.capacityEnabled),
  coolerCapacityKegs: summary.coolerCapacityKegs || 0,
  suppressedByCapacity: summary.suppressedByCapacity || 0,
}, null, 2));

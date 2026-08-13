import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

function cleanStatusMessage(value) {
  return String(value || "Unknown par-agent failure.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function writeHeartbeat(payload) {
  const statusPath = process.env.PAR_AGENT_STATUS_PATH
    ? path.resolve(process.env.PAR_AGENT_STATUS_PATH)
    : path.join(projectRoot, "logs", "par-agent-status.json");
  const statusDirectory = path.dirname(statusPath);
  const temporaryPath = `${statusPath}.${process.pid}.tmp`;

  await mkdir(statusDirectory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statusPath);
}

await loadDotEnv();

const dryRun = hasFlag("--dry-run");
const checkedAt = new Date().toISOString();

try {
  const result = await runParAgentUpdate({ dryRun });
  const summary = result.recommendations?.summary || {};
  const generatedAt = result.recommendations?.generatedAt || new Date().toISOString();

  await writeHeartbeat({
    version: 1,
    status: "ok",
    dryRun,
    checkedAt,
    generatedAt,
    orderItemCount: summary.orderItemCount || 0,
  });

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    generatedAt,
    statePath: result.statePath,
    orderItemCount: summary.orderItemCount || 0,
    orderTotal: summary.orderTotal || 0,
  }, null, 2));
} catch (error) {
  const failure = {
    version: 1,
    status: "error",
    dryRun,
    checkedAt,
    generatedAt: new Date().toISOString(),
    errorCode: String(error?.code || "PAR_AGENT_UPDATE_FAILED").slice(0, 80),
    errorMessage: cleanStatusMessage(error?.message),
  };

  try {
    await writeHeartbeat(failure);
  } catch (statusError) {
    console.error(JSON.stringify({
      ok: false,
      code: "PAR_AGENT_HEARTBEAT_WRITE_FAILED",
      error: cleanStatusMessage(statusError?.message),
    }));
  }

  console.error(JSON.stringify({
    ok: false,
    code: failure.errorCode,
    error: failure.errorMessage,
  }));
  process.exitCode = 1;
}

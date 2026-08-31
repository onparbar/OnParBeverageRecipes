#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const productionUrl = String(
  process.env.ONPAR_PRODUCTION_URL || "https://onparbev.com",
).replace(/\/+$/, "");
const verifyAttempts = positiveInteger(process.env.ONPAR_VERIFY_ATTEMPTS, 240);
const verifyIntervalMs = positiveInteger(process.env.ONPAR_VERIFY_INTERVAL_MS, 5_000);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message) {
  console.error(`\nRelease stopped: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || "").trim() : "";
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }

  return capture ? String(result.stdout || "").trim() : "";
}

function step(message) {
  console.log(`\n==> ${message}`);
}

async function verifyLiveCommit(expectedCommit) {
  const versionUrl = `${productionUrl}/api/version`;

  for (let attempt = 1; attempt <= verifyAttempts; attempt += 1) {
    try {
      const separator = versionUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${versionUrl}${separator}release=${Date.now()}`, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const version = await response.json();
      const liveCommit = String(version?.commit || "").toLowerCase();
      if (liveCommit === expectedCommit.toLowerCase()) {
        console.log(`Live commit verified: ${liveCommit}`);
        return;
      }

      console.log(
        `Verification ${attempt}/${verifyAttempts}: live commit is ${liveCommit || "unknown"}; waiting for ${expectedCommit}.`,
      );
    } catch (error) {
      console.log(
        `Verification ${attempt}/${verifyAttempts}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (attempt < verifyAttempts) await delay(verifyIntervalMs);
  }

  fail(
    `${productionUrl} did not report commit ${expectedCommit} within the on-site deployment window.`,
  );
}

const branch = run("git", ["branch", "--show-current"], { capture: true });
if (branch !== "main") fail(`production releases must run from main, not ${branch || "a detached HEAD"}.`);

const worktreeStatus = run("git", ["status", "--porcelain"], { capture: true });
if (worktreeStatus) {
  fail("commit or remove the current working-tree changes before releasing.");
}

const commit = run("git", ["rev-parse", "HEAD"], { capture: true }).toLowerCase();

step(`Running the full release gate for ${commit.slice(0, 12)}`);
run("npm", ["run", "check"]);

step("Pushing the tested commit");
run("git", ["push"]);

step("Waiting for GitHub checks and the on-site Cloudflare release");
await verifyLiveCommit(commit);

console.log(`\nProduction release complete through the on-site Cloudflare service: ${commit}`);

import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  agentRoot,
  alternateProviLocationNames,
  captureDir,
  captureRetentionDays,
  captureRetentionMaxFiles,
  chromeExecutableCandidates,
  chromeProfileDir,
  latestCapturePath,
  latestExtractPath,
  preferredProviLocationName,
  proviHostPattern,
  proviStartUrl,
} from "./paths.mjs";
import {
  cleanupCaptureFiles,
  ensureDir,
  extractInterestingValues,
  hardenPrivateRoot,
  hardenPrivateTree,
  looksLikeJson,
  nowStamp,
  redactSensitiveHeaders,
  redactSensitiveUrl,
  safeJsonParse,
  sanitizeCapturedData,
  writeJson,
} from "./utils.mjs";

function resolveChromeExecutable() {
  return chromeExecutableCandidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function isInterestingUrl(url = "") {
  return proviHostPattern.test(url) || /graphql|api|checkout|cart|order|retailer|account/i.test(url);
}

async function main() {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) throw new Error("Chrome executable was not found on this machine.");

  await ensureDir(agentRoot);
  await hardenPrivateRoot(agentRoot);
  await ensureDir(captureDir);
  await hardenPrivateTree(chromeProfileDir);
  await cleanupCaptureFiles(captureDir, {
    maxAgeDays: captureRetentionDays,
    maxFiles: captureRetentionMaxFiles,
    preservePaths: [latestCapturePath, latestExtractPath],
  });

  console.log("Opening Chrome with the saved Provi session...");
  console.log(`1. Make sure the active Provi location is "${preferredProviLocationName}".`);
  if (alternateProviLocationNames.length) {
    console.log(`2. Avoid capturing from ${alternateProviLocationNames.join(", ")} because it uses a different location ID.`);
  }
  console.log("3. Navigate through the Provi flow until you reach cart / checkout / account screens.");
  console.log("4. Spend a minute on the pages that show retailer / account details.");
  console.log("5. Come back to this PowerShell window and press Enter.");

  const requestLog = [];
  const candidateValues = [];

  const context = await chromium.launchPersistentContext(chromeProfileDir, {
    executablePath,
    headless: false,
    viewport: null,
    ignoreHTTPSErrors: true,
  });

  context.on("request", async (request) => {
    const url = request.url();
    if (!isInterestingUrl(url)) return;

    const headers = redactSensitiveHeaders(await request.allHeaders());
    const postData = request.postData() || "";
    const parsedPostData = safeJsonParse(postData);
    const storedPostData = parsedPostData && typeof parsedPostData === "object"
      ? sanitizeCapturedData(parsedPostData)
      : null;
    if (storedPostData) {
      candidateValues.push(...extractInterestingValues(storedPostData, [], ["requestBody"]));
    }

    requestLog.push({
      type: "request",
      capturedAt: nowStamp(),
      method: request.method(),
      url: redactSensitiveUrl(url),
      resourceType: request.resourceType(),
      headers,
      postData: storedPostData,
      postDataOmitted: Boolean(postData && !storedPostData),
      postDataBytes: postData ? Buffer.byteLength(postData, "utf8") : 0,
    });
  });

  context.on("response", async (response) => {
    const url = response.url();
    if (!isInterestingUrl(url)) return;

    const contentType = response.headers()["content-type"] || "";
    let body = null;
    let bodyOmitted = false;
    let bodyBytes = 0;

    try {
      if (looksLikeJson(contentType)) {
        const text = await response.text();
        bodyBytes = Buffer.byteLength(text, "utf8");
        const parsedBody = safeJsonParse(text);
        body = parsedBody && typeof parsedBody === "object"
          ? sanitizeCapturedData(parsedBody)
          : null;
        bodyOmitted = Boolean(text && !body);
        if (body && typeof body === "object") {
          candidateValues.push(...extractInterestingValues(body, [], ["responseBody"]));
        }
      }
    } catch {}

    requestLog.push({
      type: "response",
      capturedAt: nowStamp(),
      status: response.status(),
      url: redactSensitiveUrl(url),
      headers: redactSensitiveHeaders(response.headers()),
      body,
      bodyOmitted,
      bodyBytes,
    });
  });

  let rl;
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(proviStartUrl, { waitUntil: "domcontentloaded" });
    rl = readline.createInterface({ input, output });
    await rl.question("Press Enter after you have finished the Provi checkout/account capture on On Par Entertainment...");

    const summary = {
      capturedAt: nowStamp(),
      totalEvents: requestLog.length,
      interestingValues: dedupeValues(candidateValues).slice(0, 200),
      events: requestLog,
    };

    await writeJson(latestCapturePath, summary);
    await writeJson(latestExtractPath, {
      capturedAt: summary.capturedAt,
      interestingValues: summary.interestingValues,
    });
    await cleanupCaptureFiles(captureDir, {
      maxAgeDays: captureRetentionDays,
      maxFiles: captureRetentionMaxFiles,
      preservePaths: [latestCapturePath, latestExtractPath],
    });

    console.log(`Saved Provi capture to ${latestCapturePath}`);
    console.log(`Saved extracted values to ${latestExtractPath}`);
  } finally {
    rl?.close();
    try {
      await context.close();
    } finally {
      await hardenPrivateTree(chromeProfileDir);
      await hardenPrivateRoot(agentRoot);
    }
  }
}

function dedupeValues(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.path}:${JSON.stringify(entry.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

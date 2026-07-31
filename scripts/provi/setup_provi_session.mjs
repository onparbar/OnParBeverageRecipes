import fs from "node:fs";
import fsPromises from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  agentRoot,
  alternateProviLocationNames,
  chromeExecutableCandidates,
  chromeProfileDir,
  preferredProviLocationName,
  proviHostPattern,
  proviStartUrl,
  sessionStatePath,
  storageDumpPath,
} from "./paths.mjs";
import {
  ensureDir,
  hardenPrivateRoot,
  hardenPrivateTree,
  nowStamp,
  sanitizeWebStorage,
  writeJson,
} from "./utils.mjs";

function resolveChromeExecutable() {
  return chromeExecutableCandidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function dumpStorage(context) {
  const pages = context.pages();
  const storage = [];

  for (const page of pages) {
    const url = page.url();
    if (!proviHostPattern.test(url)) continue;

    const result = await page.evaluate(() => ({
      origin: location.origin,
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
    }));
    storage.push({
      ...result,
      localStorage: sanitizeWebStorage(result.localStorage),
      sessionStorage: sanitizeWebStorage(result.sessionStorage),
    });
  }

  return storage;
}

async function main() {
  const executablePath = resolveChromeExecutable();
  if (!executablePath) {
    throw new Error("Chrome executable was not found on this machine.");
  }

  await ensureDir(agentRoot);
  await hardenPrivateRoot(agentRoot);
  await fsPromises.rm(chromeProfileDir, { recursive: true, force: true });
  await ensureDir(chromeProfileDir);

  console.log("Opening Chrome for one-time Provi login...");
  console.log("1. Log in manually to Provi.");
  console.log(`2. If Provi asks you to choose a location, select "${preferredProviLocationName}".`);
  if (alternateProviLocationNames.length) {
    console.log(`3. Do not stay on ${alternateProviLocationNames.join(", ")} for this capture.`);
  }
  console.log("4. Wait until you can see your normal app/ordering view.");
  console.log("5. Come back to this PowerShell window and press Enter.");

  const context = await chromium.launchPersistentContext(chromeProfileDir, {
    executablePath,
    headless: false,
    viewport: null,
    ignoreHTTPSErrors: true,
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(proviStartUrl, { waitUntil: "domcontentloaded" });
  const metadata = {
    savedAt: nowStamp(),
    chromeProfileDir,
    startUrl: proviStartUrl,
  };
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question("Press Enter after you have finished logging in with On Par Entertainment selected...");
    await writeJson(sessionStatePath, {
      ...metadata,
      storageState: await context.storageState(),
    });
    await writeJson(storageDumpPath, {
      ...metadata,
      origins: await dumpStorage(context),
    });
  } finally {
    rl.close();
    try {
      await context.close();
    } finally {
      await hardenPrivateTree(chromeProfileDir);
      await hardenPrivateRoot(agentRoot);
    }
  }

  console.log(`Saved Provi session state to ${sessionStatePath}`);
  console.log(`Saved Provi storage dump to ${storageDumpPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

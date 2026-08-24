(() => {
  if (window.__coolerWalkInstalled) return;
  window.__coolerWalkInstalled = true;

  const STORAGE_KEY = "onpar.coolerWalkAliases.v1";
  const CLEAR_PENDING_KEY = "onpar.coolerWalkAliases.clearPending.v1";
  const NUMBER_WORDS = new Set([
    "zero", "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "point",
  ]);
  const FILLER_WORDS = new Set([
    "a", "an", "and", "of", "for", "the", "this", "list", "is", "are", "have", "has", "on", "hand",
    "main", "patio", "karaoke", "wall", "cooler", "inventory", "count", "set", "make", "change",
    "actually", "oh", "whoops", "oops", "add", "another", "more", "please", "case", "cases", "bottle",
    "bottles", "keg", "kegs", "unit", "units",
  ]);

  let walkActive = false;
  let lastWalkSummary = "";
  let lastAliasMessage = "";
  let aliasSyncStarted = false;

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, " ")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function contextFrom(value) {
    const explicit = normalize(value).match(/\b(main|patio|karaoke)(?: wall| cooler)?\b/)?.[1];
    if (explicit) return explicit;
    const selected = getRoot()?.dataset.speechContext;
    return ["main", "patio", "karaoke"].includes(selected) ? selected : "inventory";
  }

  function aliasCandidate(value) {
    return normalize(value).split(" ").filter((word) => {
      if (!word || FILLER_WORDS.has(word) || NUMBER_WORDS.has(word)) return false;
      return !/^\d+(?:\.\d+)?$/.test(word);
    }).join(" ");
  }

  function loadAliases() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.filter((entry) => entry?.alias && entry?.product) : [];
    } catch {
      return [];
    }
  }

  function aliasKey(entry) {
    return `${entry.context || "inventory"}:${entry.alias}`;
  }

  function mergeAliasLists(...lists) {
    const merged = new Map();
    lists.flat().forEach((entry) => {
      if (!entry?.alias || !entry?.product) return;
      const normalized = {
        alias: aliasCandidate(entry.alias),
        product: String(entry.product).trim(),
        context: ["main", "patio", "karaoke"].includes(entry.context) ? entry.context : "inventory",
        updatedAt: String(entry.updatedAt || ""),
      };
      if (!normalized.alias || !normalized.product) return;
      const key = aliasKey(normalized);
      const current = merged.get(key);
      const currentTime = Date.parse(current?.updatedAt || "") || 0;
      const nextTime = Date.parse(normalized.updatedAt) || 0;
      if (!current || nextTime >= currentTime) merged.set(key, normalized);
    });
    return [...merged.values()].slice(-100);
  }

  function cacheAliases(aliases) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeAliasLists(aliases)));
    } catch {
      // The shared copy remains authoritative when browser storage is unavailable.
    }
  }

  async function postAliasAction(body) {
    const response = await fetch("/api/speech-aliases", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Shared learned words are unavailable.");
    return response.json();
  }

  async function shareAliases(aliases) {
    try {
      const result = await postAliasAction({ action: "merge", aliases });
      cacheAliases(mergeAliasLists(loadAliases(), result.aliases || []));
      updateControls();
    } catch {
      // Keep the offline cache and retry it during the next dashboard session.
    }
  }

  async function clearSharedAliases() {
    try {
      await postAliasAction({ action: "clear" });
      localStorage.removeItem(CLEAR_PENDING_KEY);
    } catch {
      localStorage.setItem(CLEAR_PENDING_KEY, "true");
    }
  }

  async function syncSharedAliases() {
    if (aliasSyncStarted) return;
    aliasSyncStarted = true;
    try {
      if (localStorage.getItem(CLEAR_PENDING_KEY) === "true") {
        await postAliasAction({ action: "clear" });
        localStorage.removeItem(CLEAR_PENDING_KEY);
      }
      const response = await fetch("/api/speech-aliases", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Shared learned words are unavailable.");
      const shared = await response.json();
      const aliases = mergeAliasLists(shared.aliases || [], loadAliases());
      cacheAliases(aliases);
      if (aliases.length) await shareAliases(aliases);
    } catch {
      // Device-local aliases continue to work while shared storage is offline.
    } finally {
      updateControls();
    }
  }

  function saveAlias(alias, product, context) {
    const cleanAlias = aliasCandidate(alias);
    const cleanProduct = String(product || "").trim();
    if (!cleanAlias || !cleanProduct || normalize(cleanAlias) === normalize(cleanProduct)) return false;
    const aliases = loadAliases().filter((entry) => !(entry.alias === cleanAlias && entry.context === context));
    const entry = {
      alias: cleanAlias,
      product: cleanProduct,
      context,
      updatedAt: new Date().toISOString(),
    };
    aliases.push(entry);
    try {
      cacheAliases(aliases);
      lastAliasMessage = `Learned ${cleanAlias} → ${cleanProduct}`;
      void shareAliases([entry]);
      return true;
    } catch {
      return false;
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function applyLearnedAliases(transcript, root = null) {
    const context = contextFrom(transcript);
    const kegOnly = root?.id === "keg-speech-assistant";
    const aliases = loadAliases()
      .filter((entry) => entry.context === context || entry.context === "inventory")
      .filter((entry) => !kegOnly || aliasCandidate(entry.alias).includes(" "))
      .sort((left, right) => right.alias.length - left.alias.length);
    if (!aliases.length) return transcript;
    return aliases.reduce((value, rule) => {
      const pattern = new RegExp(`\\b${escapeRegExp(rule.alias).replace(/\\ /g, "\\s+")}\\b`, "gi");
      if (!pattern.test(value)) return value;
      lastAliasMessage = `Matched ${rule.alias} → ${rule.product}`;
      return value.replace(pattern, rule.product);
    }, String(transcript || ""));
  }

  function getTranscriptField(root = getRoot()) {
    return root?.querySelector('[aria-label="Spoken inventory transcript"]') || null;
  }

  function getRoot() {
    return document.getElementById("keg-speech-assistant");
  }

  function installControls() {
    const root = getRoot();
    const speechControl = root?.querySelector(".inventory-speech-listen:not([data-cooler-walk-control])");
    if (!root || !speechControl) return;
    speechControl.hidden = true;
    speechControl.tabIndex = -1;
    speechControl.setAttribute("aria-hidden", "true");
    if (!root.querySelector('[data-cooler-walk-control="true"]')) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = speechControl.className;
      button.dataset.coolerWalkControl = "true";
      button.textContent = walkActive ? "Finish count" : "Start count";
      button.disabled = speechControl.disabled;
      button.setAttribute("aria-pressed", walkActive ? "true" : "false");
      speechControl.insertAdjacentElement("afterend", button);
    }
    if (!root.querySelector('[data-cooler-walk-status="true"]')) {
      const status = document.createElement("p");
      status.dataset.coolerWalkStatus = "true";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      root.appendChild(status);
    }
    updateControls();
  }

  function reviewCounts() {
    const root = getRoot();
    const selects = [...(root?.querySelectorAll('select[aria-label^="Matched product for "]') || [])];
    const matched = selects.filter((select) => {
      const selected = select.selectedOptions?.[0]?.textContent?.trim() || "";
      return selected && !/^choose item$/i.test(selected);
    }).length;
    return { matched, unresolved: Math.max(0, selects.length - matched) };
  }

  function updateControls() {
    const root = getRoot();
    if (!root) return;
    const control = root.querySelector('[data-cooler-walk-control="true"]');
    const status = root.querySelector('[data-cooler-walk-status="true"]');
    if (control) {
      const speechControl = root.querySelector(".inventory-speech-listen:not([data-cooler-walk-control])");
      const label = walkActive ? "Finish count" : "Start count";
      if (control.textContent !== label) control.textContent = label;
      control.disabled = speechControl?.disabled ?? true;
      control.setAttribute("aria-pressed", walkActive ? "true" : "false");
    }
    const counts = reviewCounts();
    const countSummary = `${counts.matched} heard${counts.unresolved ? ` · ${counts.unresolved} to review` : ""}`;
    const summary = walkActive
      ? countSummary
      : lastWalkSummary || "";
    if (status && status.textContent !== summary) status.textContent = summary;
  }

  function startWalk() {
    walkActive = true;
    lastWalkSummary = "";
    const root = getRoot();
    if (root?.tagName === "DETAILS") root.open = true;
    updateControls();
    const speechControl = root?.querySelector(".inventory-speech-listen:not([data-cooler-walk-control])");
    if (speechControl?.textContent.trim() === "Start count") speechControl.click();
  }

  function finishWalk() {
    const speechControl = getRoot()?.querySelector(".inventory-speech-listen:not([data-cooler-walk-control])");
    if (speechControl?.textContent.trim() === "Finish count") speechControl.click();
    walkActive = false;
    const counts = reviewCounts();
    lastWalkSummary = `${counts.matched} heard${counts.unresolved ? ` · ${counts.unresolved} to review` : " · ready to apply"}`;
    updateControls();
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.coolerWalkControl === "true") {
      event.preventDefault();
      if (walkActive) finishWalk();
      else startWalk();
      return;
    }
    if (button.textContent.trim().toLowerCase() === "review") {
      const assistant = button.closest("#inventory-speech-assistant, #keg-speech-assistant");
      const field = getTranscriptField(assistant);
      if (field) field.value = applyLearnedAliases(field.value, assistant);
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (!event.target.matches?.('[aria-label="Spoken inventory transcript"]')) return;
    const assistant = event.target.closest("#inventory-speech-assistant, #keg-speech-assistant");
    const expanded = applyLearnedAliases(event.target.value, assistant);
    if (expanded !== event.target.value) event.target.value = expanded;
    window.setTimeout(updateControls, 180);
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest?.('select[aria-label^="Matched product for "]');
    if (!select) return;
    const selected = select.selectedOptions?.[0]?.textContent?.trim() || "";
    if (!selected || /^choose item$/i.test(selected)) return;
    const phrase = select.getAttribute("aria-label").replace(/^Matched product for\s+/i, "");
    const product = selected.split(" · ")[0].trim();
    const assistant = select.closest("#inventory-speech-assistant, #keg-speech-assistant");
    const transcript = getTranscriptField(assistant)?.value || phrase;
    if (saveAlias(phrase, product, contextFrom(transcript))) window.setTimeout(updateControls, 0);
  }, true);

  new MutationObserver(() => {
    installControls();
    updateControls();
  }).observe(document.documentElement, { childList: true, subtree: true });

  installControls();
  void syncSharedAliases();
})();

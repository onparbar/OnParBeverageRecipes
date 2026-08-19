(() => {
  if (window.__liveSpeechInventoryInstalled) return;
  window.__liveSpeechInventoryInstalled = true;

  let activeRecognition = null;
  let reviewTimer = null;
  let lastReviewedTranscript = "";
  let activeSearchRecognition = null;
  let searchTimer = null;
  let lastAnalyzedSearch = "";
  let conversationalSearchQuery = "";

  function getTranscriptField() {
    return document.querySelector('[aria-label="Spoken inventory transcript"]');
  }

  function getAssistantRoot() {
    const field = getTranscriptField();
    return field?.closest("details") || field?.parentElement || null;
  }

  function findButton(label) {
    const root = getAssistantRoot();
    if (!root) return null;
    return [...root.querySelectorAll("button")]
      .find((button) => button.textContent.trim().toLowerCase() === label.toLowerCase()) || null;
  }

  function updateSpeakButton(listening) {
    const button = findButton(listening ? "Speak" : "Listening...") || findButton("Speak");
    if (!button) return;
    const nextLabel = listening ? "Listening..." : "Speak";
    if (button.textContent !== nextLabel) button.textContent = nextLabel;
    button.setAttribute("aria-pressed", listening ? "true" : "false");
    button.dataset.liveSpeechControl = "true";
  }

  function reviewCurrentTranscript() {
    reviewTimer = null;
    const field = getTranscriptField();
    const transcript = String(field?.value || "").trim();
    if (!transcript || transcript === lastReviewedTranscript) return;
    const reviewButton = findButton("Review");
    if (!reviewButton) return;
    lastReviewedTranscript = transcript;
    reviewButton.click();
  }

  function scheduleReview() {
    window.clearTimeout(reviewTimer);
    reviewTimer = window.setTimeout(reviewCurrentTranscript, 140);
  }

  function setTranscript(value) {
    const field = getTranscriptField();
    if (!field) return;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    scheduleReview();
  }

  function stopListening() {
    if (activeRecognition) activeRecognition.stop();
  }

  function getDashboardSearchField() {
    return [...document.querySelectorAll('input:not([type="hidden"]), textarea')].find((field) => {
      const identity = [
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.getAttribute("name"),
        field.id,
      ].filter(Boolean).join(" ").toLowerCase();
      return identity.includes("what do you want to know") || identity.includes("dashboard search");
    }) || null;
  }

  function getSearchRoot(field = getDashboardSearchField()) {
    return field?.closest("form, [role='tabpanel'], section") || field?.parentElement || null;
  }

  function getSearchSubmit(field) {
    const root = getSearchRoot(field);
    if (!root) return null;
    return [...root.querySelectorAll("button")].find((button) => {
      if (button.dataset.liveSearchSpeech === "true") return false;
      const label = button.textContent.trim().toLowerCase();
      return button.type === "submit" || label === "search" || label === "ask";
    }) || null;
  }

  function compactSearchText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function getSearchFollowUp(rawQuery) {
    if (!conversationalSearchQuery) return "";
    const query = compactSearchText(rawQuery);
    const previous = compactSearchText(conversationalSearchQuery);
    if (query.toLowerCase().startsWith(previous.toLowerCase())) {
      const remainder = compactSearchText(query.slice(previous.length));
      if (remainder) return remainder;
    }
    if (/^(?:only|make that|rank by|sort by|instead|change to|same but|and |now |what about)\b/i.test(query)) {
      return query;
    }
    if (query.split(" ").length <= 4 && /\b(?:main|patio|karaoke|beer|beers|cocktail|cocktails|liquor|liquors|sales|profit|volume|ounces|oz|recent|week|weeks|highest|lowest|top|bottom)\b/i.test(query)) {
      return query;
    }
    const marker = /\b(?:make that|rank by|sort by|instead|same but|only)\b/gi;
    let match = null;
    let latest = null;
    while ((match = marker.exec(query))) latest = match;
    return latest ? compactSearchText(query.slice(latest.index)) : "";
  }

  function removeSearchFacet(query, pattern) {
    return compactSearchText(query.replace(pattern, " ").replace(/\s+([?.!,])/g, "$1"));
  }

  function mergeSearchFollowUp(previousQuery, followUp) {
    let merged = compactSearchText(previousQuery);
    const additions = [];
    let recognized = false;

    const category = followUp.match(/\b(beer|beers|cocktail|cocktails|liquor|liquors|shots|spirits)\b/i)?.[1];
    if (category) {
      merged = removeSearchFacet(merged, /\b(?:beer|beers|cocktail|cocktails|liquor|liquors|shots|spirits)\b/gi);
      additions.push(/^(?:beer|beers)$/i.test(category) ? "beer" : /^(?:cocktail|cocktails)$/i.test(category) ? "cocktails" : "liquor");
      recognized = true;
    }

    const wall = followUp.match(/\b(main|patio|karaoke)(?: bar| wall)?\b/i)?.[1];
    if (wall) {
      merged = removeSearchFacet(merged, /\b(?:main|patio|karaoke)(?: bar| wall)?\b/gi);
      additions.push(`on ${wall.toLowerCase()} wall`);
      recognized = true;
    }

    const period = followUp.match(/\b(last|previous|this|current) week\b|\b(?:last )?(six|6) weeks\b|\brecent(?:ly| history)?\b/i)?.[0];
    if (period) {
      merged = removeSearchFacet(merged, /\b(?:last|previous|this|current) week\b|\b(?:last )?(?:six|6) weeks\b|\brecent(?:ly| history)?\b/gi);
      additions.push(/(?:six|6) weeks/i.test(period) ? "last six weeks" : compactSearchText(period.toLowerCase()));
      recognized = true;
    }

    const metric = followUp.match(/\b(profit|profits|margin|sales|sale|revenue|dollars|volume|usage|pours|poured|ounces|ounce|oz)\b/i)?.[1];
    if (metric) {
      merged = removeSearchFacet(merged, /\b(?:profit|profits|margin|sales|sale|revenue|dollars|volume|usage|pours|poured|ounces|ounce|oz)\b/gi);
      additions.push(/^(?:profit|profits|margin)$/i.test(metric) ? "profit" : /^(?:sales|sale|revenue|dollars)$/i.test(metric) ? "sales" : "poured ounces");
      if (/\b(?:rank|sort) by\b/i.test(followUp) && !/\b(?:highest|top|most|lowest|least|bottom)\b/i.test(merged)) additions.push("highest");
      recognized = true;
    }

    const sort = followUp.match(/\b(highest|top|most|lowest|least|bottom)\b/i)?.[1];
    if (sort) {
      merged = removeSearchFacet(merged, /\b(?:highest|top|most|lowest|least|bottom|largest|smallest)\b/gi);
      additions.push(/^(?:lowest|least|bottom)$/i.test(sort) ? "lowest" : "highest");
      recognized = true;
    }

    const comparison = followUp.match(/\b(?:at most|no more than|at least|no less than|under|below|less than|above|over|more than|equal to|equals|exactly)\s+\d+(?:\.\d+)?(?:\s*(?:dollars?|ounces?|oz))?/i)?.[0];
    if (comparison) {
      merged = removeSearchFacet(merged, /\b(?:at most|no more than|at least|no less than|under|below|less than|above|over|more than|equal to|equals|exactly)\s+\d+(?:\.\d+)?(?:\s*(?:dollars?|ounces?|oz))?/gi);
      additions.push(compactSearchText(comparison.toLowerCase()));
      recognized = true;
    }

    const visibility = followUp.match(/\b(hidden|archived|current|active)\b/i)?.[1];
    if (visibility) {
      merged = removeSearchFacet(merged, /\b(?:hidden|archived|current|active)\b/gi);
      additions.push(/^(?:hidden|archived)$/i.test(visibility) ? "hidden" : "current");
      recognized = true;
    }

    return recognized ? compactSearchText(`${merged} ${additions.join(" ")}`) : compactSearchText(followUp);
  }

  function resolveConversationalSearch(field) {
    const rawQuery = compactSearchText(field?.value);
    if (!rawQuery) return "";
    const followUp = getSearchFollowUp(rawQuery);
    const resolved = followUp
      ? mergeSearchFollowUp(conversationalSearchQuery, followUp)
      : rawQuery;
    conversationalSearchQuery = resolved;
    if (resolved !== rawQuery) {
      field.value = resolved;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return resolved;
  }

  function updateSearchSpeakButton(listening) {
    const button = document.querySelector('[data-live-search-speech="true"]');
    if (!button) return;
    const nextLabel = listening ? "Listening..." : "Speak";
    if (button.textContent !== nextLabel) button.textContent = nextLabel;
    button.setAttribute("aria-pressed", listening ? "true" : "false");
  }

  function analyzeDashboardSearch() {
    searchTimer = null;
    const field = getDashboardSearchField();
    const query = String(field?.value || "").trim();
    if (!field || !query || query === lastAnalyzedSearch) return;
    lastAnalyzedSearch = query;
    const form = field.closest("form");
    if (form?.requestSubmit) {
      form.requestSubmit();
      return;
    }
    const submit = getSearchSubmit(field);
    if (submit) submit.click();
    else field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  }

  function scheduleSearchAnalysis(delay = 420) {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(analyzeDashboardSearch, delay);
  }

  function setDashboardSearchQuery(value) {
    const field = getDashboardSearchField();
    if (!field) return;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    scheduleSearchAnalysis();
  }

  function startSearchListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const field = getDashboardSearchField();
    if (!Recognition || !field) return;
    const recognition = new Recognition();
    const startingQuery = String(field.value || "").trim();
    activeSearchRecognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => updateSearchSpeakButton(true);
    recognition.onresult = (event) => {
      const finalPhrases = [];
      const interimPhrases = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const phrase = String(event.results[index]?.[0]?.transcript || "").trim();
        if (!phrase) continue;
        if (event.results[index].isFinal) finalPhrases.push(phrase);
        else interimPhrases.push(phrase);
      }
      const spokenQuery = [...finalPhrases, ...interimPhrases].join(" ");
      setDashboardSearchQuery([startingQuery, spokenQuery].filter(Boolean).join(" "));
      updateSearchSpeakButton(true);
    };
    recognition.onerror = () => {
      activeSearchRecognition = null;
      updateSearchSpeakButton(false);
    };
    recognition.onend = () => {
      activeSearchRecognition = null;
      updateSearchSpeakButton(false);
      scheduleSearchAnalysis(80);
    };
    recognition.start();
  }

  function installSearchSpeechControl() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const field = getDashboardSearchField();
    if (!Recognition || !field) return;
    const root = getSearchRoot(field);
    if (!root || root.querySelector('[data-live-search-speech="true"]')) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = getSearchSubmit(field)?.className || "secondary-button";
    button.textContent = activeSearchRecognition ? "Listening..." : "Speak";
    button.dataset.liveSearchSpeech = "true";
    button.setAttribute("aria-label", "Speak dashboard search");
    button.setAttribute("aria-pressed", activeSearchRecognition ? "true" : "false");
    field.insertAdjacentElement("afterend", button);
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return false;

    const recognition = new Recognition();
    const startingTranscript = String(getTranscriptField()?.value || "").trim();
    activeRecognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => updateSpeakButton(true);
    recognition.onresult = (event) => {
      const finalPhrases = [];
      const interimPhrases = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const phrase = String(event.results[index]?.[0]?.transcript || "").trim();
        if (!phrase) continue;
        if (event.results[index].isFinal) finalPhrases.push(phrase);
        else interimPhrases.push(phrase);
      }
      const sessionTranscript = [...finalPhrases, ...interimPhrases].join(", ");
      setTranscript([startingTranscript, sessionTranscript].filter(Boolean).join(", "));
      updateSpeakButton(true);
    };
    recognition.onerror = () => {
      activeRecognition = null;
      updateSpeakButton(false);
    };
    recognition.onend = () => {
      activeRecognition = null;
      updateSpeakButton(false);
      scheduleReview();
    };
    recognition.start();
    return true;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.liveSearchSpeech === "true") {
      event.preventDefault();
      if (activeSearchRecognition) activeSearchRecognition.stop();
      else startSearchListening();
      return;
    }
    const label = button.textContent.trim().toLowerCase();
    if (label !== "speak" && label !== "listening...") return;
    const field = getTranscriptField();
    if (!field || !getAssistantRoot()?.contains(button)) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (activeRecognition) stopListening();
    else startListening();
  }, true);

  document.addEventListener("submit", (event) => {
    const field = getDashboardSearchField();
    if (!field || event.target !== field.closest("form")) return;
    resolveConversationalSearch(field);
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target.matches?.('[aria-label="Spoken inventory transcript"]')) scheduleReview();
  });

  new MutationObserver(() => {
    if (activeRecognition) updateSpeakButton(true);
    installSearchSpeechControl();
    if (activeSearchRecognition) updateSearchSpeakButton(true);
  }).observe(document.documentElement, { childList: true, subtree: true });

  installSearchSpeechControl();
})();

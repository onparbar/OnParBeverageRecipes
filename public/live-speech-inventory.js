(() => {
  if (window.__liveSpeechInventoryInstalled) return;
  window.__liveSpeechInventoryInstalled = true;

  let activeRecognition = null;
  let reviewTimer = null;
  let lastReviewedTranscript = "";
  let activeSearchRecognition = null;
  let searchTimer = null;
  let lastAnalyzedSearch = "";

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

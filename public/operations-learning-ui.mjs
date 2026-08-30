function createPanel(suggestions) {
  const panel = document.createElement("details");
  panel.id = "operations-learning-panel";
  panel.className = "operations-learning-panel";
  const summary = document.createElement("summary");
  summary.textContent = "Patterns to review (" + suggestions.length + ")";
  const list = document.createElement("div");
  list.className = "operations-learning-panel__list";
  suggestions.forEach((suggestion) => {
    const item = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = suggestion.title;
    const evidence = document.createElement("small");
    evidence.textContent = suggestion.evidence;
    item.append(title, evidence);
    list.append(item);
  });
  panel.append(summary, list);
  return panel;
}

async function loadSuggestions() {
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const result = await response.json().catch(() => ({}));
    return response.ok && Array.isArray(result.learningSuggestions)
      ? result.learningSuggestions
      : [];
  } catch {
    return [];
  }
}

export async function installOperationsLearningPanel() {
  if (typeof document === "undefined") return;
  const suggestions = await loadSuggestions();
  if (!suggestions.length) return;
  const mount = () => {
    if (document.querySelector("#operations-learning-panel")) return;
    const root = document.querySelector("#weekly-plan");
    if (root) root.append(createPanel(suggestions));
  };
  mount();
  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOperationsLearningPanel, { once: true });
  } else installOperationsLearningPanel();
}

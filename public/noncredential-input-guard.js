(() => {
  if (window.__dashboardNoncredentialGuardInstalled) return;
  window.__dashboardNoncredentialGuardInstalled = true;

  const NUMERIC_CONTROL_SELECTOR =
    'input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"]';
  let generatedNameIndex = 0;

  function safeName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function protectOperationalInput(input) {
    if (!(input instanceof HTMLInputElement) || input.type === "password") return;
    if (input.closest('[data-auth-form], form[action*="login"], form[action*="auth"]')) return;

    const originalType = input.getAttribute("type") || "text";
    const numericMode =
      input.getAttribute("inputmode") ||
      (originalType === "number" && input.getAttribute("step") === "1" ? "numeric" : "decimal");

    if (originalType === "number") input.setAttribute("type", "text");
    input.setAttribute("inputmode", numericMode);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-form-type", "other");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-dashboard-noncredential", "true");

    if (!input.name) {
      generatedNameIndex += 1;
      const identity =
        safeName(input.id) ||
        safeName(input.getAttribute("aria-label")) ||
        safeName(input.placeholder) ||
        `field-${generatedNameIndex}`;
      input.name = `dashboard-value-${identity}`;
    }
  }

  function scan(root) {
    if (root instanceof Element && root.matches(NUMERIC_CONTROL_SELECTOR)) {
      protectOperationalInput(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll(NUMERIC_CONTROL_SELECTOR).forEach(protectOperationalInput);
    }
  }

  function start() {
    scan(document);
    new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

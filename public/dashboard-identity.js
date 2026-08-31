(() => {
  const NAME_INPUT_SELECTORS = [
    "#smart-receiving-name",
    ".staff-prep-name-field input[type=\"text\"]",
    "[data-order-draft-manager]",
    "[data-order-adjustment-manager]",
    "#weekly-plan-finish-actor",
    "[data-current-user-name-input]",
  ].join(",");

  function roleLabel(role) {
    return role === "owner" ? "Admin" : "Staff";
  }

  function markAutomaticField(input, identity) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.value !== identity.name) input.value = identity.name;
    input.readOnly = true;
    input.dataset.identityManaged = "true";
    input.setAttribute("aria-label", "Saved automatically as " + identity.name);
    const field = input.closest("label");
    if (field) field.classList.add("identity-attribution-field");
  }

  function applyIdentity(root, identity) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll(NAME_INPUT_SELECTORS).forEach((input) => {
      markAutomaticField(input, identity);
    });
    scope.querySelectorAll("[data-weekly-ordered-by]").forEach((element) => {
      element.dataset.weeklyOrderedBy = identity.name;
    });
  }

  function renderIdentity(identity) {
    document.documentElement.dataset.dashboardRole = identity.role;
    document.documentElement.dataset.dashboardUser = identity.id;

    const heading = document.querySelector("header.topbar h1, .topbar h1");
    if (heading && !heading.querySelector(".dashboard-current-user")) {
      heading.classList.add("has-dashboard-identity");
      const badge = document.createElement("span");
      badge.className = "dashboard-current-user";
      badge.textContent = identity.name + " | " + roleLabel(identity.role);
      heading.appendChild(badge);
    }

    const baseTitle = document.title.replace(/^[^|]+ \| /, "");
    document.title = identity.name + " | " + baseTitle;
    applyIdentity(document, identity);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) applyIdentity(node, identity);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function loadIdentity() {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result?.user || (
      result?.name && result?.role
        ? { id: "", name: result.name, role: result.role }
        : null
    );
  }

  const identityPromise = loadIdentity()
    .then((identity) => {
      if (!identity?.name || !identity?.role) return null;
      window.onParDashboardIdentity = identity;
      renderIdentity(identity);
      window.dispatchEvent(new CustomEvent("onpar:identity-ready", { detail: identity }));
      return identity;
    })
    .catch(() => null);

  window.onParDashboardIdentityPromise = identityPromise;
})();

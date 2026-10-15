const LOGIN_MESSAGE = "Your dashboard sign-in has expired. Sign in again to continue.";

// Keep authorization failures separate from upstream PMB failures. A paused
// request is returned to its existing save/recovery path; it is never replayed.
export function createDashboardSessionGuard({ fetcher, origin, getIdentity, onRequired = () => {} }) {
  let blocked = false;
  let generation = 0;
  let expectedIdentity = null;
  const protectedRequest = (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, origin);
    return url.origin === origin && url.pathname.startsWith("/api/")
      && !["/api/login", "/api/session", "/api/logout"].includes(url.pathname);
  };
  return {
    isBlocked: () => blocked,
    async fetch(input, options) {
      const guarded = protectedRequest(input);
      if (guarded && blocked) return Response.json({ error: LOGIN_MESSAGE, code: "DASHBOARD_LOGIN_REQUIRED" }, { status: 401 });
      const startedGeneration = generation;
      const response = await fetcher(input, options);
      if (guarded && [401, 403].includes(response.status)) {
        const result = await response.clone().json().catch(() => ({}));
        const loginRequired = ["DASHBOARD_LOGIN_REQUIRED", "DASHBOARD_OWNER_REQUIRED"].includes(result.code)
          || ["Login required.", "Owner login required."].includes(result.error);
        if (loginRequired && !blocked && startedGeneration === generation) {
          expectedIdentity = getIdentity?.();
          blocked = true;
          onRequired();
        }
      }
      return response;
    },
    async resume() {
      const response = await fetcher("/api/session", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(LOGIN_MESSAGE);
      const expected = expectedIdentity || getIdentity?.();
      if (!expected?.id || result.user?.id !== expected.id || result.user?.role !== expected.role) {
        throw new Error("Sign in with the same account that opened this dashboard to keep these edits with their owner.");
      }
      generation += 1;
      blocked = false;
      expectedIdentity = null;
      return result.user;
    },
  };
}

export function mountDashboardSessionRecovery() {
  if (window.onParDashboardSessionGuard) return window.onParDashboardSessionGuard;
  const nativeFetch = window.fetch.bind(window);
  let dialog = null;
  let resuming = null;
  let signingIn = false;
  const guard = createDashboardSessionGuard({
    fetcher: nativeFetch,
    origin: window.location.origin,
    getIdentity: () => window.onParDashboardIdentity,
    onRequired: showSignIn,
  });
  window.fetch = guard.fetch;
  window.onParDashboardSessionGuard = guard;

  function resume() {
    if (!guard.isBlocked()) return Promise.resolve();
    if (resuming) return resuming;
    resuming = guard.resume().then(() => {
      dialog?.close();
      dialog?.remove();
      dialog = null;
      window.dispatchEvent(new CustomEvent("onpar:session-restored"));
    }).finally(() => { resuming = null; });
    return resuming;
  }

  function showSignIn() {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "dashboard-session-dialog";
    dialog.setAttribute("aria-labelledby", "dashboard-session-title");
    dialog.innerHTML = `
      <h2 id="dashboard-session-title">Sign in to continue</h2>
      <p>Your sign-in expired. Your open work is still here. Sign in with the same account to reconnect.</p>
      <form data-auth-form="clock-in">
        <label>Clock-in number<input name="clockIn" type="password" inputmode="numeric" autocomplete="current-password" required></label>
        <button type="submit" class="primary-button">Sign in</button>
      </form>
      <p role="status" aria-live="polite"></p>`;
    dialog.addEventListener("cancel", event => event.preventDefault());
    // Keep dashboard count-navigation shortcuts from consuming Enter here.
    dialog.addEventListener("keydown", event => event.stopPropagation());
    dialog.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = dialog.querySelector("input");
      const button = dialog.querySelector("button");
      const status = dialog.querySelector('[role="status"]');
      button.disabled = true;
      signingIn = true;
      status.textContent = "Signing in…";
      try {
        // Finish an older cross-tab check before submitting new credentials.
        await resuming?.catch(() => {});
        if (!guard.isBlocked()) return;
        const response = await nativeFetch("/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: input.value }), signal: AbortSignal.timeout(15_000),
        });
        input.value = "";
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not sign in.");
        await resume();
      } catch (error) {
        input.value = "";
        status.textContent = error.message || "Could not sign in. Try again.";
      } finally {
        signingIn = false;
        button.disabled = false;
      }
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  // Another tab may have renewed the same login. Verify identity before letting
  // this tab continue; never reload away in-memory edits or clear its journals.
  window.addEventListener("focus", () => { if (!signingIn) void resume().catch(() => {}); });
  return guard;
}

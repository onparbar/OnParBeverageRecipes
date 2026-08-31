"use client";

import { useEffect, useState } from "react";
import { getDashboardPostLoginPath } from "../../lib/dashboard-navigation.mjs";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupIssue, setSetupIssue] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSetupIssue(params.get("setup") || "");
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Could not log in.");

      const params = new URLSearchParams(window.location.search);
      window.location.assign(getDashboardPostLoginPath(result?.role, params.get("next")));
    } catch (error) {
      setMessage(error.message || "Could not log in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="eyebrow">On Par</p>
        <h1>Beverage Dashboard</h1>
        <form className="login-form" data-auth-form="clock-in" onSubmit={handleSubmit}>
          <label>
            <span>Clock-in number</span>
            <input
              autoComplete="current-password"
              autoFocus
              inputMode="numeric"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your clock-in number"
              type="password"
              value={password}
            />
          </label>
          <button className="primary-button" disabled={isSubmitting || !password} type="submit">
            {isSubmitting ? "Checking..." : "Log in"}
          </button>
        </form>
        {setupIssue ? (
          <p className="login-message">
            {setupIssue === "missing-password"
              ? "No dashboard administrator credential is configured."
              : setupIssue === "weak-session-secret"
                ? "DASHBOARD_SESSION_SECRET must contain at least 32 characters."
                : "Set DASHBOARD_SESSION_SECRET in the service environment, then restart the dashboard."}
          </p>
        ) : null}
        {message ? <p className="login-message">{message}</p> : null}
      </section>
    </main>
  );
}

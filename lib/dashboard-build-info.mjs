const DEFAULT_APP_VERSION = "1.0.0";

function clean(value, maxLength = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeVersion(value) {
  const version = clean(value, 40);
  return /^[a-z0-9][a-z0-9._+-]*$/i.test(version) ? version : DEFAULT_APP_VERSION;
}

function safeCommit(value) {
  const commit = clean(value, 64);
  return /^[a-f0-9]{7,64}$/i.test(commit) ? commit.toLowerCase() : "unknown";
}

function safeTimestamp(value) {
  const date = new Date(clean(value, 80));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function deploymentTarget(env) {
  const explicit = clean(env.ONPAR_DEPLOYMENT_TARGET, 30).toLowerCase();
  if (["on-site", "vercel", "development", "test"].includes(explicit)) return explicit;
  if (env.VERCEL) return "vercel";
  if (env.NODE_ENV === "production") return "on-site";
  if (env.NODE_ENV === "test") return "test";
  return "development";
}

export function getDashboardBuildInfo(env = process.env) {
  return {
    service: "onpar-beverage-dashboard",
    version: safeVersion(env.ONPAR_APP_VERSION || env.npm_package_version),
    commit: safeCommit(
      env.ONPAR_BUILD_SHA
      || env.VERCEL_GIT_COMMIT_SHA
      || env.GITHUB_SHA,
    ),
    builtAt: safeTimestamp(env.ONPAR_BUILD_TIMESTAMP),
    target: deploymentTarget(env),
  };
}

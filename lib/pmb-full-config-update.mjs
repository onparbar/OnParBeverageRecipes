import { parsePmbJson } from "./pmb-json.mjs";

const CONFIG_UPDATE_PATHS = ["/api/configupdate", "/m2m/api/configupdate"];
const CONFIG_UPDATE_MESSAGE = "Configuration update sent. Allow the tap walls a few minutes to reconnect.";

function getConfig(env) {
  const baseUrl = String(env.PMB_API_BASE_URL || "").trim().replace(/\/$/, "");
  const username = String(env.PMB_API_USERNAME || "").trim();
  const password = String(env.PMB_API_PASSWORD || "").trim();
  const clientId = Number(env.PMB_API_CLIENT_ID || "910423");
  if (!baseUrl || !username || !password || !Number.isSafeInteger(clientId) || clientId <= 0) {
    throw new Error("PMB connection settings are missing or invalid.");
  }
  return {
    baseUrl,
    username,
    password,
    clientId,
    clientName: String(env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
  };
}

function hasExplicitFailure(body) {
  if (!body || typeof body !== "object") return false;
  return body.ok === false || body.success === false || Boolean(body.error);
}

async function postJson({ config, fetchImpl, path, body, token = "", beforeWrite }) {
  // Prepare the request before checking the window so the guard is the last
  // awaited operation before a configuration write can be dispatched.
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
  if (beforeWrite) await beforeWrite();
  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, options);
    return { status: response.status, json: parsePmbJson(await response.text()) };
  } catch {
    // A timed-out write may have reached PMB. Never retry it or disclose its
    // raw error, which can contain credentials or connection details.
    throw new Error(token
      ? "PMB configuration update outcome is unconfirmed. No automatic retry was attempted."
      : "Could not authenticate the PMB connection.");
  }
}

export async function sendFullPmbConfigUpdate({
  env = process.env,
  fetchImpl = globalThis.fetch,
  beforeWrite = async () => {},
} = {}) {
  const config = getConfig(env);
  const auth = await postJson({
    config,
    fetchImpl,
    path: "/api/authtoken",
    body: {
      username: config.username,
      password: config.password,
      id: config.clientId,
      name: config.clientName,
      type: "json-server-control",
      version: 1,
    },
  });
  if (auth.status !== 200 || !auth.json?.authtoken || hasExplicitFailure(auth.json)) {
    throw new Error(`PMB authentication failed (${auth.status}).`);
  }

  const token = String(auth.json.authtoken);
  for (const path of CONFIG_UPDATE_PATHS) {
    const result = await postJson({
      config,
      fetchImpl,
      path,
      body: { id: String(config.clientId) },
      token,
      beforeWrite,
    });
    if (result.status === 200 && !hasExplicitFailure(result.json)) {
      return { path, message: CONFIG_UPDATE_MESSAGE };
    }
    // Only an endpoint/method-not-found response definitively permits trying
    // the alternate endpoint. All other results stop this repair attempt.
    if (path === CONFIG_UPDATE_PATHS[0] && [404, 405].includes(result.status)) continue;
    throw new Error(`PMB did not confirm the configuration update (${result.status}). No automatic retry was attempted.`);
  }
}

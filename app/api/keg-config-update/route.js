import { NextResponse } from "next/server";

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const safe = [];
    let inString = false;
    let escaping = false;
    for (const char of String(text || "")) {
      if (!inString) {
        if (char === '"') inString = true;
        safe.push(char);
        continue;
      }
      if (escaping) {
        safe.push(char);
        escaping = false;
        continue;
      }
      if (char === "\\") {
        safe.push(char);
        escaping = true;
        continue;
      }
      if (char === '"') {
        safe.push(char);
        inString = false;
        continue;
      }
      if (char === "\n") {
        safe.push("\\n");
        continue;
      }
      if (char === "\r") {
        safe.push("\\r");
        continue;
      }
      safe.push(char);
    }

    try {
      return JSON.parse(safe.join(""));
    } catch {
      return null;
    }
  }
}

async function postJson(baseUrl, path, body, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  return {
    status: response.status,
    json: parseJsonLoose(raw),
    raw,
  };
}

function getConfig() {
  const baseUrl = (process.env.PMB_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Missing PMB_API_BASE_URL in .env.local");
  }
  const username = (process.env.PMB_API_USERNAME || "").trim();
  const password = (process.env.PMB_API_PASSWORD || "").trim();
  if (!username || !password) throw new Error("Missing PMB_API_USERNAME or PMB_API_PASSWORD in .env.local");

  return {
    baseUrl,
    username,
    password,
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: (process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
  };
}

async function getAuthtoken(config) {
  const auth = await postJson(config.baseUrl, "/api/authtoken", {
    username: config.username,
    password: config.password,
    id: config.clientId,
    name: config.clientName,
    type: "json-server-control",
    version: 1,
  });

  if (auth.status !== 200 || !auth.json?.authtoken) {
    throw new Error(`PMB authtoken failed (${auth.status})`);
  }

  return String(auth.json.authtoken);
}

export async function POST() {
  try {
    const config = getConfig();
    const token = await getAuthtoken(config);

    for (const path of ["/api/configupdate", "/m2m/api/configupdate"]) {
      const result = await postJson(config.baseUrl, path, { id: String(config.clientId) }, token);
      if (result.status === 200) {
        return NextResponse.json({
          ok: true,
          message: "Configuration update sent to the pour wall.",
          path,
        });
      }
    }

    throw new Error("PMB config update failed.");
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not send config update." },
      { status: 500 },
    );
  }
}

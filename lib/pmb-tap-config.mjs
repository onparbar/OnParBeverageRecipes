import crypto from "node:crypto";
import http from "node:http";

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseDigestChallenge(header) {
  const digest = String(header || "").replace(/^Digest\s+/i, "");
  const parts = digest.match(/(?:[^,"]|"[^"]*")+/g) || [];
  return parts.reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = rest.join("=").replace(/^"|"$/g, "");
    return acc;
  }, {});
}

function httpRequest(config, method, requestPath, body = "", headers = {}, timeoutMs = 15000) {
  const url = new URL(config.baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: requestPath,
        method,
        headers: {
          Accept: "text/html,*/*",
          "User-Agent": "curl/8.7.1",
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            raw: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new Error("PMB management UI request timed out.")));
    if (body) request.write(body);
    request.end();
  });
}

function absorbCookies(headers, cookieJar) {
  const setCookie = headers?.["set-cookie"];
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  values.forEach((value) => {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) cookieJar.set(first.slice(0, index), first.slice(index + 1));
  });
}

function buildCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function buildDigestAuthorization(config, method, requestPath, challenge) {
  const qop = String(challenge.qop || "auth").split(",")[0].trim() || "auth";
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${config.username}:${challenge.realm}:${config.password}`);
  const ha2 = md5(`${method}:${requestPath}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  return [
    `Digest username="${config.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${requestPath}"`,
    "algorithm=MD5",
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
  ].join(", ");
}

async function getDigestPage(config, requestPath, { cookieJar = new Map(), timeoutMs = 15000 } = {}) {
  const firstCookie = buildCookieHeader(cookieJar);
  const first = await httpRequest(config, "GET", requestPath, "", {
    ...(firstCookie ? { Cookie: firstCookie } : {}),
  }, timeoutMs).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management page request failed.",
  }));
  absorbCookies(first.headers, cookieJar);

  if (first.status !== 401) return first;

  const challenge = parseDigestChallenge(first.headers["www-authenticate"]);
  if (!challenge.realm || !challenge.nonce) return first;

  const cookie = buildCookieHeader(cookieJar);
  const authorization = buildDigestAuthorization(config, "GET", requestPath, challenge);
  return httpRequest(config, "GET", requestPath, "", {
    Authorization: authorization,
    ...(cookie ? { Cookie: cookie } : {}),
  }, timeoutMs).then((responseResult) => {
    absorbCookies(responseResult.headers, cookieJar);
    return responseResult;
  }).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management page request failed.",
  }));
}

export function decodeHtml(value) {
  return clean(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " "));
}

export function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

export function parseTapConfigRows(html) {
  const rows = [];
  const rowPattern = /<tr id="dev(\d+)(?:_r(\d+))?">([\s\S]*?)(?=<tr id="dev|<\/tbody>)/g;
  let match;

  while ((match = rowPattern.exec(html))) {
    const deviceId = Number(match[1] || 0);
    const body = match[3] || "";
    const pluCell = body.match(/<td class="plunum">([\s\S]*?)<\/td>/);
    if (!deviceId || !pluCell) continue;

    const pluText = stripHtml(pluCell[1]);
    const lineNum = Number(pluText.match(/^(\d+):/)?.[1] || match[2] || 0);
    const plu = Number(pluText.match(/PLU#(\d+)/)?.[1] || 0);
    const product = clean(stripHtml(pluText.replace(/^\d+:\s*/, "").replace(/^PLU#\d+\s*/, "")));
    const lineName = decodeHtml(body.match(/<input type="text" name="fd_line_name"[^>]*value="([^"]*)"/)?.[1] || "");
    const tapNumber = Number(lineName || 0) || null;

    rows.push({
      tapNumber,
      deviceId,
      lineNum,
      plu: plu || null,
      product,
      unused: /unused/i.test(pluText),
    });
  }

  return rows;
}

export async function getTapConfigRows(config, { timeoutMs = 15000 } = {}) {
  const cookieJar = new Map();
  const page = await getDigestPage(config, "/pages/tapconfig", { cookieJar, timeoutMs });
  if (page.status !== 200) {
    throw new Error(`PMB tapconfig page failed (${page.status || 0}).`);
  }
  const rows = parseTapConfigRows(page.raw);
  if (!rows.length) throw new Error("PMB tapconfig did not include any tap rows.");
  return rows;
}

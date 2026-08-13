import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 4;

export class SafeRemoteFetchError extends Error {
  constructor(message, { code = "REMOTE_FETCH_BLOCKED", status = 400 } = {}) {
    super(message);
    this.name = "SafeRemoteFetchError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, options) {
  throw new SafeRemoteFetchError(message, options);
}

function parseIpv4(address) {
  const parts = String(address || "").split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte, index) => (
    !Number.isInteger(byte)
    || byte < 0
    || byte > 255
    || String(byte) !== parts[index]
  ))) return null;
  return bytes;
}

function isPublicIpv4(address) {
  const bytes = parseIpv4(address);
  if (!bytes) return false;
  const [a, b] = bytes;

  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
  );
}

function expandIpv6(address) {
  let value = String(address || "").toLowerCase().split("%")[0];
  const ipv4Match = value.match(/((?:\d{1,3}\.){3}\d{1,3})$/);
  if (ipv4Match) {
    const bytes = parseIpv4(ipv4Match[1]);
    if (!bytes) return null;
    const high = ((bytes[0] << 8) | bytes[1]).toString(16);
    const low = ((bytes[2] << 8) | bytes[3]).toString(16);
    value = `${value.slice(0, -ipv4Match[1].length)}${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function ipv6PrefixMatches(groups, prefix, bits) {
  const prefixGroups = expandIpv6(prefix);
  if (!groups || !prefixGroups) return false;
  const completeGroups = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < completeGroups; index += 1) {
    if (groups[index] !== prefixGroups[index]) return false;
  }
  if (!remainingBits) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (groups[completeGroups] & mask) === (prefixGroups[completeGroups] & mask);
}

function isPublicIpv6(address) {
  const groups = expandIpv6(address);
  if (!groups) return false;

  if (
    ipv6PrefixMatches(groups, "::", 128)
    || ipv6PrefixMatches(groups, "::1", 128)
    || ipv6PrefixMatches(groups, "fc00::", 7)
    || ipv6PrefixMatches(groups, "fe80::", 10)
    || ipv6PrefixMatches(groups, "ff00::", 8)
    || ipv6PrefixMatches(groups, "2001:db8::", 32)
    || ipv6PrefixMatches(groups, "2001::", 32)
    || ipv6PrefixMatches(groups, "2001:2::", 48)
    || ipv6PrefixMatches(groups, "2001:10::", 28)
    || ipv6PrefixMatches(groups, "2001:20::", 28)
    || ipv6PrefixMatches(groups, "2002::", 16)
  ) return false;

  if (ipv6PrefixMatches(groups, "::ffff:0:0", 96)) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return isPublicIpv4(mapped);
  }

  // Remote images/search results do not need transition, documentation, or
  // private IPv6 space. Limiting to ordinary global unicast prevents obscure
  // address encodings from reaching a local or IPv4-transition target.
  return ipv6PrefixMatches(groups, "2000::", 3);
}

export function isPublicIpAddress(address) {
  const version = net.isIP(String(address || ""));
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return (
    !normalized
    || normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home")
    || normalized.endsWith(".lan")
  );
}

export async function requirePublicRemoteUrl(
  input,
  { lookupImpl = dnsLookup } = {},
) {
  let url;
  try {
    url = input instanceof URL ? new URL(input) : new URL(String(input || ""));
  } catch {
    fail("Remote URL is invalid.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    fail("Remote URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) fail("Remote URL cannot contain credentials.");
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) fail("Remote URL must use a standard web port.");
  if (isBlockedHostname(url.hostname)) fail("Remote URL host is not allowed.");

  if (net.isIP(url.hostname)) {
    if (!isPublicIpAddress(url.hostname)) fail("Remote URL cannot use a private or local address.");
    return url;
  }

  let addresses;
  try {
    addresses = await lookupImpl(url.hostname, { all: true, verbatim: true });
  } catch {
    fail("Remote URL host could not be resolved.", { code: "REMOTE_HOST_UNAVAILABLE", status: 502 });
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    fail("Remote URL host could not be resolved.", { code: "REMOTE_HOST_UNAVAILABLE", status: 502 });
  }
  if (addresses.some((entry) => !isPublicIpAddress(entry?.address))) {
    fail("Remote URL resolved to a private or local address.");
  }
  return url;
}

async function resolvePublicRemoteTarget(url, lookupImpl) {
  const validatedUrl = await requirePublicRemoteUrl(url, { lookupImpl });
  if (net.isIP(validatedUrl.hostname)) {
    return {
      url: validatedUrl,
      addresses: [{ address: validatedUrl.hostname, family: net.isIP(validatedUrl.hostname) }],
    };
  }

  let addresses;
  try {
    addresses = await lookupImpl(validatedUrl.hostname, { all: true, verbatim: true });
  } catch {
    fail("Remote URL host could not be resolved.", { code: "REMOTE_HOST_UNAVAILABLE", status: 502 });
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    fail("Remote URL host could not be resolved.", { code: "REMOTE_HOST_UNAVAILABLE", status: 502 });
  }
  if (addresses.some((entry) => !isPublicIpAddress(entry?.address))) {
    fail("Remote URL resolved to a private or local address.");
  }
  return {
    url: validatedUrl,
    addresses: addresses.map((entry) => ({
      address: String(entry.address),
      family: Number(entry.family) || net.isIP(entry.address),
    })),
  };
}

function createPinnedDispatcher(addresses) {
  let nextAddress = 0;
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const candidates = options?.family
          ? addresses.filter((entry) => entry.family === Number(options.family))
          : addresses;
        const available = candidates.length ? candidates : addresses;
        if (options?.all) {
          callback(null, available.map((entry) => ({ ...entry })));
          return;
        }
        const selected = available[nextAddress % available.length];
        nextAddress += 1;
        callback(null, selected.address, selected.family);
      },
    },
  });
}

function contentTypeMatches(contentType, acceptedTypes) {
  if (!acceptedTypes?.length) return true;
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  return acceptedTypes.some((accepted) => {
    const rule = String(accepted || "").toLowerCase();
    return rule.endsWith("/*")
      ? normalized.startsWith(rule.slice(0, -1))
      : normalized === rule;
  });
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    fail(`Remote response exceeds the ${maxBytes}-byte limit.`, {
      code: "REMOTE_RESPONSE_TOO_LARGE",
      status: 413,
    });
  }

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      fail(`Remote response exceeds the ${maxBytes}-byte limit.`, {
        code: "REMOTE_RESPONSE_TOO_LARGE",
        status: 413,
      });
    }
    return buffer;
  }

  const chunks = [];
  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      fail(`Remote response exceeds the ${maxBytes}-byte limit.`, {
        code: "REMOTE_RESPONSE_TOO_LARGE",
        status: 413,
      });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function fetchRemoteBuffer(input, {
  acceptedContentTypes = [],
  fetchImpl = undiciFetch,
  headers = {},
  lookupImpl = dnsLookup,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    fail("Remote fetch is unavailable.", { code: "REMOTE_FETCH_UNAVAILABLE", status: 503 });
  }
  const byteLimit = Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES);
  let target = await resolvePublicRemoteTarget(input, lookupImpl);
  let url = target.url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response;
    const dispatcher = fetchImpl === undiciFetch ? createPinnedDispatcher(target.addresses) : null;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (error) {
      if (dispatcher) await dispatcher.destroy().catch(() => {});
      fail(error?.name === "TimeoutError" ? "Remote request timed out." : "Remote request failed.", {
        code: "REMOTE_FETCH_UNAVAILABLE",
        status: 502,
      });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
      if (dispatcher) await dispatcher.destroy().catch(() => {});
      if (!location) fail("Remote redirect did not include a destination.", { status: 502 });
      if (redirectCount >= maxRedirects) {
        fail("Remote request exceeded the redirect limit.", { code: "REMOTE_REDIRECT_LIMIT", status: 502 });
      }
      target = await resolvePublicRemoteTarget(new URL(location, url), lookupImpl);
      url = target.url;
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    if (response.ok && !contentTypeMatches(contentType, acceptedContentTypes)) {
      if (response.body?.cancel) await response.body.cancel().catch(() => {});
      if (dispatcher) await dispatcher.destroy().catch(() => {});
      fail("Remote response has an unsupported content type.", {
        code: "REMOTE_CONTENT_TYPE_INVALID",
        status: 415,
      });
    }
    let buffer;
    try {
      buffer = await readBoundedBody(response, byteLimit);
    } finally {
      if (dispatcher) await dispatcher.destroy().catch(() => {});
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      url: url.toString(),
      buffer,
      text: () => buffer.toString("utf8"),
    };
  }

  fail("Remote request failed.", { code: "REMOTE_FETCH_UNAVAILABLE", status: 502 });
}

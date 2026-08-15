function firstForwardedValue(value) {
  return String(value || "").split(",", 1)[0].trim();
}

export function buildPublicUrl({ headers, fallbackUrl, pathname }) {
  const protocol = firstForwardedValue(headers.get("x-forwarded-proto"))
    || fallbackUrl.protocol.replace(":", "")
    || "https";
  const host = firstForwardedValue(headers.get("x-forwarded-host"))
    || headers.get("host")
    || fallbackUrl.host;
  return new URL(pathname, `${protocol}://${host}`);
}

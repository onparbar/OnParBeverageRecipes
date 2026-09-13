export function requireDailyReportOrigin(request, env = process.env) {
  const supplied = request.headers.get('origin');
  const crossSite = request.headers.get('sec-fetch-site') === 'cross-site';
  // The on-site proxy gives Next an internal URL. Trust the configured public
  // origin, not arbitrary Host or X-Forwarded-Host values supplied by a caller.
  const publicOrigin = new URL(env.ONPAR_PRODUCTION_URL || 'https://onparbev.com').origin;
  const allowed = new Set([publicOrigin]);
  if (env.NODE_ENV !== 'production') allowed.add(new URL(request.url).origin);
  if (crossSite || (supplied && !allowed.has(supplied))) {
    throw Object.assign(new Error('Same-origin request required.'), { status: 403 });
  }
}

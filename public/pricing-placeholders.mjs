export function isPricingPlaceholder(value) {
  const name = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bcomingsoon\b/g, "coming soon");
  // Match the placeholder label, not real products in the Coming Soon section.
  return /^(?:(?:main|patio|karaoke)(?: wall)? )?(?:tap \d+ )?coming soon(?: (?:tap )?\d+)?$/.test(name);
}

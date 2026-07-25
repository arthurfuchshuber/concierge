// Shared validation for host-supplied Airbnb iCal URLs.
// Prevents SSRF by requiring HTTPS + an allowlisted calendar-provider hostname.

const ALLOWED_HOST_SUFFIXES = [
  "airbnb.com",
  "airbnb.com.br",
  "airbnb.co.uk",
  "airbnb.ca",
  "airbnb.com.au",
  "airbnb.fr",
  "airbnb.de",
  "airbnb.es",
  "airbnb.it",
  "airbnb.pt",
  "airbnb.mx",
  "airbnb.jp",
  "airbnb.co.in",
  "muscache.com",
];

export function isAllowedIcalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  // Block IP literals and localhost outright.
  if (/^[0-9.]+$/.test(host) || host.includes(":") || host === "localhost") return false;
  // Match airbnb.<tld> or any allowlisted suffix as full domain or subdomain.
  if (/^([a-z0-9-]+\.)*airbnb\.[a-z.]{2,}$/i.test(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suf) => host === suf || host.endsWith("." + suf));
}

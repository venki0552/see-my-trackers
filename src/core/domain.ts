import { getDomain, getHostname } from 'tldts';

/** Registrable domain (eTLD+1) for a URL or hostname. Falls back to the hostname (IPs, localhost). */
export function siteOf(urlOrHost: string): string {
  if (!urlOrHost) return '';
  const host = urlOrHost.includes('/') ? getHostname(urlOrHost) ?? '' : urlOrHost;
  if (!host) return '';
  const d = getDomain(host, { allowPrivateDomains: false });
  return (d ?? host).toLowerCase();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return (getHostname(url) ?? '').toLowerCase();
  }
}

export function isWebUrl(url: string | undefined): url is string {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * Third-party test. A request is first-party if it shares the eTLD+1 with the page,
 * or if both are owned by the same organization (e.g. ytimg.com on youtube.com).
 */
export function isThirdParty(
  reqHost: string,
  pageSite: string,
  ownerOf?: (hostOrSite: string) => string | null,
): boolean {
  const reqSite = siteOf(reqHost);
  if (!reqSite || !pageSite) return false;
  if (reqSite === pageSite) return false;
  if (ownerOf) {
    const a = ownerOf(reqHost);
    const b = ownerOf(pageSite);
    if (a && b && a === b) return false;
  }
  return true;
}

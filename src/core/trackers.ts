import type { Category, Tier, TrackerInfo } from './types';

export interface TrackerData {
  v: string;
  domains: Record<string, string>;
  patterns: Record<string, [string, Category, string | null]>;
  orgs: Record<string, [string, string | null, string | null, string | null]>;
}

export const TRACKING_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'advertising', 'site_analytics', 'social_media', 'pornvertising',
]);
export const OTHER_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'customer_interaction', 'audio_video_player', 'misc',
]);

export function tierOf(category: Category | null | undefined): Tier {
  if (!category) return 'unknown';
  if (TRACKING_CATEGORIES.has(category)) return 'tracking';
  if (OTHER_CATEGORIES.has(category)) return 'other';
  return 'functional';
}

export const CATEGORY_LABEL: Record<Category, string> = {
  advertising: 'Advertising',
  audio_video_player: 'Video / audio player',
  consent: 'Consent management',
  customer_interaction: 'Chat / customer interaction',
  extensions: 'Browser extension',
  hosting: 'Hosting / CDN',
  misc: 'Miscellaneous',
  pornvertising: 'Adult advertising',
  site_analytics: 'Analytics',
  social_media: 'Social media',
  utilities: 'Utilities',
};

export class TrackerIndex {
  private cache = new Map<string, TrackerInfo | null>();
  constructor(private data: TrackerData) {}

  get version(): string {
    return this.data.v;
  }

  /** Longest-suffix match: a.b.example.com → b.example.com → example.com */
  lookup(host: string): TrackerInfo | null {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (this.cache.has(h)) return this.cache.get(h)!;
    let result: TrackerInfo | null = null;
    const parts = h.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      const pid = this.data.domains[candidate];
      if (pid) {
        result = this.build(pid);
        break;
      }
    }
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(h, result);
    return result;
  }

  /** Organization id for a host, used for same-owner first-party checks. */
  ownerOf = (host: string): string | null => this.lookup(host)?.orgId ?? null;

  orgName(orgId: string): string {
    return this.data.orgs[orgId]?.[0] ?? orgId;
  }

  orgMeta = (orgId: string): { country: string | null; privacyContact: string | null; privacyPolicy: string | null } | null => {
    const o = this.data.orgs[orgId];
    return o ? { country: o[1], privacyContact: o[2], privacyPolicy: o[3] } : null;
  };

  /** All domains belonging to an organization (for Enforce mode rules). */
  domainsOfOrg(orgId: string): string[] {
    const pids = new Set(
      Object.entries(this.data.patterns).filter(([, p]) => p[2] === orgId).map(([pid]) => pid),
    );
    return Object.entries(this.data.domains).filter(([, pid]) => pids.has(pid)).map(([d]) => d);
  }

  private build(pid: string): TrackerInfo | null {
    const p = this.data.patterns[pid];
    if (!p) return null;
    const [name, category, orgId] = p;
    const org = orgId ? this.data.orgs[orgId] : undefined;
    return {
      pattern: pid,
      name,
      category,
      orgId: orgId ?? pid,
      orgName: org?.[0] ?? name,
      country: org?.[1] ?? null,
      privacyContact: org?.[2] ?? null,
      privacyPolicy: org?.[3] ?? null,
    };
  }
}

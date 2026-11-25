/** Cross-browser extension API handle: Firefox exposes promise-based `browser`, Chrome MV3 `chrome`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: typeof chrome = ((globalThis as any).browser ?? (globalThis as any).chrome) as typeof chrome;

export const IS_FIREFOX = typeof (globalThis as any).browser !== 'undefined' && !!(globalThis as any).browser?.runtime?.getBrowserInfo;

export interface Settings {
  gpc: boolean;
  retentionDays: number;
  enforce: Record<string, boolean>;
  pausedSites: Record<string, boolean>;
  salt: string;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'salt'> = {
  gpc: true,
  retentionDays: 30,
  enforce: {},
  pausedSites: {},
  onboarded: false,
};

export type Msg =
  | { type: 'getTabReport'; tabId: number }
  | { type: 'getSiteReport'; site: string }
  | { type: 'getProfile' }
  | { type: 'listSites' }
  | { type: 'setManualReceipt'; tabId: number; choice: 'rejected' | 'accepted' }
  | { type: 'setEnforce'; site: string; on: boolean }
  | { type: 'setPaused'; site: string; on: boolean }
  | { type: 'exportSite'; site: string }
  | { type: 'getSettings' }
  | { type: 'setSettings'; patch: Partial<Omit<Settings, 'salt'>> }
  | { type: 'wipe' }
  | { type: 'stats' };

/** Messages from content scripts (relay → background). */
export type PageMsg =
  | { type: 'page'; kind: 'consent'; payload: unknown }
  | { type: 'page'; kind: 'cmp'; payload: { name: string } }
  | { type: 'page'; kind: 'fingerprint'; payload: { api: string; scriptUrl: string | null } }
  | { type: 'page'; kind: 'cookieWrite'; payload: { name: string; scriptUrl: string | null } };

export const PAGE_TAG = '__smt_v1__';

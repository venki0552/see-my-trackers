export type Phase = 'pre_choice' | 'after_reject' | 'after_accept' | 'after_partial' | 'no_banner';
export type Choice = 'rejected' | 'accepted' | 'partial' | 'unknown';
export type ConsentSource =
  | 'tcf' | 'gpp' | 'onetrust' | 'cookiebot' | 'didomi' | 'usercentrics' | 'gcm' | 'manual';

export type Category =
  | 'advertising' | 'audio_video_player' | 'consent' | 'customer_interaction' | 'extensions'
  | 'hosting' | 'misc' | 'pornvertising' | 'site_analytics' | 'social_media' | 'utilities';

export type Tier = 'tracking' | 'other' | 'functional' | 'unknown';

export interface TrackerInfo {
  pattern: string;
  name: string;
  category: Category;
  orgId: string | null;
  orgName: string;
  country: string | null;
  privacyContact: string | null;
  privacyPolicy: string | null;
}

export interface ConsentState {
  source: ConsentSource;
  choice: Choice;
  /** true when the CMP says the user has actively made a choice (vs defaults) */
  userActed: boolean;
  purposes?: Record<string, boolean>;
  legitimateInterest?: Record<string, boolean>;
  vendorConsentCount?: number;
  cmpId?: number;
  raw?: string; // short, human-readable summary only (never the full string)
}

export interface ConsentReceipt extends ConsentState {
  site: string;
  ts: number;
  gpc: boolean;
}

export type EventKind = 'request' | 'cookie_set' | 'cookie_sent' | 'fingerprint' | 'storage' | 'blocked' | 'idsync';

export interface TrackerEvent {
  ts: number;
  tabId: number;
  site: string;
  host: string;
  hostSite: string;
  orgId: string | null;
  orgName: string | null;
  category: Category | null;
  tier: Tier;
  kind: EventKind;
  reqType?: string;
  dataSending: boolean;
  phase: Phase;
  urlRedacted?: string;
  detail?: Record<string, unknown>;
}

export type Severity = 'high' | 'medium' | 'info';
export type Confidence = 'high' | 'medium' | 'heuristic';

export interface Finding {
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10';
  severity: Severity;
  confidence: Confidence;
  orgId: string | null;
  orgName: string;
  count: number;
  firstTs: number;
  hosts: string[];
  text: string;
}

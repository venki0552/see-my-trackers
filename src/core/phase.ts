import type { ConsentReceipt, Phase } from './types';

/**
 * Phase of an event at time `ts` given the site's receipts (any order) and whether a consent
 * platform (CMP) was detected on the page. Computed at report time so that receipts arriving
 * later (e.g. CMP detected after early requests) relabel earlier events correctly.
 */
export function phaseAt(ts: number, receipts: readonly ConsentReceipt[], cmpDetected: boolean): Phase {
  let latest: ConsentReceipt | null = null;
  for (const r of receipts) {
    if (!r.userActed) continue;
    if (r.ts <= ts && (!latest || r.ts >= latest.ts)) latest = r;
  }
  if (latest) {
    switch (latest.choice) {
      case 'rejected': return 'after_reject';
      case 'accepted': return 'after_accept';
      case 'partial': return 'after_partial';
      default: break;
    }
  }
  return cmpDetected || receipts.length > 0 ? 'pre_choice' : 'no_banner';
}

/** Latest acted receipt (the user's current state on the site). */
export function currentReceipt(receipts: readonly ConsentReceipt[]): ConsentReceipt | null {
  let latest: ConsentReceipt | null = null;
  for (const r of receipts) if (r.userActed && (!latest || r.ts >= latest.ts)) latest = r;
  return latest;
}

export const PHASE_LABEL: Record<Phase, string> = {
  after_reject: 'After you rejected',
  after_partial: 'After you allowed only some purposes',
  after_accept: 'After you accepted',
  pre_choice: 'Before any consent choice',
  no_banner: 'No consent banner detected',
};

/** Wording for "after you <verb>": US opt-out signals (GPP) are an opt-out of sale/sharing, not a full rejection. */
export function rejectVerb(receipt: ConsentReceipt | null): { past: string; short: string } {
  if (receipt && receipt.source === 'gpp') return { past: 'opted out of sale/sharing', short: 'opted out' };
  return { past: 'rejected tracking', short: 'rejected' };
}

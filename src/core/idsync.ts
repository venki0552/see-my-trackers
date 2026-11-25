/**
 * Tracks hashed identifier values per page (tab) and reports when the same value reaches two or
 * more different third-party organizations, a strong sign of ID syncing / identifier sharing.
 */
export class IdSyncTracker {
  private seen = new Map<string, Set<string>>();
  private reported = new Set<string>();

  /** Returns the org set when the value reaches 2+ orgs for the first time, else null. */
  record(hash: string, org: string): string[] | null {
    let s = this.seen.get(hash);
    if (!s) {
      if (this.seen.size > 20000) this.seen.clear();
      s = new Set();
      this.seen.set(hash, s);
    }
    s.add(org);
    if (s.size >= 2 && !this.reported.has(hash)) {
      this.reported.add(hash);
      return [...s];
    }
    if (s.size > 2 && this.reported.has(hash)) return [...s]; // a new org joined
    return null;
  }

  orgsFor(hash: string): string[] {
    return [...(this.seen.get(hash) ?? [])];
  }

  reset(): void {
    this.seen.clear();
    this.reported.clear();
  }
}

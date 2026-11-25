import type { ConsentReceipt, Phase, TrackerEvent, Tier, Category } from '../core/types';

/** Minimal promise wrapper over IndexedDB (works in Chrome service workers and Firefox event pages). */
const DB_NAME = 'smt';
const DB_VERSION = 1;

export interface OrgSiteAgg {
  key: string; // `${orgKey}|${site}`
  orgKey: string;
  orgName: string;
  category: Category | null;
  tier: Tier;
  site: string;
  firstTs: number;
  lastTs: number;
  counts: Partial<Record<Phase, number>>;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ev = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      ev.createIndex('site', 'site');
      ev.createIndex('ts', 'ts');
      db.createObjectStore('receipts', { keyPath: 'site' });
      const agg = db.createObjectStore('orgsites', { keyPath: 'key' });
      agg.createIndex('orgKey', 'orgKey');
      agg.createIndex('site', 'site');
      agg.createIndex('lastTs', 'lastTs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

// ---------- events (batched) ----------
let buffer: Array<{ e: TrackerEvent; phase: Phase }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function addEvent(e: TrackerEvent): void {
  buffer.push({ e, phase: e.phase });
  if (buffer.length >= 200) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), 400);
}

export async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  await tx(['events', 'orgsites'], 'readwrite', async (t) => {
    const ev = t.objectStore('events');
    const agg = t.objectStore('orgsites');
    const pending = new Map<string, OrgSiteAgg>();
    for (const { e, phase } of batch) {
      ev.add(e);
      if (e.tier === 'functional') continue;
      const orgKey = e.orgId ?? `host:${e.hostSite}`;
      const key = `${orgKey}|${e.site}`;
      let a = pending.get(key);
      if (!a) {
        a = (await reqP(agg.get(key))) as OrgSiteAgg | undefined ?? {
          key, orgKey, orgName: e.orgName ?? e.hostSite, category: e.category, tier: e.tier,
          site: e.site, firstTs: e.ts, lastTs: e.ts, counts: {},
        };
        pending.set(key, a);
      }
      if (e.tier === 'tracking') a.tier = 'tracking';
      a.lastTs = Math.max(a.lastTs, e.ts);
      if (e.kind !== 'blocked') a.counts[phase] = (a.counts[phase] ?? 0) + 1;
    }
    for (const a of pending.values()) agg.put(a);
  }).catch((err) => console.warn('[smt] flush failed', err));
}

export async function eventsForSite(site: string, sinceTs = 0, tabId?: number): Promise<TrackerEvent[]> {
  await flush();
  return tx(['events'], 'readonly', async (t) => {
    const all = (await reqP(t.objectStore('events').index('site').getAll(IDBKeyRange.only(site)))) as TrackerEvent[];
    return all.filter((e) => e.ts >= sinceTs && (tabId === undefined || e.tabId === tabId));
  });
}

export async function allAggregates(): Promise<OrgSiteAgg[]> {
  await flush();
  return tx(['orgsites'], 'readonly', (t) => reqP(t.objectStore('orgsites').getAll()) as Promise<OrgSiteAgg[]>);
}

export async function aggregatesForSite(site: string): Promise<OrgSiteAgg[]> {
  await flush();
  return tx(['orgsites'], 'readonly', (t) => reqP(t.objectStore('orgsites').index('site').getAll(IDBKeyRange.only(site))) as Promise<OrgSiteAgg[]>);
}

// ---------- receipts ----------
const receiptCache = new Map<string, ConsentReceipt[]>();

export async function getReceipts(site: string): Promise<ConsentReceipt[]> {
  const c = receiptCache.get(site);
  if (c) return c;
  const row = await tx(['receipts'], 'readonly', (t) => reqP(t.objectStore('receipts').get(site))) as { site: string; list: ConsentReceipt[] } | undefined;
  const list = row?.list ?? [];
  receiptCache.set(site, list);
  return list;
}

export function cachedReceipts(site: string): ConsentReceipt[] | undefined {
  return receiptCache.get(site);
}

export async function addReceipt(r: ConsentReceipt): Promise<boolean> {
  const list = [...(await getReceipts(r.site))];
  const lastSame = [...list].reverse().find((x) => x.source === r.source);
  if (lastSame && lastSame.choice === r.choice && lastSame.userActed === r.userActed
      && JSON.stringify(lastSame.purposes ?? {}) === JSON.stringify(r.purposes ?? {})) {
    return false; // unchanged state re-reported on page load
  }
  list.push(r);
  while (list.length > 50) list.shift();
  receiptCache.set(r.site, list);
  await tx(['receipts'], 'readwrite', (t) => { t.objectStore('receipts').put({ site: r.site, list }); });
  return true;
}

export async function allReceiptSites(): Promise<Array<{ site: string; list: ConsentReceipt[] }>> {
  return tx(['receipts'], 'readonly', (t) => reqP(t.objectStore('receipts').getAll())) as Promise<Array<{ site: string; list: ConsentReceipt[] }>>;
}

// ---------- maintenance ----------
export async function purgeOlderThan(ts: number): Promise<number> {
  await flush();
  return tx(['events', 'orgsites'], 'readwrite', async (t) => {
    let n = 0;
    await new Promise<void>((resolve, reject) => {
      const cur = t.objectStore('events').index('ts').openCursor(IDBKeyRange.upperBound(ts));
      cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); n++; c.continue(); } else resolve(); };
      cur.onerror = () => reject(cur.error);
    });
    await new Promise<void>((resolve, reject) => {
      const cur = t.objectStore('orgsites').index('lastTs').openCursor(IDBKeyRange.upperBound(ts));
      cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } else resolve(); };
      cur.onerror = () => reject(cur.error);
    });
    return n;
  });
}

export async function wipeAll(): Promise<void> {
  buffer = [];
  receiptCache.clear();
  await tx(['events', 'receipts', 'orgsites'], 'readwrite', (t) => {
    t.objectStore('events').clear();
    t.objectStore('receipts').clear();
    t.objectStore('orgsites').clear();
  });
}

export async function stats(): Promise<{ events: number; sites: number }> {
  await flush();
  return tx(['events', 'receipts'], 'readonly', async (t) => ({
    events: await reqP(t.objectStore('events').count()),
    sites: await reqP(t.objectStore('receipts').count()),
  }));
}

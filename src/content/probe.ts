/**
 * MAIN-world probe (runs at document_start in every frame, before page scripts).
 * - Reads consent-platform state (TCF, GPP/USP, OneTrust, Cookiebot, Didomi, Usercentrics, Google Consent Mode).
 * - Observes (never alters) browser APIs commonly used for fingerprinting, attributing calls to the calling script.
 * Everything is wrapped in try/catch: the probe must never break a page.
 */
(() => {
  const TAG = '__smt_v1__';
  const w = window as any;
  if (w[TAG + 'probe']) return;
  try { Object.defineProperty(w, TAG + 'probe', { value: true, enumerable: false }); } catch { return; }

  const isTop = (() => { try { return window.top === window; } catch { return false; } })();
  let ready = false;
  const queue: string[] = [];
  const send = (kind: string, payload: unknown) => {
    let s: string;
    try { s = JSON.stringify({ kind, payload }); } catch { return; }
    if (!ready) { if (queue.length < 200) queue.push(s); return; }
    document.dispatchEvent(new CustomEvent(TAG, { detail: s }));
  };
  document.addEventListener(TAG + 'ready', () => {
    if (ready) return;
    ready = true;
    for (const s of queue.splice(0)) document.dispatchEvent(new CustomEvent(TAG, { detail: s }));
  });
  document.dispatchEvent(new CustomEvent(TAG + 'hello'));

  // ---------------- fingerprinting observation ----------------
  const reported = new Set<string>();
  function callerScript(): string | null {
    const stack = new Error().stack ?? '';
    for (const line of stack.split('\n')) {
      const m = line.match(/(https?:\/\/[^\s)]+?):\d+:\d+/);
      if (m && m[1]) return m[1];
    }
    return null;
  }
  function note(apiName: string) {
    try {
      const src = callerScript();
      const key = apiName + '|' + (src ?? '');
      if (reported.has(key) || reported.size > 100) return;
      reported.add(key);
      send('fingerprint', { api: apiName, scriptUrl: src });
    } catch { /* ignore */ }
  }
  function observe(proto: any, name: string, label: string, when?: (args: any[], self: any) => boolean) {
    try {
      if (!proto) return;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || typeof desc.value !== 'function') return;
      const orig = desc.value;
      const proxy = new Proxy(orig, {
        apply(target, thisArg, args) {
          try { if (!when || when(args, thisArg)) note(label); } catch { /* ignore */ }
          return Reflect.apply(target, thisArg, args);
        },
      });
      Object.defineProperty(proto, name, { ...desc, value: proxy });
    } catch { /* ignore */ }
  }
  // Canvas readback (classic canvas fingerprinting). Ignore large canvases (likely real images/editors).
  const smallCanvas = (_a: any[], self: any) => {
    const c = self?.canvas ?? self;
    return !c || (c.width * c.height) <= 400 * 200;
  };
  observe(w.HTMLCanvasElement?.prototype, 'toDataURL', 'canvas.toDataURL', smallCanvas);
  observe(w.HTMLCanvasElement?.prototype, 'toBlob', 'canvas.toBlob', smallCanvas);
  observe(w.CanvasRenderingContext2D?.prototype, 'getImageData', 'canvas.getImageData', smallCanvas);
  // WebGL GPU identification (UNMASKED_VENDOR_WEBGL 0x9245 / UNMASKED_RENDERER_WEBGL 0x9246)
  const unmasked = (args: any[]) => args[0] === 0x9245 || args[0] === 0x9246;
  observe(w.WebGLRenderingContext?.prototype, 'getParameter', 'webgl.unmaskedRenderer', unmasked);
  observe(w.WebGL2RenderingContext?.prototype, 'getParameter', 'webgl.unmaskedRenderer', unmasked);
  // Audio fingerprinting (offline rendering of an oscillator)
  observe(w.OfflineAudioContext?.prototype, 'startRendering', 'audio.offlineRender');
  // Font enumeration: many measureText calls with changing fonts
  try {
    const proto = w.CanvasRenderingContext2D?.prototype;
    const fonts = new Set<string>();
    observe(proto, 'measureText', 'fonts.enumeration', (_a, self) => {
      if (fonts.size > 60) return false;
      fonts.add(String(self?.font ?? ''));
      return fonts.size === 60;
    });
  } catch { /* ignore */ }

  if (!isTop) return; // consent platforms are read from the top frame only

  // ---------------- consent platforms ----------------
  const last: Record<string, string> = {};
  const cmpSeen = new Set<string>();
  const emitConsent = (payload: Record<string, unknown>) => {
    const key = String(payload.type);
    const s = JSON.stringify(payload);
    if (last[key] === s) return;
    last[key] = s;
    send('consent', payload);
  };
  const cmp = (name: string) => { if (!cmpSeen.has(name)) { cmpSeen.add(name); send('cmp', { name }); } };
  const plainMap = (o: any): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    if (o && typeof o === 'object') for (const k of Object.keys(o)) out[k] = o[k] === true;
    return out;
  };

  let tcfListening = false;
  let gppListening = false;
  let dlIndex = 0;

  function pollOnce() {
    // IAB TCF v2
    try {
      if (typeof w.__tcfapi === 'function') {
        cmp('tcf');
        if (!tcfListening) {
          tcfListening = true;
          w.__tcfapi('addEventListener', 2, (tc: any, ok: boolean) => {
            try {
              if (!ok || !tc) return;
              emitConsent({
                type: 'tcf', eventStatus: tc.eventStatus, tcString: tc.tcString ? 'present' : '', cmpId: tc.cmpId,
                gdprApplies: tc.gdprApplies, purposeConsents: plainMap(tc.purpose?.consents),
                purposeLI: plainMap(tc.purpose?.legitimateInterests), vendorConsents: plainMap(tc.vendor?.consents),
              });
            } catch { /* ignore */ }
          });
        }
      }
    } catch { /* ignore */ }
    // IAB GPP + legacy USP
    try {
      if (typeof w.__gpp === 'function' && !gppListening) {
        gppListening = true;
        cmp('gpp');
        const handle = (evt: any) => {
          try {
            const pd = evt?.pingData ?? evt;
            const ps = pd?.parsedSections ?? {};
            const usnat = ps.usnat ?? ps.usnatv1 ?? null;
            const flat = Array.isArray(usnat) ? usnat[0] : usnat;
            emitConsent({ type: 'gpp', signalStatus: pd?.signalStatus, cmpDisplayStatus: pd?.cmpDisplayStatus,
              applicableSections: pd?.applicableSections, usnat: flat ? { SaleOptOut: flat.SaleOptOut, SharingOptOut: flat.SharingOptOut, TargetedAdvertisingOptOut: flat.TargetedAdvertisingOptOut, Gpc: flat.Gpc === true } : null,
              uspv1: typeof ps.uspv1 === 'string' ? ps.uspv1 : null });
          } catch { /* ignore */ }
        };
        try { w.__gpp('addEventListener', handle); } catch { /* ignore */ }
        try { w.__gpp('ping', handle); } catch { /* ignore */ }
      }
      if (typeof w.__uspapi === 'function') {
        w.__uspapi('getUSPData', 1, (d: any, ok: boolean) => {
          if (ok && d?.uspString) emitConsent({ type: 'gpp', signalStatus: 'ready', uspv1: String(d.uspString) });
        });
      }
    } catch { /* ignore */ }
    // OneTrust
    try {
      if (typeof w.OptanonActiveGroups === 'string' || w.OneTrust) {
        cmp('onetrust');
        if (typeof w.OptanonActiveGroups === 'string') {
          emitConsent({ type: 'onetrust', activeGroups: w.OptanonActiveGroups, alertClosed: !!w.OneTrust?.IsAlertBoxClosed?.() });
        }
      }
    } catch { /* ignore */ }
    // Cookiebot
    try {
      if (w.Cookiebot && w.Cookiebot.consent) {
        cmp('cookiebot');
        const c = w.Cookiebot.consent;
        emitConsent({ type: 'cookiebot', hasResponse: !!w.Cookiebot.hasResponse,
          consent: { necessary: !!c.necessary, preferences: !!c.preferences, statistics: !!c.statistics, marketing: !!c.marketing } });
      }
    } catch { /* ignore */ }
    // Didomi
    try {
      if (w.Didomi && typeof w.Didomi.getUserStatus === 'function') {
        cmp('didomi');
        const st = w.Didomi.getUserStatus();
        const g = st?.purposes?.global ?? st?.purposes?.consent ?? {};
        emitConsent({ type: 'didomi', enabled: [...(g.enabled ?? [])].map(String), disabled: [...(g.disabled ?? [])].map(String),
          shouldCollect: typeof w.Didomi.shouldConsentBeCollected === 'function' ? !!w.Didomi.shouldConsentBeCollected() : undefined });
      }
    } catch { /* ignore */ }
    // Usercentrics
    try {
      if (w.UC_UI && typeof w.UC_UI.getServicesBaseInfo === 'function') {
        cmp('usercentrics');
        const services = (w.UC_UI.getServicesBaseInfo() ?? []).map((s: any) => ({ status: !!s?.consent?.status, category: String(s?.categorySlug ?? '') }));
        emitConsent({ type: 'usercentrics', services, consentRequired: typeof w.UC_UI.isConsentRequired === 'function' ? !!w.UC_UI.isConsentRequired() : undefined });
      }
    } catch { /* ignore */ }
    // Google Consent Mode via dataLayer (gtag('consent', 'default'|'update', {...}))
    try {
      const dl = w.dataLayer;
      if (Array.isArray(dl)) {
        for (; dlIndex < dl.length; dlIndex++) {
          const e = dl[dlIndex];
          if (e && e[0] === 'consent' && (e[1] === 'default' || e[1] === 'update') && e[2] && typeof e[2] === 'object') {
            const state: Record<string, string> = {};
            for (const k of ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']) if (typeof e[2][k] === 'string') state[k] = e[2][k];
            cmp('gcm');
            emitConsent({ type: 'gcm', kind: e[1], state });
          }
        }
      }
    } catch { /* ignore */ }
  }

  const schedule = [300, 800, 1500, 2500, 4000, 6000, 9000, 13000, 20000, 30000, 45000, 60000];
  for (const ms of schedule) setTimeout(pollOnce, ms);
  let burst: ReturnType<typeof setTimeout>[] = [];
  const onInteract = () => {
    for (const t of burst) clearTimeout(t);
    burst = [200, 700, 1500, 3000, 6000].map((ms) => setTimeout(pollOnce, ms));
  };
  window.addEventListener('click', onInteract, { capture: true, passive: true });
  window.addEventListener('keydown', onInteract, { capture: true, passive: true });
  for (const ev of ['OneTrustGroupsUpdated', 'CookiebotOnAccept', 'CookiebotOnDecline', 'CookiebotOnConsentReady', 'UC_UI_CMP_EVENT', 'ucEvent']) {
    window.addEventListener(ev, () => setTimeout(pollOnce, 50), { passive: true });
  }
})();

/** ISOLATED-world relay: forwards tagged probe events to the background. */
declare const __TEST__: boolean;
(() => {
  const TAG = '__smt_v1__';
  const api: typeof chrome = ((globalThis as any).browser ?? (globalThis as any).chrome) as typeof chrome;
  const KINDS = new Set(['consent', 'cmp', 'fingerprint']);
  let count = 0;
  document.addEventListener(TAG, (e: Event) => {
    try {
      if (count++ > 300) return;
      const detail = (e as CustomEvent).detail;
      if (typeof detail !== 'string' || detail.length > 20000) return;
      const msg = JSON.parse(detail);
      if (!msg || !KINDS.has(msg.kind)) return;
      api.runtime.sendMessage({ type: 'page', kind: msg.kind, payload: msg.payload }).catch?.(() => {});
    } catch { /* ignore */ }
  });
  if (__TEST__) {
    // Test-only bridge (never present in release builds): lets e2e tests read this tab's report.
    document.addEventListener(TAG + 'test', (e: Event) => {
      const req = JSON.parse(String((e as CustomEvent).detail ?? '{}'));
      api.runtime.sendMessage({ type: 'page', kind: 'test', payload: req }).then((res: unknown) => {
        document.dispatchEvent(new CustomEvent(TAG + 'testResult', { detail: JSON.stringify(res ?? null) }));
      });
    });
  }
  const announce = () => document.dispatchEvent(new CustomEvent(TAG + 'ready'));
  document.addEventListener(TAG + 'hello', announce);
  announce();
})();

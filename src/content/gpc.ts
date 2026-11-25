/** MAIN-world Global Privacy Control signal (registered only while GPC is enabled). */
(() => {
  try {
    const proto = (window as any).Navigator?.prototype;
    if (!proto || (navigator as any).globalPrivacyControl === true) return;
    Object.defineProperty(proto, 'globalPrivacyControl', { get: () => true, configurable: true, enumerable: true });
  } catch { /* ignore */ }
})();

import { api, type Msg } from '../shared/api';

export { api };

/** Element builder. Text is always set via textContent (page-derived strings are hostile input). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function send<T = any>(msg: Msg): Promise<T> {
  return api.runtime.sendMessage(msg) as Promise<T>;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const COUNTRY: Record<string, string> = { US: 'USA', FR: 'France', DE: 'Germany', GB: 'UK', NL: 'Netherlands', IE: 'Ireland', IL: 'Israel', CN: 'China', RU: 'Russia', JP: 'Japan', CA: 'Canada', SE: 'Sweden', ES: 'Spain', IT: 'Italy', IN: 'India', AU: 'Australia', CH: 'Switzerland' };

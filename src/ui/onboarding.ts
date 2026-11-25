import { h, api, send } from './shared';

const root = document.getElementById('app')!;

async function render() {
  const perm = await api.permissions.contains({ origins: ['<all_urls>'] });
  root.replaceChildren(
    h('h1', {}, 'Welcome to See My Trackers'),
    h('p', { class: 'lead' }, 'Cookie banners ask you to choose. This extension checks what happens after you click "Reject".'),
    perm
      ? h('div', { class: 'card ok' }, '✓ Ready. See My Trackers can watch the sites you visit.')
      : h('div', { class: 'card warn' }, h('b', {}, 'One more step: '), 'allow access to websites so the extension can see which companies each page contacts. ',
          h('button', { class: 'primary', onclick: async () => { await api.permissions.request({ origins: ['<all_urls>'] }); void render(); } }, 'Allow access')),
    h('h2', {}, 'How to use it'),
    h('ol', {},
      h('li', {}, 'Visit a website and click "Reject all" (or "Necessary only") on its cookie banner.'),
      h('li', {}, 'Watch the toolbar icon: a red number means tracking companies were contacted after you rejected. Orange means before any consent choice was recorded.'),
      h('li', {}, 'Click the icon to see which companies, what they did (cookies, data sent, fingerprinting), and export the evidence.'),
      h('li', {}, 'Optional: turn on "Enforce my No" to block those companies on that site.')),
    h('h2', {}, 'Your privacy'),
    h('ul', {},
      h('li', {}, 'Everything stays on this device. No accounts, no servers, no analytics.'),
      h('li', {}, 'IDs in web addresses are replaced with hashes before anything is saved.'),
      h('li', {}, 'Global Privacy Control (an opt-out signal) is on by default. You can turn it off in Settings.')),
    h('p', {}, h('a', { href: 'dashboard.html#limitations' }, 'Read what the extension can\'t see'), ' · ', h('a', { href: 'dashboard.html#settings' }, 'Settings')),
    h('button', { class: 'primary', onclick: async () => { await send({ type: 'setSettings', patch: { onboarded: true } }); window.close(); } }, 'Got it'),
  );
}

void render();

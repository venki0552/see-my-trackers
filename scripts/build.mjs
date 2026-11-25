// Builds dist/chrome, dist/edge, dist/firefox from one codebase.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const TEST = process.env.SMT_TEST === '1' || process.env.SMT_VALIDATE === '1';
const READONLY = process.env.SMT_VALIDATE === '1';
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge', 'firefox'];
const GECKO_ID = 'see-my-trackers@seemytrackers.extension';

const base = {
  manifest_version: 3,
  name: 'See My Trackers',
  short_name: 'See My Trackers',
  version: pkg.version,
  description: 'See which companies your browser talks to after you reject cookies, with evidence. Local-only, open source.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_popup: 'popup.html', default_title: 'See My Trackers', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
  permissions: ['webRequest', 'webNavigation', 'cookies', 'storage', 'unlimitedStorage', 'declarativeNetRequest', 'scripting', 'alarms'],
  host_permissions: ['<all_urls>'],
  content_scripts: [
    { matches: ['<all_urls>'], js: ['probe.js'], run_at: 'document_start', all_frames: true, world: 'MAIN' },
    { matches: ['<all_urls>'], js: ['relay.js'], run_at: 'document_start', all_frames: true },
  ],
  options_ui: { page: 'dashboard.html', open_in_tab: true },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
};

function manifestFor(t) {
  const m = structuredClone(base);
  if (t === 'firefox') {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = { gecko: { id: GECKO_ID, strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } }, gecko_android: { strict_min_version: '142.0' } };
    m.permissions = m.permissions.filter((p) => p !== 'unlimitedStorage').concat(['unlimitedStorage']);
  } else {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '111';
  }
  return m;
}

const entries = {
  background: 'src/bg/background.ts',
  probe: 'src/content/probe.ts',
  relay: 'src/content/relay.ts',
  gpc: 'src/content/gpc.ts',
  popup: 'src/ui/popup.ts',
  dashboard: 'src/ui/dashboard.ts',
  onboarding: 'src/ui/onboarding.ts',
};

for (const t of targets) {
  const out = `dist/${t}${READONLY ? '-validate' : TEST ? '-test' : ''}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: entries, outdir: out, bundle: true, format: 'iife', target: ['chrome111', 'firefox128'],
    minify: false, minifySyntax: true, sourcemap: false, legalComments: 'inline', logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"', __TEST__: TEST ? 'true' : 'false', __BRIDGE_READONLY__: READONLY ? 'true' : 'false' },
  });
  cpSync('src/icons', `${out}/icons`, { recursive: true });
  for (const f of ['popup.html', 'dashboard.html', 'onboarding.html', 'style.css']) cpSync(`src/ui/${f}`, `${out}/${f}`);
  cpSync('LICENSE', `${out}/LICENSE`);
  cpSync('data/LICENSE', `${out}/DATA-LICENSE.txt`);
  const man = manifestFor(t);
  if (READONLY) { man.name = 'See My Trackers (validation build)'; }
  writeFileSync(`${out}/manifest.json`, JSON.stringify(man, null, 2));
  console.log(`built ${out}`);
}

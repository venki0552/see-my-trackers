// Packages store-ready zips + a source zip (required for AMO review of bundled code).
// Uses execFileSync with argument arrays (no shell), so nothing from package.json is ever
// interpreted by a shell.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) throw new Error(`Refusing odd version string: ${v}`);
const out = resolve('release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
for (const t of ['chrome', 'edge', 'firefox']) {
  execFileSync('zip', ['-qr', '-X', `${out}/see-my-trackers-${v}-${t}.zip`, '.'], { cwd: resolve('dist', t) });
}
const src = `${out}/see-my-trackers-${v}-source.zip`;
let inGit = false;
try { inGit = execFileSync('git', ['ls-files'], { stdio: ['ignore', 'pipe', 'ignore'] }).length > 0; } catch {}
if (inGit) execFileSync('git', ['archive', '-o', src, 'HEAD']);
else execFileSync('zip', ['-qr', src, '.', '-x', 'node_modules/*', 'dist/*', 'release/*', 'tests/e2e/out/*', 'tests/scratch/*', '.git/*']);
for (const f of readdirSync(out)) console.log(`${String(statSync(`${out}/${f}`).size).padStart(9)}  ${f}`);

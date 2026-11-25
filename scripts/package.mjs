// Packages store-ready zips + a source zip (required for AMO review of bundled code).
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';

const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
rmSync('release', { recursive: true, force: true });
mkdirSync('release', { recursive: true });
execSync('node scripts/build.mjs', { stdio: 'inherit' });
for (const t of ['chrome', 'edge', 'firefox']) {
  execSync(`cd dist/${t} && zip -qr -X ../../release/see-my-trackers-${v}-${t}.zip .`);
}
execSync(`git ls-files 2>/dev/null | grep -q . && git archive -o release/see-my-trackers-${v}-source.zip HEAD || zip -qr release/see-my-trackers-${v}-source.zip . -x 'node_modules/*' 'dist/*' 'release/*' 'tests/e2e/out/*' 'tests/scratch/*' '.git/*'`, { shell: '/bin/bash' });
console.log(execSync('ls -la release').toString());

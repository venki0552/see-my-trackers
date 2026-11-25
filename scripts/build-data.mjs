// Builds data/trackers.json from Ghostery TrackerDB (CC BY-NC-SA 4.0).
// Compact form: { v, domains: {domain: pid}, patterns: {pid: [name, category, orgId]}, orgs: {orgId: [name, country, contact, policyUrl]} }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = join(process.cwd(), 'node_modules/@ghostery/trackerdb');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const db = JSON.parse(readFileSync(join(pkgDir, 'dist/trackerdb.json'), 'utf8'));

const usedOrgs = new Set();
const patterns = {};
for (const [pid, p] of Object.entries(db.patterns)) {
  patterns[pid] = [p.name, p.category, p.organization ?? null];
  if (p.organization) usedOrgs.add(p.organization);
}
const orgs = {};
for (const id of usedOrgs) {
  const o = db.organizations[id];
  if (!o) continue;
  orgs[id] = [o.name, o.country ?? null, o.privacy_contact ?? null, o.privacy_policy_url ?? null];
}
const domains = {};
for (const [d, pid] of Object.entries(db.domains)) if (patterns[pid]) domains[d.toLowerCase()] = pid;

const out = { v: pkg.version, source: 'Ghostery TrackerDB', license: 'CC-BY-NC-SA-4.0', domains, patterns, orgs };
mkdirSync('data', { recursive: true });
writeFileSync('data/trackers.json', JSON.stringify(out));
console.log(`trackers.json: ${Object.keys(domains).length} domains, ${Object.keys(patterns).length} patterns, ${Object.keys(orgs).length} orgs (TrackerDB ${pkg.version})`);

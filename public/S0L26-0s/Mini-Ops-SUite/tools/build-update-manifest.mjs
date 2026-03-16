import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function sha256B64(buf){
  return createHash('sha256').update(buf).digest('base64');
}

const buildPath = path.resolve('public/assets/build.json');
const build = JSON.parse(fs.readFileSync(buildPath, 'utf8'));

// Keep this list explicit and short: these are the critical assets whose integrity
// the client verifies when update verification is enabled.
const files = [
  '/assets/shell.js',
  '/assets/suite.js',
  '/assets/app.css',
  '/index.html',
  '/sw.js',
  '/sync/app.js',
  '/sync/index.html',
  '/sso/oidc-callback.html',
  '/sso/oidc-callback.js',
  '/sso/saml-acs.js'
];

const assets = files.map((p)=>{
  const abs = path.resolve('public' + p);
  const buf = fs.readFileSync(abs);
  return { path: p, sha256: sha256B64(buf) };
});

const manifest = {
  format: 'skye-update-manifest/v1',
  product: 'skye-mini-ops-suite',
  channel: 'stable',
  version: String(build.schemaVersion || 0),
  buildId: build.buildId,
  schemaVersion: build.schemaVersion,
  publishedAt: build.createdAt || new Date().toISOString(),
  notes: build.notes || '',
  assets
};

const out = path.resolve('public/updates/latest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('✅ Wrote', out);

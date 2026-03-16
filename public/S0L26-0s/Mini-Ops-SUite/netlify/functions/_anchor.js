const crypto = require('crypto');

function b64url(buf){
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function sha256(buf){
  return crypto.createHash('sha256').update(buf).digest();
}

function dayBoundsUTC(dayStr){
  // dayStr = YYYY-MM-DD (UTC)
  const d = new Date(dayStr + 'T00:00:00.000Z');
  if(isNaN(d.getTime())) throw new Error('bad-day');
  const start = d;
  const end = new Date(d.getTime() + 24*3600*1000);
  return { start, end };
}

function canonicalRootInput(hashes){
  // Deterministic and easy to audit.
  return 'audit-anchor-v1\n' + (hashes || []).join('\n') + '\n';
}

function computeDailyRoot(hashes){
  const input = Buffer.from(canonicalRootInput(hashes), 'utf8');
  const digest = sha256(input);
  return { rootHash: b64url(digest), digestBytes: digest };
}

module.exports = { b64url, dayBoundsUTC, canonicalRootInput, computeDailyRoot };

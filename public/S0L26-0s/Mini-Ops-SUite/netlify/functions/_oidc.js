const { jwtVerify, createRemoteJWKSet } = require('jose');

const DISCOVERY_CACHE = new Map(); // issuer -> { cfg, fetchedAt }
const JWKS_CACHE = new Map();      // jwksUri -> RemoteJWKSet

async function discover(issuer){
  issuer = String(issuer||'').trim().replace(/\/$/,'');
  if(!issuer) throw new Error('issuer-required');
  const cached = DISCOVERY_CACHE.get(issuer);
  const now = Date.now();
  if(cached && (now - cached.fetchedAt) < 6*60*60*1000) return cached.cfg; // 6h
  const url = issuer + '/.well-known/openid-configuration';
  const res = await fetch(url, { headers:{'Accept':'application/json'}, cache:'no-store' });
  if(!res.ok) throw new Error('oidc-discovery-failed');
  const cfg = await res.json();
  if(!cfg.authorization_endpoint || !cfg.token_endpoint || !cfg.jwks_uri) throw new Error('oidc-discovery-incomplete');
  DISCOVERY_CACHE.set(issuer, { cfg, fetchedAt: now });
  return cfg;
}

function remoteJwks(jwksUri){
  const key = String(jwksUri||'');
  if(JWKS_CACHE.has(key)) return JWKS_CACHE.get(key);
  const r = createRemoteJWKSet(new URL(key));
  JWKS_CACHE.set(key, r);
  return r;
}

async function verifyIdToken(idToken, { issuer, audience, nonce }){
  const cfg = await discover(issuer);
  const jwks = remoteJwks(cfg.jwks_uri);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: String(issuer||'').replace(/\/$/,''),
    audience
  });
  if(nonce && payload.nonce && String(payload.nonce) !== String(nonce)) throw new Error('oidc-nonce-mismatch');
  return { payload, discovery: cfg };
}

module.exports = { discover, verifyIdToken };

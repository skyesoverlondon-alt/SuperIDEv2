const { query } = require('./_db');

function getClientIp(event){
  const h = event.headers || {};
  const direct = h['x-nf-client-connection-ip'] || h['X-Nf-Client-Connection-Ip'] || h['x-real-ip'] || h['X-Real-Ip'];
  if(direct) return String(direct).trim();
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if(xff) return String(xff).split(',')[0].trim();
  return '0.0.0.0';
}

function windowStartIso(windowSec){
  const ms = windowSec * 1000;
  const now = Date.now();
  const start = Math.floor(now / ms) * ms;
  return new Date(start).toISOString();
}

async function rateLimit({ bucket, limit, windowSec }){
  if(!bucket) return { ok:true };
  const ws = windowStartIso(windowSec || 60);
  const lim = Number(limit || 60);

  // Windowed counter. This is intentionally simple and dependency-free.
  // NOTE: On very large scale, you'd move this to a dedicated rate limiter;
  // for this product tier, DB-backed is acceptable and deterministic.
  const r = await query(
    `INSERT INTO sync_rate_limits(bucket, window_start, count)
     VALUES($1, $2, 1)
     ON CONFLICT (bucket, window_start)
     DO UPDATE SET count = sync_rate_limits.count + 1
     RETURNING count`,
    [bucket, ws]
  );

  const c = Number(r.rows && r.rows[0] && r.rows[0].count || 0);
  if(c > lim) return { ok:false, retryAfterSec: (windowSec || 60) };
  return { ok:true, count: c };
}

async function rateLimitIp(event, route, limit=30, windowSec=60){
  const ip = getClientIp(event);
  const bucket = `${route}:${ip}`;
  return rateLimit({ bucket, limit, windowSec });
}

async function rateLimitUser(event, route, orgId, userId, limit=30, windowSec=60){
  const bucket = `${route}:${orgId||'org'}:${userId||'user'}`;
  return rateLimit({ bucket, limit, windowSec });
}

module.exports = { getClientIp, rateLimit, rateLimitIp, rateLimitUser };

const { Pool } = require('pg');

let _pool = null;

function needsSSL(url){
  const u = String(url||'');
  return /sslmode=require/i.test(u) || /neon\.tech/i.test(u) || /aws\.neon\.tech/i.test(u);
}

function getPool(){
  if(_pool) return _pool;
  const cs = process.env.DATABASE_URL;
  if(!cs) throw new Error('missing DATABASE_URL');
  const cfg = { connectionString: cs };
  if(needsSSL(cs)) cfg.ssl = { rejectUnauthorized: false };
  _pool = new Pool(cfg);
  return _pool;
}

async function query(text, params){
  const pool = getPool();
  return pool.query(text, params);
}

async function tx(fn){
  const pool = getPool();
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  }catch(e){
    try{ await client.query('ROLLBACK'); }catch(_){ /* ignore */ }
    throw e;
  }finally{
    client.release();
  }
}

module.exports = { query, tx };

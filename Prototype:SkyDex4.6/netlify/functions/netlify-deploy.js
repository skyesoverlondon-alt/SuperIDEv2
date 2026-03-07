const { ok, fail, readJson, requireEnv } = require('./_utils');

function makeZip(files) {
  const entries = Object.entries(files || {});
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;

  function crc32(buf) {
    let c = ~0;
    const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
      let v = n;
      for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      return v >>> 0;
    }));
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (~c) >>> 0;
  }

  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(String(content));
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    local.push(Buffer.from(lh), Buffer.from(data));

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(Buffer.from(ch));

    offset += lh.length + data.length;
  }

  const csize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, csize, true);
  ev.setUint32(16, offset, true);

  return Buffer.concat([...local, ...central, Buffer.from(end)]);
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed.');
  try {
    const body = await readJson(event);
    const token = requireEnv('NETLIFY_TOKEN');
    const siteId = body.siteId || process.env.DEFAULT_NETLIFY_SITE_ID;
    const files = body.files || {};
    if (!siteId) return fail(400, 'Netlify site id is required.');
    if (!Object.keys(files).length) return fail(400, 'No files provided.');

    const zipBuffer = makeZip(files);
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/zip'
      },
      body: zipBuffer
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return fail(res.status, data?.message || 'Netlify deploy failed.', { detail: data });

    return ok({
      deploy_id: data.id,
      deploy_url: data.deploy_url,
      ssl_url: data.ssl_url,
      url: data.url
    });
  } catch (err) {
    return fail(500, err.message || 'Netlify deploy failed.');
  }
};

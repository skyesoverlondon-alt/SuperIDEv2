
const DB_NAME = 'skyecloud-suite';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const ASSET_STORE = 'assets';

function openDatabase(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key, fallback){
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const req = tx.objectStore(KV_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet(key, value){
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    tx.objectStore(KV_STORE).put({ key, value, updatedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function assetList(){
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readonly');
    const req = tx.objectStore(ASSET_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0)));
    req.onerror = () => reject(req.error);
  });
}

export async function assetPut(record){
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function assetDelete(id){
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export function uid(prefix='id'){
  return `${prefix}-${Math.random().toString(36).slice(2,9)}-${Date.now().toString(36)}`;
}

export function escapeHTML(value=''){
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

export function downloadFile(name, content, mime='text/plain'){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

export function fmtDate(ts){
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

export function markdownToHTML(md=''){
  let html = escapeHTML(md);
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
  return html.replace(/<p><\/p>/g,'');
}

export function parseCSV(text=''){
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i+1];
    if (c === '"' && inQuotes && next === '"') { value += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { row.push(value); value = ''; continue; }
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && next === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; continue;
    }
    value += c;
  }
  if (value.length || row.length) { row.push(value); rows.push(row); }
  return rows.filter(r => r.some(cell => String(cell).trim().length));
}

export function toCSV(rows=[]){
  return rows.map(row => row.map(cell => {
    const value = String(cell ?? '');
    if (/[",\n]/.test(value)) return `"${value.replaceAll('"','""')}"`;
    return value;
  }).join(',')).join('\n');
}

export async function pingHealth(){
  try {
    const res = await fetch('/.netlify/functions/health');
    if (!res.ok) return { ok:false, configured:false };
    return await res.json();
  } catch {
    return { ok:false, configured:false };
  }
}

export async function aiChat(prompt, system='You are kAIxU, an expert creative engineering assistant for SkyeCloud.'){
  const res = await fetch('/.netlify/functions/ai-chat', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ prompt, system })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'AI request failed.');
  return data;
}

export function setActiveNav(label){
  [...document.querySelectorAll('.navlinks a')].forEach(a => {
    if (a.textContent.trim().toLowerCase() === label.toLowerCase()) {
      a.style.background = 'rgba(124,92,255,.2)';
      a.style.borderColor = 'rgba(124,92,255,.38)';
    }
  });
}

export function bindQuickJump(){
  const links = document.querySelectorAll('[data-jump]');
  links.forEach(link => link.addEventListener('click', (e) => {
    const target = document.querySelector(link.dataset.jump);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  }));
}

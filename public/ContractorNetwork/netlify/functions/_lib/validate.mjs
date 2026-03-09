export function clampString(s, max = 2000) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}
export function clampArray(arr, max = 20, itemMax = 80) {
  const out = [];
  for (const x of (arr || [])) {
    const s = clampString(x, itemMax);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
export function safeUrl(s) {
  const v = clampString(s, 500);
  if (!v) return "";
  try { const u = new URL(v); if (u.protocol !== "http:" && u.protocol !== "https:") return ""; return u.toString(); } catch { return ""; }
}
export function safeEmail(s) {
  const v = clampString(s, 254).toLowerCase();
  if (!v) return "";
  if (!v.includes("@") || v.includes(" ")) return "";
  return v;
}
export function safePhone(s) {
  const v = clampString(s, 40);
  return v.replace(/[^\d+\-() ]/g, "").slice(0, 40);
}
export function parseJSONList(s, max = 6) {
  if (!s) return [];
  try { const arr = JSON.parse(String(s)); if (!Array.isArray(arr)) return []; return arr.slice(0, max).map(x => String(x).trim()).filter(Boolean); } catch { return []; }
}
export function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  const allowed = new Set(["new", "reviewing", "approved", "on_hold", "rejected"]);
  return allowed.has(v) ? v : "reviewing";
}

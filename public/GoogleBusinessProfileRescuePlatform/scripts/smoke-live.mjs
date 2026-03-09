const base = process.env.SMOKE_BASE_URL;
const token = process.env.SMOKE_TOKEN || "";
if (!base) {
  console.error("Set SMOKE_BASE_URL");
  process.exit(1);
}
const headers = token ? { Authorization: `Bearer ${token}` } : {};
const endpoints = ["/v1/health", "/v1/system/release-readiness", "/v1/smoke/run"];
for (const endpoint of endpoints) {
  const res = await fetch(`${base}${endpoint}`, { headers });
  const text = await res.text();
  console.log(`\n${endpoint} -> ${res.status}`);
  console.log(text.slice(0, 800));
}

#!/usr/bin/env node
const siteBase = String(process.env.SITE_BASE_URL || process.env.NEURAL_SITE_BASE_URL || "").replace(/\/$/, "");
const wsId = String(process.env.NEURAL_WS_ID || process.env.WS_ID || "").trim();
const cookieValue = String(process.env.KX_SESSION || process.env.NEURAL_KX_SESSION || "").trim();
const cookieHeader = String(process.env.NEURAL_COOKIE_HEADER || "").trim() || (cookieValue ? `kx_session=${cookieValue}` : "");

if (!siteBase || !wsId || !cookieHeader) {
  console.error("[neural-session-regression] Missing SITE_BASE_URL, NEURAL_WS_ID/WS_ID, or KX_SESSION/NEURAL_COOKIE_HEADER.");
  process.exit(2);
}

async function api(path, options = {}) {
  const response = await fetch(`${siteBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HTTP ${response.status} for ${path}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureMission() {
  const providedMissionId = String(process.env.NEURAL_MISSION_ID || "").trim();
  if (providedMissionId) return { id: providedMissionId, created: false };
  const payload = await api("/api/missions", {
    method: "POST",
    body: JSON.stringify({
      ws_id: wsId,
      title: `Neural Session Regression ${new Date().toISOString()}`,
      priority: "medium",
      goals: ["Validate Neural session mission linkage"],
      linked_apps: ["NeuralSpacePro"],
      note: "Created by neural-session regression.",
    }),
  });
  return { id: String(payload?.id || "").trim(), created: true };
}

async function main() {
  const startedAt = new Date().toISOString();
  const createPayload = await api("/api/neural-session-save", {
    method: "POST",
    body: JSON.stringify({
      ws_id: wsId,
      title: `Neural Regression ${startedAt}`,
      preview: "Initial regression preview",
      pinned: false,
      messages: [
        { role: "user", content: "Regression prompt", timestamp: Date.now(), attachments: [] },
        { role: "model", content: "Regression answer", timestamp: Date.now() + 1, attachments: [] },
      ],
      workspace_summary: {
        revision: "regression",
        total_chars: 128,
        files: [{ path: "src/App.tsx", size: 128 }],
      },
    }),
  });

  const item = createPayload?.item || {};
  const sessionId = String(item.id || "").trim();
  assert(sessionId, "Session create did not return an id.");

  const listByWorkspace = await api(`/api/neural-session-list?ws_id=${encodeURIComponent(wsId)}&limit=20`);
  const summaryItem = Array.isArray(listByWorkspace?.items)
    ? listByWorkspace.items.find((entry) => String(entry.id || "") === sessionId)
    : null;
  assert(summaryItem, "Created session not present in workspace listing.");

  const mission = await ensureMission();
  assert(mission.id, "Mission create did not return an id.");

  await api("/api/neural-session-save", {
    method: "POST",
    body: JSON.stringify({
      id: sessionId,
      ws_id: wsId,
      mission_id: mission.id,
      title: `Neural Regression ${startedAt}`,
      preview: "Mission linked preview",
      pinned: true,
      messages: [
        { role: "user", content: "Regression prompt edited", timestamp: Date.now(), attachments: [] },
        { role: "model", content: "Regression answer edited", timestamp: Date.now() + 1, attachments: [] },
      ],
      workspace_summary: {
        revision: "regression-2",
        total_chars: 256,
        files: [{ path: "src/App.tsx", size: 256 }],
      },
    }),
  });

  const listByMission = await api(`/api/neural-session-list?ws_id=${encodeURIComponent(wsId)}&mission_id=${encodeURIComponent(mission.id)}&limit=20`);
  const missionItem = Array.isArray(listByMission?.items)
    ? listByMission.items.find((entry) => String(entry.id || "") === sessionId)
    : null;
  assert(missionItem, "Mission-linked session not present in mission filtered listing.");
  assert(Boolean(missionItem?.pinned), "Mission-linked session should remain pinned.");

  const detail = await api(`/api/neural-session-list?id=${encodeURIComponent(sessionId)}&detail=full&limit=1`);
  const fullItem = Array.isArray(detail?.items) ? detail.items[0] : null;
  const payload = fullItem?.payload || {};
  assert(String(payload?.mission_id || "") === mission.id, "Full detail payload mission_id mismatch.");
  assert(Array.isArray(payload?.messages) && payload.messages.length === 2, "Full detail payload messages missing.");

  console.log(JSON.stringify({
    ok: true,
    site_base: siteBase,
    ws_id: wsId,
    session_id: sessionId,
    mission_id: mission.id,
    mission_created: mission.created,
    started_at: startedAt,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[neural-session-regression] ${error?.message || error}`);
  process.exit(1);
});
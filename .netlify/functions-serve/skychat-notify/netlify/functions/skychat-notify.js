"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/skychat-notify.ts
var skychat_notify_exports = {};
__export(skychat_notify_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(skychat_notify_exports);

// netlify/functions/_shared/response.ts
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body ?? {})
  };
}

// netlify/functions/_shared/env.ts
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// netlify/functions/_shared/neon.ts
function toHttpSqlEndpoint(url) {
  if (/^https?:\/\//i.test(url)) {
    return {
      endpoint: url,
      headers: { "Content-Type": "application/json" }
    };
  }
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const parsed = new URL(url);
    const endpoint = `https://${parsed.host}/sql`;
    return {
      endpoint,
      headers: {
        "Content-Type": "application/json",
        "Neon-Connection-String": url
      }
    };
  }
  throw new Error("NEON_DATABASE_URL must be an https SQL endpoint or postgres connection string.");
}
async function q(sql, params = []) {
  const url = must("NEON_DATABASE_URL");
  const target = toHttpSqlEndpoint(url);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: target.headers,
    body: JSON.stringify({ query: sql, params })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB error: ${text}`);
  }
  return res.json();
}

// netlify/functions/_shared/auth.ts
var COOKIE = "kx_session";
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((p) => {
    const [k, ...rest] = p.trim().split("=");
    out[k] = rest.join("=") || "";
  });
  return out;
}
async function requireUser(event) {
  const cookies = parseCookies(event.headers?.cookie);
  const token = cookies[COOKIE];
  if (!token) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const sess = await q(
    "select s.token, s.user_id, u.email, u.org_id from sessions s join users u on u.id=s.user_id where s.token=$1 and s.expires_at>$2",
    [token, now]
  );
  if (!sess.rows.length) return null;
  return {
    user_id: sess.rows[0].user_id,
    email: sess.rows[0].email,
    org_id: sess.rows[0].org_id
  };
}
function forbid() {
  return json(401, { error: "Unauthorized" });
}

// netlify/functions/_shared/audit.ts
async function audit(actor, org_id, ws_id, type, meta) {
  try {
    await q(
      "insert into audit_events(actor, org_id, ws_id, type, meta) values($1,$2,$3,$4,$5::jsonb)",
      [actor, org_id, ws_id, type, JSON.stringify(meta ?? {})]
    );
  } catch (_) {
  }
}

// netlify/functions/_shared/idempotency.ts
function readIdempotencyKey(event, body) {
  const fromHeaderRaw = event?.headers?.["x-idempotency-key"] || event?.headers?.["X-Idempotency-Key"] || event?.headers?.["x_idempotency_key"] || "";
  const fromBodyRaw = body?.idempotency_key || "";
  const key = String(fromHeaderRaw || fromBodyRaw || "").trim();
  if (!key) return "";
  const safe = key.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
  return safe;
}

// netlify/functions/_shared/correlation.ts
function readCorrelationId(event) {
  const raw = event?.headers?.["x-correlation-id"] || event?.headers?.["X-Correlation-Id"] || event?.headers?.["x_correlation_id"] || "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9:_\-.]/g, "").slice(0, 128);
}

// netlify/functions/_shared/sovereign-events.ts
var import_crypto = __toESM(require("crypto"), 1);
function inferEventFamily(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  const dot = normalized.indexOf(".");
  return dot === -1 ? normalized : normalized.slice(0, dot);
}
function buildInternalSignature(secret, parts) {
  const hmac = import_crypto.default.createHmac("sha256", secret);
  hmac.update(JSON.stringify(parts));
  return hmac.digest("base64url");
}
async function emitSovereignEvent(input) {
  const eventType = String(input.eventType || "").trim().toLowerCase();
  if (!input.orgId || !eventType || !input.actor) return null;
  try {
    if (input.idempotencyKey) {
      const existing = await q(
        `select id, occurred_at
         from sovereign_events
         where org_id=$1
           and event_type=$2
           and ws_id is not distinct from $3
           and idempotency_key=$4
         order by occurred_at desc
         limit 1`,
        [input.orgId, eventType, input.wsId || null, input.idempotencyKey]
      );
      if (existing.rows.length) {
        return {
          id: existing.rows[0]?.id || null,
          occurred_at: existing.rows[0]?.occurred_at || null,
          duplicate: true
        };
      }
    }
    const payload = input.payload ?? {};
    const summary = String(input.summary || "").trim() || null;
    const occurredAt = (/* @__PURE__ */ new Date()).toISOString();
    const secret = String(process.env.RUNNER_SHARED_SECRET || "").trim();
    const internalSignature = secret ? buildInternalSignature(secret, {
      actor: input.actor,
      org_id: input.orgId,
      ws_id: input.wsId || null,
      event_type: eventType,
      occurred_at: occurredAt,
      payload
    }) : null;
    const inserted = await q(
      `insert into sovereign_events(
         occurred_at, org_id, ws_id, mission_id, event_type, event_family,
         source_app, source_route, actor, actor_user_id, subject_kind, subject_id,
         parent_event_id, severity, correlation_id, idempotency_key, internal_signature,
         summary, payload
       )
       values(
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,
         $18,$19::jsonb
       )
       returning id, occurred_at`,
      [
        occurredAt,
        input.orgId,
        input.wsId || null,
        input.missionId || null,
        eventType,
        inferEventFamily(eventType),
        input.sourceApp || null,
        input.sourceRoute || null,
        input.actor,
        input.actorUserId || null,
        input.subjectKind || null,
        input.subjectId || null,
        input.parentEventId || null,
        input.severity || "info",
        input.correlationId || null,
        input.idempotencyKey || null,
        internalSignature,
        summary,
        JSON.stringify(payload)
      ]
    );
    const eventId = inserted.rows[0]?.id || null;
    if (eventId) {
      try {
        await q(
          `insert into timeline_entries(
             at, org_id, ws_id, mission_id, event_id, entry_type, source_app,
             actor, actor_user_id, subject_kind, subject_id, title, summary, detail
           )
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            occurredAt,
            input.orgId,
            input.wsId || null,
            input.missionId || null,
            eventId,
            eventType,
            input.sourceApp || null,
            input.actor,
            input.actorUserId || null,
            input.subjectKind || null,
            input.subjectId || null,
            summary || eventType,
            summary,
            JSON.stringify(payload)
          ]
        );
      } catch {
      }
    }
    return {
      id: eventId,
      occurred_at: inserted.rows[0]?.occurred_at || occurredAt,
      duplicate: false
    };
  } catch {
    return null;
  }
}

// netlify/functions/_shared/skychat.ts
function normSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function channelSlugFromInput(value) {
  const slug = normSlug(value);
  return slug || "group";
}
async function findChannelBySlug(orgId, slug) {
  const row = await q(
    `select id, payload
     from app_records
     where org_id=$1
       and app='SkyeChatChannel'
       and lower(coalesce(payload->>'slug',''))=$2
     order by created_at asc
     limit 1`,
    [orgId, slug.toLowerCase()]
  );
  if (!row.rows.length) return null;
  const payload = row.rows[0]?.payload && typeof row.rows[0].payload === "object" ? row.rows[0].payload : {};
  return {
    id: row.rows[0].id,
    slug: String(payload.slug || "").toLowerCase(),
    name: String(payload.name || payload.slug || "Channel"),
    description: String(payload.description || ""),
    kind: String(payload.kind || "group").toLowerCase(),
    visibility: String(payload.visibility || "private").toLowerCase(),
    posting_policy: String(payload.posting_policy || "members").toLowerCase(),
    owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null
  };
}
async function ensureCoreSkychatChannels(orgId, actorUserId) {
  const defaults = [
    {
      slug: "community",
      name: "Community Broadcast",
      description: "Global broadcast channel for all users in the organization.",
      kind: "broadcast",
      visibility: "public",
      posting_policy: "all"
    },
    {
      slug: "admin-board",
      name: "Admin Board",
      description: "Admin announcement board; updates fan out to every member notification inbox.",
      kind: "admin",
      visibility: "public",
      posting_policy: "admin"
    }
  ];
  for (const d of defaults) {
    await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       select $1, null, 'SkyeChatChannel', $2, $3::jsonb, $4
       where not exists (
         select 1
         from app_records
         where org_id=$1 and app='SkyeChatChannel' and lower(coalesce(payload->>'slug',''))=$5
       )`,
      [
        orgId,
        `#${d.slug}`,
        JSON.stringify({
          slug: d.slug,
          name: d.name,
          description: d.description,
          kind: d.kind,
          visibility: d.visibility,
          posting_policy: d.posting_policy,
          owner_user_id: null,
          system_default: true
        }),
        actorUserId,
        d.slug
      ]
    );
  }
}
async function getOrgRole(orgId, userId) {
  const roleRow = await q(
    "select role from org_memberships where org_id=$1 and user_id=$2 limit 1",
    [orgId, userId]
  );
  return roleRow.rows[0]?.role || null;
}
function isOrgAdmin(role) {
  return role === "owner" || role === "admin";
}
async function resolveAccessibleChannel(orgId, userId, role, slugRaw) {
  const slug = channelSlugFromInput(slugRaw || "community");
  const ch = await findChannelBySlug(orgId, slug);
  if (!ch) return null;
  const admin = isOrgAdmin(role);
  const isPublic = ch.visibility === "public";
  if (isPublic || admin) return ch;
  const membership = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'channel_id'=$2
       and payload->>'user_id'=$3
       and coalesce(payload->>'status','')='active'
     limit 1`,
    [orgId, ch.id, userId]
  );
  if (!membership.rows.length) return null;
  return ch;
}
async function canPostToChannel(orgId, userId, role, channel) {
  if (channel.posting_policy === "all") return true;
  if (channel.posting_policy === "admin") return isOrgAdmin(role);
  if (isOrgAdmin(role)) return true;
  const membership = await q(
    `select id
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'channel_id'=$2
       and payload->>'user_id'=$3
       and coalesce(payload->>'status','')='active'
     limit 1`,
    [orgId, channel.id, userId]
  );
  return membership.rows.length > 0;
}
async function fanoutAdminAnnouncement(orgId, actorUserId, message, sourceRecordId, priority = "high") {
  const users = await q(
    `select distinct m.user_id
     from org_memberships m
     where m.org_id=$1`,
    [orgId]
  );
  for (const row of users.rows) {
    const targetUserId = String(row.user_id || "");
    if (!targetUserId) continue;
    await q(
      `insert into app_records(org_id, ws_id, app, title, payload, created_by)
       values($1,null,'SkyeNotification',$2,$3::jsonb,$4)`,
      [
        orgId,
        "Admin Announcement",
        JSON.stringify({
          kind: "admin_announcement",
          channel: "admin-board",
          message,
          priority,
          read: false,
          target_user_id: targetUserId,
          source_record_id: sourceRecordId
        }),
        actorUserId
      ]
    );
  }
}

// netlify/functions/skychat-notify.ts
var handler = async (event) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
  }
  const channel = String(body.channel || "community").trim();
  const message = String(body.message || "").trim();
  const source = String(body.source || "manual").trim();
  const wsId = String(body.ws_id || "").trim();
  const parentId = String(body.parent_id || "").trim();
  const rawTopic = String(body.topic || "").trim().toLowerCase();
  const topic = rawTopic.replace(/[^a-z0-9-]/g, "").slice(0, 64);
  const tags = Array.isArray(body.tags) ? body.tags.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 16) : [];
  const priorityRaw = String(body.priority || "").trim().toLowerCase();
  const priority = priorityRaw === "critical" ? "critical" : priorityRaw === "high" ? "high" : "normal";
  const idempotencyKey = readIdempotencyKey(event, body);
  const correlationId = readCorrelationId(event);
  if (!channel || !message) {
    return json(400, { error: "Missing channel or message." });
  }
  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const orgRole = await getOrgRole(u.org_id, u.user_id);
  const channelInfo = await resolveAccessibleChannel(u.org_id, u.user_id, orgRole, channel);
  if (!channelInfo) return json(403, { error: "Channel access denied." });
  const canPost = await canPostToChannel(u.org_id, u.user_id, orgRole, channelInfo);
  if (!canPost) return json(403, { error: "Posting denied for this channel." });
  const effectiveWsId = channelInfo.kind === "group" ? wsId || null : null;
  let resolvedParentId = "";
  let rootId = "";
  let depth = 0;
  if (parentId) {
    const parent = await q(
      `select id, payload
       from app_records
       where id=$1 and org_id=$2 and app='SkyeChat'
       limit 1`,
      [parentId, u.org_id]
    );
    if (!parent.rows.length) return json(404, { error: "Parent message not found." });
    const parentPayload = parent.rows[0]?.payload && typeof parent.rows[0].payload === "object" ? parent.rows[0].payload : {};
    const parentChannel = String(parentPayload.channel_slug || parentPayload.channel || "").toLowerCase();
    if (parentChannel !== channelInfo.slug) {
      return json(400, { error: "Parent must be in the same channel." });
    }
    resolvedParentId = String(parent.rows[0].id);
    rootId = String(parentPayload.root_id || parent.rows[0].id);
    depth = Math.min(8, Math.max(0, Number(parentPayload.depth || 0)) + 1);
  }
  try {
    if (idempotencyKey) {
      const existing = await q(
        `select id, created_at
         from app_records
         where org_id=$1
           and ws_id is not distinct from $2
           and app='SkyeChat'
           and created_by=$3
           and payload->>'idempotency_key'=$4
         order by created_at desc
         limit 1`,
        [u.org_id, effectiveWsId, u.user_id, idempotencyKey]
      );
      if (existing.rows.length) {
        return json(200, {
          ok: true,
          duplicate: true,
          id: existing.rows[0]?.id || null,
          created_at: existing.rows[0]?.created_at || null
        });
      }
    }
    const row = await q(
      "insert into app_records(org_id, ws_id, app, title, payload, created_by) values($1,$2,$3,$4,$5::jsonb,$6) returning id, created_at",
      [
        u.org_id,
        effectiveWsId,
        "SkyeChat",
        `#${channelInfo.slug}`,
        JSON.stringify({
          channel: channelInfo.slug,
          channel_slug: channelInfo.slug,
          channel_id: channelInfo.id,
          channel_kind: channelInfo.kind,
          topic: topic || null,
          tags,
          post_type: resolvedParentId ? "reply" : "post",
          parent_id: resolvedParentId || null,
          root_id: rootId || null,
          depth,
          score: 0,
          message,
          source,
          priority,
          idempotency_key: idempotencyKey || null,
          announcement: channelInfo.kind === "admin"
        }),
        u.user_id
      ]
    );
    if (channelInfo.kind === "admin") {
      await fanoutAdminAnnouncement(u.org_id, u.user_id, message, row.rows[0]?.id || "", priority);
    }
    await audit(u.email, u.org_id, effectiveWsId, "skychat.notify.ok", {
      channel: channelInfo.slug,
      channel_kind: channelInfo.kind,
      source,
      topic: topic || null,
      post_type: resolvedParentId ? "reply" : "post",
      admin_fanout: channelInfo.kind === "admin",
      idempotency_key: idempotencyKey || null,
      correlation_id: correlationId || null,
      record_id: row.rows[0]?.id || null
    });
    if (!resolvedParentId) {
      await emitSovereignEvent({
        actor: u.email,
        actorUserId: u.user_id,
        orgId: u.org_id,
        wsId: effectiveWsId,
        eventType: "chat.thread.created",
        sourceApp: "SkyeChat",
        sourceRoute: "/api/skychat-notify",
        subjectKind: "chat_thread",
        subjectId: String(row.rows[0]?.id || ""),
        severity: priority === "critical" ? "critical" : priority === "high" ? "warning" : "info",
        summary: `SkyeChat thread started in #${channelInfo.slug}`,
        correlationId,
        idempotencyKey,
        payload: {
          channel: channelInfo.slug,
          channel_kind: channelInfo.kind,
          topic: topic || null,
          root_id: row.rows[0]?.id || null,
          priority
        }
      });
    }
    await emitSovereignEvent({
      actor: u.email,
      actorUserId: u.user_id,
      orgId: u.org_id,
      wsId: effectiveWsId,
      eventType: "chat.post.created",
      sourceApp: "SkyeChat",
      sourceRoute: "/api/skychat-notify",
      subjectKind: "chat_post",
      subjectId: String(row.rows[0]?.id || ""),
      severity: priority === "critical" ? "critical" : priority === "high" ? "warning" : "info",
      summary: `SkyeChat post sent to #${channelInfo.slug}`,
      correlationId,
      idempotencyKey,
      payload: {
        channel: channelInfo.slug,
        channel_kind: channelInfo.kind,
        parent_id: resolvedParentId || null,
        root_id: rootId || row.rows[0]?.id || null,
        topic: topic || null,
        priority,
        source
      }
    });
    return json(200, { ok: true, id: row.rows[0]?.id || null, created_at: row.rows[0]?.created_at || null });
  } catch (e) {
    const msg = e?.message || "SkyeChat notify failed.";
    await audit(u.email, u.org_id, wsId || null, "skychat.notify.failed", {
      channel,
      correlation_id: correlationId || null,
      error: msg
    });
    return json(500, { error: msg });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=skychat-notify.js.map

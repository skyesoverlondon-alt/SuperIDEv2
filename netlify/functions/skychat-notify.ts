import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { readIdempotencyKey } from "./_shared/idempotency";
import { readCorrelationId } from "./_shared/correlation";
import { emitSovereignEvent } from "./_shared/sovereign-events";
import {
  canPostToChannel,
  ensureCoreSkychatChannels,
  fanoutAdminAnnouncement,
  getOrgRole,
  resolveAccessibleChannel,
} from "./_shared/skychat";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* ignore */
  }

  const channel = String(body.channel || "community").trim();
  const message = String(body.message || "").trim();
  const source = String(body.source || "manual").trim();
  const wsId = String(body.ws_id || "").trim();
  const parentId = String(body.parent_id || "").trim();
  const rawTopic = String(body.topic || "").trim().toLowerCase();
  const topic = rawTopic.replace(/[^a-z0-9-]/g, "").slice(0, 64);
  const tags = Array.isArray(body.tags) ? body.tags.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 16) : [];
  const priorityRaw = String(body.priority || "").trim().toLowerCase();
  const priority: "normal" | "high" | "critical" = priorityRaw === "critical" ? "critical" : (priorityRaw === "high" ? "high" : "normal");
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

  const effectiveWsId = channelInfo.kind === "group" ? (wsId || null) : null;
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
          created_at: existing.rows[0]?.created_at || null,
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
          announcement: channelInfo.kind === "admin",
        }),
        u.user_id,
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
      record_id: row.rows[0]?.id || null,
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
          priority,
        },
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
        source,
      },
    });

    return json(200, { ok: true, id: row.rows[0]?.id || null, created_at: row.rows[0]?.created_at || null });
  } catch (e: any) {
    const msg = e?.message || "SkyeChat notify failed.";
    await audit(u.email, u.org_id, wsId || null, "skychat.notify.failed", {
      channel,
      correlation_id: correlationId || null,
      error: msg,
    });
    return json(500, { error: msg });
  }
};

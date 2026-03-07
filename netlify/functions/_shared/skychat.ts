import crypto from "crypto";
import { q } from "./neon";

export type SkychatOrgRole = "owner" | "admin" | "member" | "viewer";

export type SkychatChannel = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "broadcast" | "admin" | "group";
  visibility: "public" | "private";
  posting_policy: "all" | "admin" | "members";
  owner_user_id: string | null;
};

function normSlug(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function channelSlugFromInput(value: string): string {
  const slug = normSlug(value);
  return slug || "group";
}

async function findChannelBySlug(orgId: string, slug: string): Promise<SkychatChannel | null> {
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
    kind: (String(payload.kind || "group").toLowerCase() as SkychatChannel["kind"]),
    visibility: (String(payload.visibility || "private").toLowerCase() as SkychatChannel["visibility"]),
    posting_policy: (String(payload.posting_policy || "members").toLowerCase() as SkychatChannel["posting_policy"]),
    owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null,
  };
}

export async function ensureCoreSkychatChannels(orgId: string, actorUserId: string) {
  const defaults: Array<Pick<SkychatChannel, "slug" | "name" | "description" | "kind" | "visibility" | "posting_policy">> = [
    {
      slug: "community",
      name: "Community Broadcast",
      description: "Global broadcast channel for all users in the organization.",
      kind: "broadcast",
      visibility: "public",
      posting_policy: "all",
    },
    {
      slug: "admin-board",
      name: "Admin Board",
      description: "Admin announcement board; updates fan out to every member notification inbox.",
      kind: "admin",
      visibility: "public",
      posting_policy: "admin",
    },
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
          system_default: true,
        }),
        actorUserId,
        d.slug,
      ]
    );
  }
}

export async function getOrgRole(orgId: string, userId: string): Promise<SkychatOrgRole | null> {
  const roleRow = await q(
    "select role from org_memberships where org_id=$1 and user_id=$2 limit 1",
    [orgId, userId]
  );
  return (roleRow.rows[0]?.role as SkychatOrgRole | undefined) || null;
}

export function isOrgAdmin(role: SkychatOrgRole | null): boolean {
  return role === "owner" || role === "admin";
}

export async function listAccessibleChannels(orgId: string, userId: string, role: SkychatOrgRole | null): Promise<SkychatChannel[]> {
  const rows = await q(
    `select id, payload
     from app_records
     where org_id=$1 and app='SkyeChatChannel'
     order by coalesce((payload->>'system_default')::boolean, false) desc, created_at asc`,
    [orgId]
  );

  const memberships = await q(
    `select payload
     from app_records
     where org_id=$1
       and app='SkyeChatMembership'
       and payload->>'user_id'=$2
       and coalesce(payload->>'status','')='active'`,
    [orgId, userId]
  );

  const allowedChannelIds = new Set(
    memberships.rows
      .map((row) => (row?.payload && typeof row.payload === "object" ? String(row.payload.channel_id || "") : ""))
      .filter(Boolean)
  );

  const admin = isOrgAdmin(role);
  const out: SkychatChannel[] = [];
  for (const row of rows.rows) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const ch: SkychatChannel = {
      id: row.id,
      slug: String(payload.slug || "").toLowerCase(),
      name: String(payload.name || payload.slug || "Channel"),
      description: String(payload.description || ""),
      kind: (String(payload.kind || "group").toLowerCase() as SkychatChannel["kind"]),
      visibility: (String(payload.visibility || "private").toLowerCase() as SkychatChannel["visibility"]),
      posting_policy: (String(payload.posting_policy || "members").toLowerCase() as SkychatChannel["posting_policy"]),
      owner_user_id: payload.owner_user_id ? String(payload.owner_user_id) : null,
    };
    if (!ch.slug) continue;
    const isPublic = ch.visibility === "public";
    if (isPublic || admin || allowedChannelIds.has(ch.id)) {
      out.push(ch);
    }
  }

  return out;
}

export async function resolveAccessibleChannel(orgId: string, userId: string, role: SkychatOrgRole | null, slugRaw: string): Promise<SkychatChannel | null> {
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

export async function canPostToChannel(orgId: string, userId: string, role: SkychatOrgRole | null, channel: SkychatChannel): Promise<boolean> {
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

export async function createSkychatGroup(orgId: string, userId: string, name: string, description: string) {
  const baseSlug = channelSlugFromInput(name);
  let slug = baseSlug;
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    const found = await findChannelBySlug(orgId, candidate);
    if (!found) {
      slug = candidate;
      break;
    }
  }

  const ch = await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeChatChannel',$2,$3::jsonb,$4)
     returning id, created_at`,
    [
      orgId,
      `#${slug}`,
      JSON.stringify({
        slug,
        name: String(name || slug).trim() || slug,
        description: String(description || "").trim(),
        kind: "group",
        visibility: "private",
        posting_policy: "members",
        owner_user_id: userId,
      }),
      userId,
    ]
  );

  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     values($1,null,'SkyeChatMembership',$2,$3::jsonb,$4)`,
    [
      orgId,
      `membership:${slug}`,
      JSON.stringify({
        channel_id: ch.rows[0].id,
        channel_slug: slug,
        user_id: userId,
        role: "owner",
        status: "active",
      }),
      userId,
    ]
  );

  return { id: ch.rows[0].id as string, slug, created_at: ch.rows[0].created_at as string };
}

export async function addMemberToChannel(orgId: string, actorUserId: string, channelId: string, channelSlug: string, invitedUserId: string, role: "member" | "moderator" = "member") {
  await q(
    `insert into app_records(org_id, ws_id, app, title, payload, created_by)
     select $1, null, 'SkyeChatMembership', $2, $3::jsonb, $4
     where not exists (
       select 1
       from app_records
       where org_id=$1 and app='SkyeChatMembership'
         and payload->>'channel_id'=$5 and payload->>'user_id'=$6 and coalesce(payload->>'status','')='active'
     )`,
    [
      orgId,
      `membership:${channelSlug}:${invitedUserId}`,
      JSON.stringify({
        channel_id: channelId,
        channel_slug: channelSlug,
        user_id: invitedUserId,
        role,
        status: "active",
        invited_by: actorUserId,
      }),
      actorUserId,
      channelId,
      invitedUserId,
    ]
  );
}

export async function fanoutAdminAnnouncement(
  orgId: string,
  actorUserId: string,
  message: string,
  sourceRecordId: string,
  priority: "normal" | "high" | "critical" = "high"
) {
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
          source_record_id: sourceRecordId,
        }),
        actorUserId,
      ]
    );
  }
}

export function inviteTokenHash(token: string): string {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

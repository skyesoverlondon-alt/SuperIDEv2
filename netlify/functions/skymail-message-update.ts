import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { normalizeLabels } from "./_shared/skymail";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const id = String(body.id || "").trim();
  if (!id) return json(400, { error: "Missing message id." });

  const row = await q(
    `select id, payload
     from app_records
     where id=$1 and org_id=$2 and app in ('SkyeMail', 'SkyeMailInbound')
     limit 1`,
    [id, u.org_id]
  );
  if (!row.rows.length) return json(404, { error: "Message not found." });

  const payload = row.rows[0]?.payload && typeof row.rows[0].payload === "object" ? row.rows[0].payload : {};

  const nextUnread = typeof body.unread === "boolean" ? body.unread : (typeof body.read === "boolean" ? !body.read : undefined);
  const nextStarred = typeof body.starred === "boolean" ? body.starred : undefined;
  const nextArchived = typeof body.archived === "boolean" ? body.archived : undefined;

  let labels = normalizeLabels(payload?.labels, []);
  if (Array.isArray(body.labels)) labels = normalizeLabels(body.labels, labels);
  if (typeof body.add_label === "string") labels = normalizeLabels([...labels, body.add_label], labels);
  if (typeof body.remove_label === "string") labels = labels.filter((x) => x !== String(body.remove_label).trim().toLowerCase());

  const unread = typeof nextUnread === "boolean" ? nextUnread : Boolean(payload?.unread);
  const starred = typeof nextStarred === "boolean" ? nextStarred : Boolean(payload?.starred);
  const archived = typeof nextArchived === "boolean" ? nextArchived : Boolean(payload?.archived);

  const dedup = new Set(labels);
  if (unread) dedup.add("unread");
  else dedup.delete("unread");
  if (starred) dedup.add("starred");
  else dedup.delete("starred");
  if (archived) dedup.add("archive");
  else dedup.delete("archive");
  labels = [...dedup];

  const nextPayload = {
    ...payload,
    labels,
    unread,
    starred,
    archived,
  };

  await q(
    `update app_records
     set payload=$1::jsonb, updated_at=now()
     where id=$2 and org_id=$3`,
    [JSON.stringify(nextPayload), id, u.org_id]
  );

  await audit(u.email, u.org_id, null, "skymail.message.update", {
    message_id: id,
    unread,
    starred,
    archived,
    labels,
  });

  return json(200, { ok: true, id, payload: nextPayload });
};

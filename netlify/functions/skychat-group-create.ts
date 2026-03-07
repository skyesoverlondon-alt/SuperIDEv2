import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";
import { createSkychatGroup, ensureCoreSkychatChannels } from "./_shared/skychat";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  if (!name || name.length < 3) {
    return json(400, { error: "Group name must be at least 3 characters." });
  }

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const created = await createSkychatGroup(u.org_id, u.user_id, name, description);

  await audit(u.email, u.org_id, null, "skychat.group.create", {
    group_id: created.id,
    group_slug: created.slug,
  });

  return json(200, {
    ok: true,
    group: {
      id: created.id,
      slug: created.slug,
      name,
      description,
      created_at: created.created_at,
    },
  });
};

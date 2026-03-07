import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { ensureCoreSkychatChannels, getOrgRole, listAccessibleChannels } from "./_shared/skychat";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });

  await ensureCoreSkychatChannels(u.org_id, u.user_id);
  const role = await getOrgRole(u.org_id, u.user_id);
  const channels = await listAccessibleChannels(u.org_id, u.user_id, role);

  return json(200, {
    ok: true,
    role,
    channels,
    defaults: {
      community: "community",
      admin_board: "admin-board",
    },
  });
};

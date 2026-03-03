import { json } from "./_shared/response";
import { requireUser } from "./_shared/auth";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return json(200, null);
  return json(200, {
    id: u.user_id,
    email: u.email,
    org_id: u.org_id,
  });
};
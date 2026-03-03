import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  const { installation_id, repo, branch } = JSON.parse(event.body || "{}");
  if (!installation_id || !repo) {
    return json(400, { error: "Missing installation_id or repo." });
  }
  const [owner, name] = String(repo).split("/");
  if (!owner || !name) {
    return json(400, { error: "Repo must be OWNER/REPO." });
  }
  const inst = Number(installation_id);
  if (!Number.isFinite(inst) || inst <= 0) {
    return json(400, { error: "Invalid installation_id." });
  }
  await q(
    "insert into integrations(user_id, github_repo, github_owner, github_branch, github_installation_id) values($1,$2,$3,$4,$5) " +
      "on conflict(user_id) do update set github_repo=excluded.github_repo, github_owner=excluded.github_owner, github_branch=excluded.github_branch, github_installation_id=excluded.github_installation_id, updated_at=now()",
    [u.user_id, `${owner}/${name}`, owner, branch || "main", inst]
  );
  await audit(u.email, u.org_id, null, "github.app.connect", {
    repo: `${owner}/${name}`,
    installation_id: inst,
    branch: branch || "main",
  });
  return json(200, { ok: true });
};
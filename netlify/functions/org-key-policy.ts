import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { q } from "./_shared/neon";
import { audit } from "./_shared/audit";
import { getOrgRole } from "./_shared/rbac";
import {
  clearAssignedUserToken,
  clearOrgDefaultToken,
  clearPersonalOverrideToken,
  ensureOrgKeyTables,
  getOrgKeyPolicySummary,
  issueOrgScopedToken,
  setAssignedUserToken,
  setOrgDefaultToken,
  setPersonalOverrideToken,
} from "./_shared/org_keys";

async function getTargetUser(orgId: string, emailOrUserId: string) {
  const normalized = String(emailOrUserId || "").trim().toLowerCase();
  if (!normalized) return null;
  const user = await q(
    `select u.id, u.email
     from org_memberships m
     join users u on u.id=m.user_id
     where m.org_id=$1 and (lower(u.email)=lower($2) or u.id::text=$2)
     limit 1`,
    [orgId, normalized]
  );
  return user.rows[0] || null;
}

export const handler = async (event: any) => {
  const u = await requireUser(event);
  if (!u) return forbid();
  if (!u.org_id) return json(400, { error: "User has no org." });
  await ensureOrgKeyTables();

  const role = await getOrgRole(u.org_id, u.user_id);
  if (!role) return json(403, { error: "Forbidden: org membership required." });

  if ((event.httpMethod || "GET").toUpperCase() === "GET") {
    const policy = await getOrgKeyPolicySummary(u.org_id);
    return json(200, { ok: true, policy, role });
  }

  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const action = String(body.action || "").trim();
  const isAdmin = role === "owner" || role === "admin";

  if (action === "set_personal_override_policy") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const allow = body.allow_personal_key_override === true;
    await q("update orgs set allow_personal_key_override=$1 where id=$2", [allow, u.org_id]);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.policy.update", { allow_personal_key_override: allow });
    return json(200, { ok: true, policy });
  }

  if (action === "issue_org_default_key") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "org-default").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: null,
      scopes: ["generate"],
    });
    await setOrgDefaultToken(u.org_id, issued.summary.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.default.issue", { token_id: issued.summary.id, label: issued.summary.label });
    return json(200, { ok: true, issued: { ...issued.summary, token: issued.token }, policy });
  }

  if (action === "clear_org_default_key") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    await clearOrgDefaultToken(u.org_id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.default.clear", {});
    return json(200, { ok: true, policy });
  }

  if (action === "issue_user_assignment") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const target = await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || ""));
    if (!target) return json(404, { error: "Target user not found in organization." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "member-assigned").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: String(target.email || "").trim().toLowerCase(),
      scopes: ["generate"],
    });
    await setAssignedUserToken(u.org_id, target.id, issued.summary.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.assignment.issue", {
      target_user_id: target.id,
      target_email: target.email,
      token_id: issued.summary.id,
      label: issued.summary.label,
    });
    return json(200, {
      ok: true,
      target: { id: target.id, email: target.email },
      issued: { ...issued.summary, token: issued.token },
      policy,
    });
  }

  if (action === "clear_user_assignment") {
    if (!isAdmin) return json(403, { error: "Forbidden: owner/admin role required." });
    const target = await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || ""));
    if (!target) return json(404, { error: "Target user not found in organization." });
    await clearAssignedUserToken(u.org_id, target.id, u.user_id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.assignment.clear", { target_user_id: target.id, target_email: target.email });
    return json(200, { ok: true, target: { id: target.id, email: target.email }, policy });
  }

  if (action === "issue_personal_override") {
    const org = await q("select allow_personal_key_override from orgs where id=$1 limit 1", [u.org_id]);
    const allow = Boolean(org.rows[0]?.allow_personal_key_override);
    if (!allow) return json(403, { error: "Personal overrides are disabled for this organization." });
    const issued = await issueOrgScopedToken({
      orgId: u.org_id,
      issuedByUserId: u.user_id,
      labelPrefix: String(body.label_prefix || "personal-override").slice(0, 64),
      ttlPreset: String(body.ttl_preset || "quarter"),
      lockedEmail: String(u.email || "").trim().toLowerCase(),
      scopes: ["generate"],
    });
    await setPersonalOverrideToken(u.org_id, u.user_id, issued.summary.id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.personal.issue", { token_id: issued.summary.id, label: issued.summary.label });
    return json(200, { ok: true, issued: { ...issued.summary, token: issued.token }, policy });
  }

  if (action === "clear_personal_override") {
    const target = isAdmin && (body.target || body.email || body.user_id)
      ? await getTargetUser(u.org_id, String(body.target || body.email || body.user_id || ""))
      : { id: u.user_id, email: u.email };
    if (!target) return json(404, { error: "Target user not found in organization." });
    if (!isAdmin && target.id !== u.user_id) return json(403, { error: "Forbidden: cannot clear another user's personal override." });
    await clearPersonalOverrideToken(u.org_id, target.id);
    const policy = await getOrgKeyPolicySummary(u.org_id);
    await audit(u.email, u.org_id, null, "org.key.personal.clear", { target_user_id: target.id, target_email: target.email });
    return json(200, { ok: true, target: { id: target.id, email: target.email }, policy });
  }

  return json(400, { error: "Unsupported action." });
};
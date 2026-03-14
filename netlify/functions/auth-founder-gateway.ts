import { json } from "./_shared/response";
import { q } from "./_shared/neon";
import {
  createSession,
  ensureUserPinColumns,
  ensureUserRecoveryEmailColumn,
  hasValidFounderGatewayKey,
  resolveFounderGatewayUser,
  setSessionCookie,
} from "./_shared/auth";
import { audit } from "./_shared/audit";
import { getOrgRole } from "./_shared/rbac";
import { ensurePrimaryWorkspace, getOrgSeatSummary } from "./_shared/orgs";
import { mintApiToken, tokenHash } from "./_shared/api_tokens";

export const handler = async (event: any) => {
  try {
    await ensureUserRecoveryEmailColumn();
    await ensureUserPinColumns();

    let body: any = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    const providedKey = String(body?.key || "").trim();
    if (!providedKey) {
      return json(400, { error: "Founder gateway key is required." });
    }
    if (!hasValidFounderGatewayKey(providedKey)) {
      return json(401, { error: "Invalid founder gateway key." });
    }

    const founder = await resolveFounderGatewayUser();
    if (!founder) {
      return json(503, { error: "Founder gateway user is not configured in the current runtime." });
    }
    if (!founder.org_id) {
      return json(503, { error: "Founder gateway user is missing an organization binding." });
    }

    await q(
      `insert into skymail_accounts(org_id, user_id, mailbox_email, display_name, provider, outbound_enabled, inbound_enabled, metadata)
       values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict (org_id, user_id) do nothing`,
      [
        founder.org_id,
        founder.user_id,
        founder.email,
        founder.email,
        "gmail_smtp",
        true,
        true,
        JSON.stringify({ source: "auth-founder-gateway" }),
      ]
    );

    await q(
      "update api_tokens set status='revoked', revoked_at=now() where org_id=$1 and issued_by=$2 and status='active' and label like 'founder-gateway%'",
      [founder.org_id, founder.user_id]
    );

    const role = await getOrgRole(founder.org_id, founder.user_id);
    const workspace = await ensurePrimaryWorkspace(founder.org_id, founder.user_id, role || "owner");
    const org = await getOrgSeatSummary(founder.org_id);
    const userRow = await q("select recovery_email, pin_hash from users where id=$1 limit 1", [founder.user_id]);
    const recoveryEmail = String(userRow.rows[0]?.recovery_email || "");
    const hasPin = Boolean(String(userRow.rows[0]?.pin_hash || "").trim());

    const token = mintApiToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const label = `founder-gateway-${new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "")}`;
    await q(
      "insert into api_tokens(org_id, issued_by, label, token_hash, prefix, expires_at, locked_email, scopes_json) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
      [founder.org_id, founder.user_id, label, tokenHash(token), token.slice(0, 14), expiresAt, null, JSON.stringify(["admin"])]
    );

    const session = await createSession(founder.user_id);
    await audit(founder.email, founder.org_id, workspace?.id || null, "auth.founder_gateway", {
      token_label: label,
      workspace_id: workspace?.id || null,
      role: role || "owner",
    });

    return json(
      200,
      {
        ok: true,
        founder_gateway: true,
        kaixu_token: {
          token,
          label,
          locked_email: null,
          scopes: ["admin"],
          expires_at: expiresAt,
        },
        user: {
          email: founder.email,
          recovery_email: recoveryEmail,
          org_id: founder.org_id,
          workspace_id: workspace?.id || null,
          role,
          has_pin: hasPin,
        },
        workspace,
        org,
        onboarding: {
          key_required: false,
          pin_configured: hasPin,
          message: "Founder gateway restored the owner session and issued an unlocked runtime key for this browser origin.",
        },
      },
      { "Set-Cookie": setSessionCookie(session.token, session.expires, event) }
    );
  } catch {
    return json(500, { error: "Founder gateway activation failed." });
  }
};
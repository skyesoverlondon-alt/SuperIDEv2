import { getStore } from "@netlify/blobs";
import { json } from "./_shared/response";
import { requireUser, forbid } from "./_shared/auth";
import { audit } from "./_shared/audit";

export const handler = async (event: any) => {
  const user = await requireUser(event);
  if (!user) return forbid();

  const method = String(event.httpMethod || "GET").toUpperCase();
  const store = getStore("vault-backups");
  const key = `${user.user_id}/vault-snapshot.json`;

  if (method === "GET") {
    const snapshot = await store.get(key, { type: "json" });
    return json(200, { ok: true, snapshot: snapshot || null });
  }

  if (method === "POST") {
    let body: any = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    const snapshot = body?.snapshot;
    if (!snapshot || typeof snapshot !== "object") {
      return json(400, { error: "snapshot payload is required." });
    }

    const savedAt = new Date().toISOString();
    await store.setJSON(key, {
      savedAt,
      siteVersion: "1.2.0",
      snapshot,
    });

    await audit(user.email, user.org_id, null, "vault.backup.saved", {
      key,
      item_count: Array.isArray(snapshot?.items) ? snapshot.items.length : null,
    });

    return json(200, { ok: true, savedAt });
  }

  return json(405, { error: "Method not allowed." });
};
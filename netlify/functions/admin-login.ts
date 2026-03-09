import { contractorErrorResponse, contractorHealthProbe, contractorJson, signContractorAdminJwt } from "./_shared/contractor-admin";

export default async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return contractorJson(405, { error: "Method not allowed." });
    }

    const body = await request.json().catch(() => ({}));
    const password = String((body as any)?.password || "");
    const expected = String(process.env.ADMIN_PASSWORD || "").trim();
    const secret = String(process.env.ADMIN_JWT_SECRET || "").trim();

    if (!expected) throw Object.assign(new Error("ADMIN_PASSWORD not set."), { statusCode: 500 });
    if (!secret) throw Object.assign(new Error("ADMIN_JWT_SECRET not set."), { statusCode: 500 });
    if (!password || password !== expected) {
      throw Object.assign(new Error("Invalid password."), { statusCode: 401 });
    }

    await contractorHealthProbe();
    const token = await signContractorAdminJwt({ role: "admin", sub: "contractor-admin", mode: "password" }, secret);
    return contractorJson(200, { ok: true, token });
  } catch (error) {
    return contractorErrorResponse(error, "Login failed.");
  }
};

export const SKYE_BINARY_MARKER = "SKYESEC1";
export const SKYE_SECURE_FORMAT = "skye-secure-v1";
export const SKYE_SECURE_ALG = "AES-256-GCM";
export const SKYE_SECURE_KDF = "PBKDF2-SHA256";
export const SKYE_DEFAULT_ITERATIONS = 120000;

export type SkyeEncryptedBlock = {
  cipher: string;
  iv: string;
  salt: string;
};

export type SkyeSecureEnvelope = {
  format: typeof SKYE_SECURE_FORMAT;
  encrypted: true;
  alg: typeof SKYE_SECURE_ALG;
  kdf: typeof SKYE_SECURE_KDF;
  iterations: number;
  exportedAt: string;
  hint?: string;
  payload: {
    primary: SkyeEncryptedBlock;
    failsafe?: SkyeEncryptedBlock | null;
  };
};

export type SkyePlainPayload = {
  meta: {
    app_id: string;
    app_version?: string;
    workspace_id?: string;
    document_id?: string;
    title?: string;
    owner?: string;
    created_at?: string;
    updated_at?: string;
    tags?: string[];
    schema_version: number;
  };
  state: Record<string, unknown>;
  assets?: Array<{
    id: string;
    name: string;
    mime: string;
    data_base64: string;
  }>;
};

export type SkyeLegacyEnvelope = {
  format: "skye-v2";
  app: string;
  ws_id?: string;
  exported_at?: string;
  encrypted: boolean;
  payload?: string;
  cipher?: string;
  iv?: string;
  salt?: string;
};

export type SkyeLegacyEnvelopeAdapter =
  | {
      kind: "skye-v2-json";
      legacy: SkyeLegacyEnvelope;
    }
  | {
      kind: "text-prefixed-secure-envelope";
      envelope: SkyeSecureEnvelope;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isSkyeEncryptedBlock(value: unknown): value is SkyeEncryptedBlock {
  return Boolean(
    isRecord(value) &&
      typeof value.cipher === "string" &&
      value.cipher.length > 0 &&
      typeof value.iv === "string" &&
      value.iv.length > 0 &&
      typeof value.salt === "string" &&
      value.salt.length > 0
  );
}

export function validateSkyeEnvelope(
  value: unknown,
  options: { expectedIterations?: number } = {}
): value is SkyeSecureEnvelope {
  const expectedIterations = options.expectedIterations ?? SKYE_DEFAULT_ITERATIONS;
  if (!isRecord(value)) return false;
  if (value.format !== SKYE_SECURE_FORMAT) return false;
  if (value.encrypted !== true) return false;
  if (value.alg !== SKYE_SECURE_ALG) return false;
  if (value.kdf !== SKYE_SECURE_KDF) return false;
  if (Number(value.iterations) !== expectedIterations) return false;
  if (typeof value.exportedAt !== "string" || value.exportedAt.length === 0) return false;
  if (!isRecord(value.payload) || !isSkyeEncryptedBlock(value.payload.primary)) return false;
  if (value.payload.failsafe != null && !isSkyeEncryptedBlock(value.payload.failsafe)) return false;
  return true;
}

export function validateSkyePlainPayload(value: unknown): value is SkyePlainPayload {
  if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.state)) return false;
  if (typeof value.meta.app_id !== "string" || value.meta.app_id.length === 0) return false;
  if (!Number.isFinite(Number(value.meta.schema_version))) return false;
  if (value.assets == null) return true;
  if (!Array.isArray(value.assets)) return false;
  return value.assets.every(
    (asset) =>
      isRecord(asset) &&
      typeof asset.id === "string" &&
      typeof asset.name === "string" &&
      typeof asset.mime === "string" &&
      typeof asset.data_base64 === "string"
  );
}

export async function deriveSkyeKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = SKYE_DEFAULT_ITERATIONS
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSkyePayload(
  plainText: string,
  passphrase: string,
  options: { iterations?: number } = {}
): Promise<SkyeEncryptedBlock> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveSkyeKey(passphrase, salt, options.iterations ?? SKYE_DEFAULT_ITERATIONS);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(plainText))
  );
  return {
    cipher: bytesToBase64(new Uint8Array(cipher)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
  };
}

export async function decryptSkyePayload(
  block: SkyeEncryptedBlock,
  passphrase: string,
  options: { iterations?: number } = {}
): Promise<string> {
  const iv = base64ToBytes(block.iv);
  const salt = base64ToBytes(block.salt);
  const key = await deriveSkyeKey(passphrase, salt, options.iterations ?? SKYE_DEFAULT_ITERATIONS);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(base64ToBytes(block.cipher))
  );
  return new TextDecoder().decode(plain);
}

export function buildSkyeSecureEnvelope(input: {
  primary: SkyeEncryptedBlock;
  failsafe?: SkyeEncryptedBlock | null;
  exportedAt?: string;
  hint?: string;
  iterations?: number;
}): SkyeSecureEnvelope {
  return {
    format: SKYE_SECURE_FORMAT,
    encrypted: true,
    alg: SKYE_SECURE_ALG,
    kdf: SKYE_SECURE_KDF,
    iterations: input.iterations ?? SKYE_DEFAULT_ITERATIONS,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    hint: input.hint?.trim() || undefined,
    payload: {
      primary: input.primary,
      ...(input.failsafe ? { failsafe: input.failsafe } : {}),
    },
  };
}

export function serializeSkyeEnvelope(envelope: SkyeSecureEnvelope): Blob {
  const marker = new TextEncoder().encode(SKYE_BINARY_MARKER);
  const payload = new TextEncoder().encode(JSON.stringify(envelope));
  return new Blob([marker, new Uint8Array([0]), payload], { type: "application/octet-stream" });
}

export function parseSkyeEnvelope(raw: string, options: { expectedIterations?: number } = {}): SkyeSecureEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  if (!validateSkyeEnvelope(parsed, options)) {
    throw new Error("Invalid .skye secure envelope.");
  }
  return parsed;
}

export async function readSkyeEnvelopeFromBlob(
  blob: Blob,
  options: { expectedIterations?: number } = {}
): Promise<SkyeSecureEnvelope> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const marker = new TextEncoder().encode(SKYE_BINARY_MARKER);
  const hasMarker = bytes.length > marker.length + 1 && marker.every((value, index) => bytes[index] === value) && bytes[marker.length] === 0;
  if (!hasMarker) {
    throw new Error("Invalid .skye file marker.");
  }
  const raw = new TextDecoder().decode(bytes.slice(marker.length + 1));
  return parseSkyeEnvelope(raw, options);
}

export function normalizeLegacySkyeEnvelope(input: unknown): SkyeLegacyEnvelopeAdapter | null {
  if (isRecord(input) && input.format === "skye-v2" && typeof input.app === "string") {
    return {
      kind: "skye-v2-json",
      legacy: input as SkyeLegacyEnvelope,
    };
  }

  if (typeof input === "string") {
    const legacyPrefix = `${SKYE_BINARY_MARKER}\n`;
    if (input.startsWith(legacyPrefix)) {
      const candidate = JSON.parse(input.slice(legacyPrefix.length)) as unknown;
      if (validateSkyeEnvelope(candidate)) {
        return {
          kind: "text-prefixed-secure-envelope",
          envelope: candidate,
        };
      }
    }
  }

  return null;
}

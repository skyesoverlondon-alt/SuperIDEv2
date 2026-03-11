#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  SKYE_BINARY_MARKER,
  SKYE_DEFAULT_ITERATIONS,
  SKYE_SECURE_ALG,
  SKYE_SECURE_FORMAT,
  SKYE_SECURE_KDF,
  buildSkyeSecureEnvelope,
  decryptSkyePayload,
  encryptSkyePayload,
  normalizeLegacySkyeEnvelope,
  parseSkyeEnvelope,
  readSkyeEnvelopeFromBlob,
  serializeSkyeEnvelope,
  validateSkyeEnvelope,
  validateSkyePlainPayload,
} from "../public/_shared/skye/skyeSecure.js";

const root = process.cwd();
const fixturePath = path.join(root, "docs", "export-import-fixtures.json");
const goldenManifestPath = path.join(root, "docs", "skye", "fixtures", "manifest.json");

if (!fs.existsSync(fixturePath)) {
  console.error(`[export-import-schema] Missing fixture ${path.relative(root, fixturePath)}`);
  process.exit(1);
}

if (!fs.existsSync(goldenManifestPath)) {
  console.error(`[export-import-schema] Missing golden manifest ${path.relative(root, goldenManifestPath)}`);
  process.exit(1);
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const goldenManifest = JSON.parse(fs.readFileSync(goldenManifestPath, "utf8"));
const failures = [];

function fail(label, error) {
  failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildBinaryBlob(marker, delimiter, rawJson) {
  return new Blob([
    new TextEncoder().encode(marker),
    new Uint8Array([delimiter]),
    new TextEncoder().encode(rawJson),
  ], { type: "application/octet-stream" });
}

function makeAppCompatibilityCheck(expectedApp) {
  return function matchesExpectedApp(payload) {
    return validateSkyePlainPayload(payload) && payload?.meta?.app_id === expectedApp;
  };
}

async function expectReject(label, fn, expectedText) {
  try {
    await fn();
    throw new Error("Expected rejection did not occur");
  } catch (error) {
    const message = String(error?.message || error || "");
    if (expectedText && !message.includes(expectedText)) {
      throw new Error(`Expected error containing \"${expectedText}\" but received \"${message}\"`);
    }
  }
}

async function main() {
  const runtimeFixture = fixtures?.runtimeFixture;
  assert(runtimeFixture && typeof runtimeFixture === "object", "Missing runtimeFixture");
  assert(Array.isArray(fixtures?.vectors), "Missing vectors[]");
  assert(Array.isArray(goldenManifest?.files), "Missing golden manifest files[]");
  assert(validateSkyePlainPayload(runtimeFixture.payload), "runtimeFixture.payload must satisfy canonical plain payload validation");

  const plaintext = JSON.stringify(runtimeFixture.payload);
  const encrypted = await encryptSkyePayload(plaintext, runtimeFixture.passphrase);
  const envelope = buildSkyeSecureEnvelope({
    primary: encrypted,
    hint: runtimeFixture.hint,
    exportedAt: runtimeFixture.exportedAt,
  });

  try {
    assert(validateSkyeEnvelope(envelope), "Canonical secure envelope should validate");
  } catch (error) {
    fail("canonical-secure-envelope", error);
  }

  try {
    const blob = serializeSkyeEnvelope(envelope);
    const parsedEnvelope = await readSkyeEnvelopeFromBlob(blob);
    assert(parsedEnvelope.format === SKYE_SECURE_FORMAT, "Parsed envelope format mismatch");
    const decrypted = await decryptSkyePayload(parsedEnvelope.payload.primary, runtimeFixture.passphrase);
    assert(decrypted === plaintext, "Decrypted payload mismatch");
  } catch (error) {
    fail("decrypt-success", error);
  }

  await (async () => {
    try {
      await expectReject(
        "wrong-marker",
        () => readSkyeEnvelopeFromBlob(buildBinaryBlob("NOPESEC1", 0, JSON.stringify(envelope))),
        "Invalid .skye file marker."
      );
    } catch (error) {
      fail("wrong-marker", error);
    }
  })();

  await (async () => {
    try {
      await expectReject(
        "wrong-delimiter",
        () => readSkyeEnvelopeFromBlob(buildBinaryBlob(SKYE_BINARY_MARKER, 10, JSON.stringify(envelope))),
        "Invalid .skye file marker."
      );
    } catch (error) {
      fail("wrong-delimiter", error);
    }
  })();

  try {
    await expectReject("malformed-json", () => readSkyeEnvelopeFromBlob(buildBinaryBlob(SKYE_BINARY_MARKER, 0, "{")));
  } catch (error) {
    fail("malformed-json", error);
  }

  for (const mutation of [
    { id: "wrong-format", patch: { format: "skye-secure-v9" } },
    { id: "wrong-alg", patch: { alg: "AES-128-GCM" } },
    { id: "wrong-kdf", patch: { kdf: "PBKDF2-SHA1" } },
    { id: "wrong-iterations", patch: { iterations: SKYE_DEFAULT_ITERATIONS + 1 } },
  ]) {
    try {
      const mutated = { ...envelope, ...mutation.patch };
      await expectReject(
        mutation.id,
        () => readSkyeEnvelopeFromBlob(serializeSkyeEnvelope(mutated)),
        "Invalid .skye secure envelope."
      );
    } catch (error) {
      fail(mutation.id, error);
    }
  }

  try {
    await expectReject(
      "wrong-passphrase",
      () => decryptSkyePayload(envelope.payload.primary, runtimeFixture.wrongPassphrase)
    );
  } catch (error) {
    fail("wrong-passphrase", error);
  }

  try {
    const tampered = JSON.parse(JSON.stringify(envelope));
    tampered.payload.primary.cipher = `A${tampered.payload.primary.cipher.slice(1)}`;
    const parsedTampered = await readSkyeEnvelopeFromBlob(serializeSkyeEnvelope(tampered));
    await expectReject("tamper-rejection", () => decryptSkyePayload(parsedTampered.payload.primary, runtimeFixture.passphrase));
  } catch (error) {
    fail("tamper-rejection", error);
  }

  try {
    const wrongAppPayload = fixtures?.wrongAppFixture;
    assert(validateSkyePlainPayload(wrongAppPayload), "wrongAppFixture must remain canonical plain payload");
    const isAcceptedForTarget = makeAppCompatibilityCheck(runtimeFixture.appId)(wrongAppPayload);
    assert(isAcceptedForTarget === false, "Wrong-app payload must be rejected by app compatibility check");
  } catch (error) {
    fail("wrong-app", error);
  }

  try {
    const legacyText = `${SKYE_BINARY_MARKER}\n${JSON.stringify(envelope)}`;
    const normalized = normalizeLegacySkyeEnvelope(legacyText);
    assert(normalized?.kind === "text-prefixed-secure-envelope", "Legacy text-prefixed envelope should normalize");
  } catch (error) {
    fail("legacy-text-prefixed-envelope", error);
  }

  try {
    const legacyV2 = normalizeLegacySkyeEnvelope({ format: "skye-v2", app: runtimeFixture.appId, state: {} });
    assert(legacyV2?.kind === "skye-v2-json", "Legacy skye-v2 object should normalize");
  } catch (error) {
    fail("legacy-skye-v2", error);
  }

  try {
    assert(parseSkyeEnvelope(JSON.stringify(envelope)).alg === SKYE_SECURE_ALG, "parseSkyeEnvelope should preserve alg");
    assert(parseSkyeEnvelope(JSON.stringify(envelope)).kdf === SKYE_SECURE_KDF, "parseSkyeEnvelope should preserve kdf");
  } catch (error) {
    fail("parse-envelope", error);
  }

  try {
    const vectorIds = new Set(fixtures.vectors.map((entry) => entry?.id));
    for (const file of goldenManifest.files) {
      const coverage = Array.isArray(file.coverage) ? file.coverage : [];
      for (const vectorId of coverage) {
        assert(vectorIds.has(vectorId), `Golden file ${file.id} is missing coverage vector ${vectorId}`);
      }
    }
  } catch (error) {
    fail("golden-manifest-alignment", error);
  }

  if (failures.length) {
    for (const message of failures) {
      console.error(`[export-import-schema] ${message}`);
    }
    console.error("[export-import-schema] FAILED");
    process.exit(1);
  }

  console.log(`[export-import-schema] PASS (${fixtures.vectors.length} vectors)`);
}

main().catch((error) => {
  console.error(`[export-import-schema] FAILED: ${error?.message || error}`);
  process.exit(1);
});

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  SKYE_BINARY_MARKER,
  SKYE_DEFAULT_ITERATIONS,
  SKYE_SECURE_ALG,
  SKYE_SECURE_FORMAT,
  SKYE_SECURE_KDF,
  validateSkyePlainPayload,
} from "../public/_shared/skye/skyeSecure.js";

const root = process.cwd();
const fixturePath = path.join(root, "docs", "skye-schema-fixture.json");
const goldenManifestPath = path.join(root, "docs", "skye", "fixtures", "manifest.json");

const REQUIRED_GOLDEN_IDS = new Set([
  "canonical-secure-envelope",
  "tampered-secure-envelope",
  "legacy-text-prefixed-envelope",
  "wrong-app-envelope",
]);

function validateSample(sample) {
  if (!sample || typeof sample !== "object") return "Sample is not an object";
  if (!sample.id || typeof sample.id !== "string") return "Missing sample id";
  if (!validateSkyePlainPayload(sample)) return "Sample does not satisfy canonical plain payload contract";
  if (!Array.isArray(sample.assets)) return "Sample assets must be an array";
  return "";
}

function validateContract(contract) {
  if (!contract || typeof contract !== "object") return "Missing contract object";
  if (contract.marker !== SKYE_BINARY_MARKER) return `Contract marker must equal ${SKYE_BINARY_MARKER}`;
  if (contract.delimiterHex !== "00") return "Contract delimiterHex must equal 00";
  if (contract.format !== SKYE_SECURE_FORMAT) return `Contract format must equal ${SKYE_SECURE_FORMAT}`;
  if (contract.alg !== SKYE_SECURE_ALG) return `Contract alg must equal ${SKYE_SECURE_ALG}`;
  if (contract.kdf !== SKYE_SECURE_KDF) return `Contract kdf must equal ${SKYE_SECURE_KDF}`;
  if (Number(contract.iterations) !== SKYE_DEFAULT_ITERATIONS) {
    return `Contract iterations must equal ${SKYE_DEFAULT_ITERATIONS}`;
  }
  return "";
}

function validateGoldenManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return "Golden manifest is not an object";
  if (!Array.isArray(manifest.files)) return "Golden manifest must expose files[]";
  const ids = new Set(manifest.files.map((entry) => entry?.id).filter(Boolean));
  for (const requiredId of REQUIRED_GOLDEN_IDS) {
    if (!ids.has(requiredId)) return `Golden manifest missing ${requiredId}`;
  }
  return "";
}

if (!fs.existsSync(fixturePath)) {
  console.error(`[skye-schema] Missing fixture: ${fixturePath}`);
  process.exit(1);
}

if (!fs.existsSync(goldenManifestPath)) {
  console.error(`[skye-schema] Missing golden manifest: ${path.relative(root, goldenManifestPath)}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  console.error(`[skye-schema] Invalid JSON fixture: ${error.message}`);
  process.exit(1);
}

let goldenManifest;
try {
  goldenManifest = JSON.parse(fs.readFileSync(goldenManifestPath, "utf8"));
} catch (error) {
  console.error(`[skye-schema] Invalid golden manifest: ${error.message}`);
  process.exit(1);
}

let failed = false;
const contractError = validateContract(parsed?.contract);
if (contractError) {
  console.error(`[skye-schema] Contract failed: ${contractError}`);
  failed = true;
}

const samples = Array.isArray(parsed?.samples) ? parsed.samples : [];
if (!samples.length) {
  console.error("[skye-schema] No canonical samples defined");
  failed = true;
}

for (let i = 0; i < samples.length; i += 1) {
  const err = validateSample(samples[i]);
  if (err) {
    console.error(`[skye-schema] Sample #${i + 1} failed: ${err}`);
    failed = true;
  }
}

const goldenError = validateGoldenManifest(goldenManifest);
if (goldenError) {
  console.error(`[skye-schema] Golden manifest failed: ${goldenError}`);
  failed = true;
}

if (failed) {
  console.error("[skye-schema] FAILED");
  process.exit(1);
}

console.log(`[skye-schema] PASS (${samples.length} sample${samples.length === 1 ? "" : "s"})`);

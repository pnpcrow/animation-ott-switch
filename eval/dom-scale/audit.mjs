// Read-only reproducibility audit. No model execution, downloads, or result writes.
// Default: holdout metadata only. --include-holdout hashes opaque bytes; it never
// parses held-out inputs, annotations, labels, observations, or predictions.
// --strict also fails for unavailable/deferred artifacts. --details lists checks.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const options = { strict: false, includeHoldout: false, details: false, plansDir: ".tmp/dom-scale/model/plans", baseDir: ".tmp/dom-adaptation/finetune/koelectra" };
for (const argument of process.argv.slice(2)) {
  if (argument === "--strict") options.strict = true;
  else if (argument === "--include-holdout") options.includeHoldout = true;
  else if (argument === "--details") options.details = true;
  else if (argument.startsWith("--plans-dir=")) options.plansDir = argument.slice(12);
  else if (argument.startsWith("--base-dir=")) options.baseDir = argument.slice(11);
  else throw new Error(`Unknown argument: ${argument}`);
}

const collection = "eval/dom-scale/collection-train";
const model = "eval/dom-scale/model";
const followup = "eval/dom-scale/followup";
const holdout = "eval/dom-scale/holdout";
const runtime = "eval/dom-scale/runtime";
const allowedHoldoutMetadata = new Set(["data-freeze.json", "reserved-work-hashes.json", "evaluation-plan.json"].map(name => `${holdout}/${name}`));
const shaPattern = /^[0-9a-f]{64}$/;
const checks = [], manifests = [], sections = [];
const normalize = value => value.replaceAll("\\", "/");
function localPath(path) {
  if (typeof path !== "string" || !path) throw new Error("Expected a nonempty file path");
  const absolute = resolve(root, path), name = normalize(relative(root, absolute));
  if (!name || name === ".." || name.startsWith("../") || isAbsolute(name)) throw new Error(`Path outside repository: ${path}`);
  return { absolute, name };
}
function withheld(name) {
  return name.startsWith(`${holdout}/`) && !allowedHoldoutMetadata.has(name) && !options.includeHoldout;
}
async function fingerprint(path) {
  const { absolute, name } = localPath(path);
  if (withheld(name)) return { path: name, status: "deferred", reason: "Holdout data excluded; use --include-holdout for byte-only hashing" };
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("Expected a regular file");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(absolute)) hash.update(chunk);
    return { path: name, bytes: info.size, actual: hash.digest("hex") };
  } catch (error) {
    if (error.code === "ENOENT") return { path: name, status: "unavailable", reason: "File absent; integrity could not be verified" };
    throw error;
  }
}
async function check(section, path, expected, expectedBytes) {
  if (!shaPattern.test(expected || "")) throw new Error(`Invalid expected SHA256: ${path}`);
  const row = { section, ...await fingerprint(path), expected };
  if (!row.status) row.status = row.actual === expected && (expectedBytes === undefined || expectedBytes === row.bytes) ? "verified" : "mismatch";
  if (expectedBytes !== undefined) row.expectedBytes = expectedBytes;
  checks.push(row);
  return row;
}
async function metadata(path, { optional = false } = {}) {
  const { absolute, name } = localPath(path);
  // Even opt-in audits parse only these holdout manifests, never held-out data.
  if (name.startsWith(`${holdout}/`) && !allowedHoldoutMetadata.has(name)) throw new Error(`Holdout JSON parsing forbidden: ${name}`);
  try {
    const bytes = await readFile(absolute);
    const value = JSON.parse(bytes.toString("utf8"));
    manifests.push({ path: name, sha256: createHash("sha256").update(bytes).digest("hex") });
    return value;
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!optional) checks.push({ section: "manifest", path: name, status: "unavailable", reason: "Manifest absent; its artifact set could not be verified" });
      return null;
    }
    throw error;
  }
}
async function hashMap(section, entries, directory = "") {
  if (!entries || typeof entries !== "object" || Array.isArray(entries) || !Object.keys(entries).length) throw new Error(`Empty/invalid hash map: ${section}`);
  for (const [path, hash] of Object.entries(entries)) await check(section, directory ? `${directory}/${path}` : path, hash);
}
async function section(name, action) {
  const start = checks.length;
  try { await action(); }
  catch (error) { checks.push({ section: name, status: "error", reason: String(error) }); }
  sections.push({ name, checks: checks.length - start });
}

async function exportedArtifacts(directory, prefix) {
  const exported = await metadata(`${directory}/exports.json`, { optional: true });
  if (!exported) return;
  await check(`${prefix}.export-freeze`, `${directory}/model-freeze.json`, exported.freezeSha256);
  if (!Array.isArray(exported.models) || !exported.models.length) throw new Error("Exports manifest has no models");
  for (const artifact of exported.models) {
    if (!artifact.modelPath?.endsWith("-q8.onnx")) throw new Error(`Cannot derive FP32 export path: ${artifact.modelPath}`);
    if (!Number.isSafeInteger(artifact.q8?.bytes) || artifact.q8.bytes <= 0 || !Number.isSafeInteger(artifact.fp32?.bytes) || artifact.fp32.bytes <= 0) throw new Error("Invalid export artifact byte count");
    await check(`${prefix}.q8-artifact`, artifact.modelPath, artifact.q8.sha256, artifact.q8.bytes);
    await check(`${prefix}.fp32-artifact`, artifact.modelPath.replace(/-q8\.onnx$/, "-fp32.onnx"), artifact.fp32.sha256, artifact.fp32.bytes);
  }
}

async function designArtifacts(design, prefix, plansDirectory) {
  await hashMap(`${prefix}.design-source`, design.sources);
  await hashMap(`${prefix}.design-data`, design.data);
  await hashMap(`${prefix}.design-plan`, Object.fromEntries(Object.entries(design.plans).map(([recipe, hash]) => [`${plansDirectory}/${recipe}.json`, hash])));
  for (const [name, file] of Object.entries(design.files)) await check(`${prefix}.base-artifact`, `${options.baseDir}/${name}`, file.sha256, file.bytes);
  await check(`${prefix}.reserved-work-manifest`, design.reservedWorkManifest.path, design.reservedWorkManifest.sha256);
}

async function frozenModelArtifacts(directory, prefix) {
  const freeze = await metadata(`${directory}/model-freeze.json`);
  if (!freeze) return;
  await check(`${prefix}.freeze-design`, `${directory}/design.json`, freeze.designSha256);
  await check(`${prefix}.freeze-training`, `${directory}/training.json`, freeze.trainingSha256);
  await hashMap(`${prefix}.freeze-source`, freeze.sources);
  if (!freeze.models || !Object.keys(freeze.models).length) throw new Error("Model freeze has no checkpoints");
  for (const file of Object.values(freeze.models)) await check(`${prefix}.checkpoint`, file.path, file.sha256, file.bytes);
}

await section("collection", async () => {
  const merged = await metadata(`${collection}/collection-manifest.json`);
  if (!merged) return;
  if (!Array.isArray(merged.cohorts) || !merged.cohorts.length) throw new Error("Missing collection cohorts");
  for (const cohort of merged.cohorts) {
    const manifestPath = `${collection}/${cohort.manifest}`;
    await check("collection.cohort", manifestPath, cohort.sha256);
    const frozen = await metadata(manifestPath);
    if (!frozen) continue;
    await hashMap("collection.source", frozen.sourceHashes, collection);
    for (const [name, expected] of Object.entries(frozen.authSourceHashes || {})) {
      const path = name === "collector.mjs" ? `${collection}/${cohort.authCollectorSource}` : `eval/dom-scale/auth-training/${name}`;
      await check("collection.auth-source", path, expected);
    }
  }
  const audit = await metadata(`${collection}/${merged.audit}`);
  if (!audit) return;
  if (!Array.isArray(audit.hashChecks) || !audit.hashChecks.length) throw new Error("Missing recorded collection hash checks");
  for (const row of audit.hashChecks) {
    const path = row.file.startsWith("eval/") ? row.file : `${collection}/${row.file}`;
    await check("collection.audit-source", path, row.expected);
    if (!row.match || row.expected !== row.actual) throw new Error(`Recorded collection hash check failed: ${row.file}`);
  }
  if (Object.values(audit.schema || {}).some(value => value !== true)) throw new Error("Recorded collection schema audit contains a failure");
});

await section("model-design", async () => {
  const design = await metadata(`${model}/design.json`);
  if (!design) return;
  await designArtifacts(design, "model", options.plansDir);
  const merged = await metadata(`${model}/data/manifest.json`);
  if (merged) for (const source of merged.sources) await check("model.merged-source", source.path, source.sha256);
  const tokenizer = await metadata(`${model}/tokenizer-manifest.json`);
  if (tokenizer) {
    await check("model.tokenizer-source", `${model}/export-tokenizer.py`, tokenizer.sourceSha256);
    for (const file of Object.values(tokenizer.files)) await check("model.tokenizer-artifact", file.path, file.sha256, file.bytes);
  }
});

await section("model-freeze", async () => {
  await frozenModelArtifacts(model, "model");
});

await section("model-exports", async () => {
  await exportedArtifacts(model, "model");
});

await section("followup", async () => {
  const wrapperPath = `${followup}/source-wrapper-manifest.json`;
  const designPath = `${followup}/design.json`;
  const wrapper = await metadata(wrapperPath, { optional: true });
  const design = await metadata(designPath, { optional: true });
  if (!wrapper && !design) return;
  if (wrapper) {
    await hashMap("followup.wrapper-source", wrapper.hashes);
    await check("followup.original-freeze", `${model}/model-freeze.json`, wrapper.originalModelFreezeSha256);
  } else await metadata(wrapperPath);
  if (design) await designArtifacts(design, "followup", ".tmp/dom-scale/followup/plans");
  else await metadata(designPath);
  await frozenModelArtifacts(followup, "followup");
  await exportedArtifacts(followup, "followup");
});

await section("runtime", async () => {
  const freeze = await metadata(`${runtime}/source-freeze.json`);
  if (freeze) await hashMap("runtime.source", freeze.hashes);
  // The initial freeze is historical evidence, not an assertion that current
  // sources still equal superseded bytes. Its own bytes can be globally pinned.
  await metadata(`${runtime}/initial-source-freeze.json`, { optional: true });
});

await section("holdout-metadata", async () => {
  const frozen = await metadata(`${holdout}/data-freeze.json`);
  const reserved = await metadata(`${holdout}/reserved-work-hashes.json`);
  const evaluation = await metadata(`${holdout}/evaluation-plan.json`);
  if (frozen) await hashMap("holdout.frozen-bytes", frozen.hashes, holdout);
  if (reserved && (reserved.algorithm !== "sha256-utf8-canonical-work-key" || !reserved.workHashes?.length || new Set(reserved.workHashes).size !== reserved.workHashes.length || !reserved.workHashes.every(hash => shaPattern.test(hash)))) throw new Error("Invalid reserved-work hash manifest");
  if (evaluation) {
    await check("holdout.evaluation-data-freeze", `${holdout}/data-freeze.json`, evaluation.dataFreezeSha256);
    await check("holdout.evaluation-scorer", `${holdout}/score.mjs`, evaluation.scorerSha256);
  }
});

await section("global-freeze", async () => {
  const freeze = await metadata("eval/dom-scale/global-freeze.json", { optional: true });
  if (freeze) await hashMap("global.frozen-bytes", freeze.hashes);
  else sections.push({ name: "global-freeze-presence", status: "not-created", note: "Optional until a global freeze exists" });
});

const counts = Object.fromEntries(["verified", "mismatch", "error", "unavailable", "deferred"].map(status => [status, checks.filter(row => row.status === status).length]));
const failed = counts.mismatch > 0 || counts.error > 0;
const complete = !failed && !counts.unavailable && !counts.deferred;
const result = {
  schemaVersion: 1,
  status: failed ? "failed" : complete ? "verified" : "incomplete",
  strict: options.strict,
  scope: options.includeHoldout ? "All referenced artifacts; holdout data hashed as opaque bytes only" : "Holdout metadata only; other holdout artifacts explicitly deferred",
  counts, manifests, sections,
  issues: checks.filter(row => row.status !== "verified"),
  notes: ["Read-only audit; no model inference, artifact download, or result-file writes.", "Hashes establish consistency with local manifests, not independent authenticity or annotation accuracy.", "Git index/HEAD byte preservation is checked separately."]
};
if (options.details) result.checks = checks;
console.log(JSON.stringify(result));
if (failed || (options.strict && !complete)) process.exitCode = 1;

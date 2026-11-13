import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
const root = "eval/dom-scale", read = async path => JSON.parse(await readFile(path, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");
const audit = JSON.parse(execFileSync(process.execPath, [root + "/audit.mjs", "--strict", "--include-holdout"], { encoding: "utf8" }));
if (audit.status !== "verified") throw new Error("Frozen experiment audit failed");
const summary = await read(root + "/runtime/all-summary.json");
if (summary.runs.length !== 12) throw new Error("Expected twelve development benchmark runs");
const sourceHashes = new Map(), checked = [];
for (const row of [...summary.runs, { path: root + "/runtime/holdout-small-natural-full.json" }]) {
  const bytes = await readFile(row.path), report = JSON.parse(bytes), expectedCases = row.path.includes("holdout-small") ? 120 : 57;
  if (row.sha256 && hash(bytes) !== row.sha256) throw new Error("Benchmark summary hash mismatch");
  if (!report.finishedAt || report.error || report.cases.length !== expectedCases || report.cases.some(x => !x.valid) || !report.nativeReference.complete || report.externalRequests.length || report.rows.some(x => x.tokenizerParity !== true)) throw new Error("Incomplete/invalid browser execution: " + row.path);
  for (const [path, expected] of Object.entries(report.sourceSha256)) {
    if (!sourceHashes.has(path)) sourceHashes.set(path, hash(await readFile(path)));
    if (sourceHashes.get(path) !== expected) throw new Error("Browser runtime source mismatch");
  }
  checked.push({ path: row.path, sha256: hash(bytes), cases: report.cases.length, inferredCases: report.processing.count, valid: true, tokenizerParity: true, nativeSameSelections: report.nativeReference.sameSelections, externalRequests: 0 });
}
const archives = await read(root + "/holdout/browser-plan-archives/manifest.json");
if (archives.files.length !== 8) throw new Error("Expected eight archived job plans");
for (const file of archives.files) {
  const compressed = await readFile(file.archive), raw = gunzipSync(compressed);
  if (hash(compressed) !== file.archiveSha256 || hash(raw) !== file.originalSha256 || raw.length !== file.originalBytes || compressed.length !== file.archiveBytes || compressed.subarray(4, 8).some(x => x !== 0)) throw new Error("Archived plan integrity mismatch");
}
const browserScores = await read(root + "/holdout/supplemental/browser-scores.json");
const actual = await read(root + "/runtime/holdout-small-natural-full.json");
if (browserScores.browser.resultSha256 !== hash(await readFile(root + "/runtime/holdout-small-natural-full.json")) || browserScores.browser.metrics.cases !== 120 || browserScores.browser.metrics.executionFailures !== 0) throw new Error("Browser score provenance mismatch");
const selectedPlan = archives.files.find(file => file.original.endsWith("/small-natural-full-browser.json"));
if (actual.jobsSha256 !== selectedPlan.originalSha256) throw new Error("Selected browser archive does not match actual inference");
const result = { schemaVersion: 1, verifiedAt: new Date().toISOString(), status: "passed", auditCounts: audit.counts, frozenGlobalSha256: hash(await readFile(root + "/global-freeze.json")), verifierSha256: hash(await readFile(root + "/verify-results.mjs")), archivedPlans: archives.files.length, browserRuns: checked, scoredActualBrowser: { correct: browserScores.browser.metrics.correct, cases: 120, positiveCorrect: browserScores.browser.metrics.correctPositive, positiveCases: 72 }, notes: ["This verifies artifact integrity and execution contracts, not correctness of human annotations or adequacy of model accuracy.", "Native/browser numeric equality is not required; actual choices are separately scored."] };
await writeFile(root + "/verification.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.status, frozenHashes: audit.counts.verified, browserRuns: checked.length, archivedPlans: archives.files.length, actualBrowserCorrect: browserScores.browser.metrics.correct }));

// Preserve compact public evidence without committing complete page HTML/synopses.
import { readFile, writeFile } from "node:fs/promises";
const files = [
  "cross-check-http",
  "cross-check-extension-baseline",
  "cross-check-extension-fixed",
  "cross-check-tving-final",
  "cross-check-aniplus-ambiguity-final",
  "cross-check-reverse",
];
const runs = [];
for (const name of files) {
  const raw = JSON.parse(await readFile(`artifacts/${name}.json`, "utf8"));
  if (!raw.finishedAt) throw new Error(`Run not complete: ${name}`);
  runs.push({
    name,
    mode: raw.mode,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    commit: raw.commit,
    build: raw.build,
    environment: raw.environment,
    summary: raw.summary,
    cases: raw.cases.map((c) => ({
      id: c.id,
      query: c.query,
      source: c.source && {
        finalUrl: c.source.finalUrl,
        title: c.source.detail?.title,
        aliases: c.source.detail?.aliases,
        year: c.source.detail?.year,
        imagePresent: !!c.source.detail?.imageUrl,
        descriptionPresent: !!c.source.detail?.description,
        error: c.source.error,
      },
    })),
    results: raw.results.map((r) => ({
      caseId: r.caseId,
      target: r.target,
      query: r.query,
      sourceExtracted: r.sourceExtracted,
      directSearchUrl: r.directSearchUrl,
      outcome: r.outcome,
      result: r.result,
      manualChecks: r.manualChecks,
      finalTabs: r.finalTabs,
      elapsedMs: r.elapsedMs,
      error: r.error,
    })),
  });
}
const latest = new Map();
for (const run of runs.filter(
  (r) => r.mode === "extension" && !r.name.includes("reverse"),
))
  for (const result of run.results)
    latest.set(`${result.caseId}:${result.target}`, {
      ...result,
      evidenceRun: run.name,
    });
if (latest.size !== 80) throw new Error("Expected 8 × 10 matrix");
const matrix = [...latest.values()];
const summary = matrix.reduce((a, r) => {
  const status = r.result?.status || r.outcome || "error";
  a[status] = (a[status] || 0) + 1;
  return a;
}, {});
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope:
    "Latest observed outcome per cell. Unchanged providers retain baseline evidence; this is not one final all-provider run. Opened means a verified detail tab, not entitled playback.",
  summary,
  matrix,
  runs,
};
await writeFile(
  "qa/cross-check/runtime-evidence-2026-11-13.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    summary,
    runs: runs.map((r) => ({
      name: r.name,
      count: r.results.length,
      manualChecks: r.results.reduce(
        (n, x) => n + (x.manualChecks?.length || 0),
        0,
      ),
    })),
  }),
);

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = new URL("./data/", import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, directory), "utf8"));
const snapshots = await read("holdout-observations.json"), inputs = await read("holdout-inputs.json"), annotations = await read("holdout-annotations.json");
const labels = inputs.map(row => {
  const page = snapshots.find(s => `${s.id}-${row.field}` === row.id), gold = annotations.pages[page.id];
  const expectedId = gold[row.field], acceptedIds = gold.accepted?.[row.field] || [expectedId];
  return {
    id: row.id, split: "holdout", expectedId, acceptedIds,
    provenance: { kind: "real-public-dom", pageId: page.id, work: page.work, url: page.url, capturedAt: page.capturedAt, htmlSha256: page.htmlSha256 },
    quality: {
      observedCandidates: page.fields[row.field].length,
      presentedCandidates: row.options.length - 1,
      atLeastThreeCandidates: row.options.length >= 4,
      emptyConcretePool: row.options.length === 1,
      expectedOutsidePool: expectedId !== "__none__" && !row.options.some(o => o.id === expectedId),
      allAcceptedOutsidePool: !row.options.some(o => acceptedIds.includes(o.id)),
    },
  };
});
await writeFile(new URL("holdout-labels.json", directory), JSON.stringify(labels, null, 2) + "\n");
const development = await read("development-labels.json"), oldWorks = new Set(development.map(l => l.provenance.work));
const newWorks = [...new Set(snapshots.filter(s => s.pageKind === "detail").map(s => s.work))];
if (newWorks.some(work => oldWorks.has(work))) throw new Error("Held-out target work was already consumed");
const files = ["development-inputs.json", "development-labels.json", "development-observations.json", "holdout-inputs.json", "holdout-labels.json", "holdout-observations.json", "holdout-annotations.json"];
const hashes = {};
for (const file of files) hashes[file] = createHash("sha256").update(await readFile(new URL(file, directory))).digest("hex");
const positive = labels.filter(l => l.expectedId !== "__none__");
const manifest = {
  version: 1,
  frozenAt: new Date().toISOString(),
  development: { cases: development.length, pages: 22, consumedPrevious48Plus18: true, oldCandidatesLabelsOrderPreserved: true },
  holdout: { cases: inputs.length, pages: snapshots.length, newWorks: newWorks.length, detailPages: 4, nonDetailPages: 2, detailProviders: 4, positiveFields: positive.length, negativeFields: labels.length - positive.length, emptyConcretePools: labels.filter(l => l.quality.emptyConcretePool).length },
  collection: {
    browser: "Playwright Chromium; anonymous separate contexts; ko-KR; 1440x1000",
    method: "domcontentloaded then 4.5 seconds; no sign-in or DOM edits; original HTML/screenshots stored only in ignored .tmp/light-dom-holdout",
    candidatePolicy: "Unmodified v1 generic collector plus v2 observation enrichment; first eight exact-value candidate groups; add none; deterministic SHA256 shuffle by case+candidate ID; no label-based insertion or pruning",
    annotationMethod: annotations.annotationMethod,
    task: "Current work title, representative artwork, and series/movie plot synopsis element selection. Not search result matching or navigation success.",
  },
  poolRecall: { positiveGoldFields: positive.length, positiveWithAcceptedChoice: positive.filter(l => !l.quality.allAcceptedOutsidePool).length, allCasesWithAcceptedChoice: labels.filter(l => !l.quality.allAcceptedOutsidePool).length, total: labels.length },
  exclusions: [],
  modelIsolation: "All previously scored 66 cases are development. New candidate inputs, labels and annotations stay unread by model/template authors until all choices are frozen. The dataset annotator sees pages and gold but no evaluated model outputs. Input JSON contains observed evidence only.",
  limitations: "Same four established provider layouts; new works and two new non-detail page types. Six page clusters, not eighteen independent sites. Anonymous access, not authenticated catalogue coverage. One empty concrete image pool is trivial and must be distinguished in results.",
  hashes,
};
await writeFile(new URL("manifest.json", directory), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ development: manifest.development, holdout: manifest.holdout, poolRecall: manifest.poolRecall, hashes }));

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = new URL("./data/", import.meta.url);
const read = async (name) =>
  JSON.parse(await readFile(new URL(name, directory), "utf8"));
const snapshots = await read("holdout-observations.json");
const inputs = await read("holdout-inputs.json");
const annotations = await read("holdout-annotations.json");
const labels = inputs.map((row) => {
  const page = snapshots.find((s) => `${s.id}-${row.field}` === row.id);
  const gold = annotations.pages[page.id];
  const expectedId = gold[row.field];
  const acceptedIds = gold.accepted?.[row.field] || [expectedId];
  return {
    id: row.id,
    split: "holdout",
    expectedId,
    acceptedIds,
    provenance: {
      kind: "real-public-dom",
      pageId: page.id,
      work: page.work,
      url: page.url,
      capturedAt: page.capturedAt,
      htmlSha256: page.htmlSha256,
    },
    quality: {
      observedCandidates: page.fields[row.field].length,
      presentedCandidates: row.options.length - 1,
      atLeastThreeCandidates: row.options.length >= 4,
      expectedOutsidePool:
        expectedId !== "__none__" &&
        !row.options.some((o) => o.id === expectedId),
      allAcceptedOutsidePool: !row.options.some((o) =>
        acceptedIds.includes(o.id),
      ),
    },
  };
});
await writeFile(
  new URL("holdout-labels.json", directory),
  JSON.stringify(labels, null, 2) + "\n",
);
const files = [
  "development-inputs.json",
  "development-labels.json",
  "development-observations.json",
  "holdout-inputs.json",
  "holdout-labels.json",
  "holdout-observations.json",
  "holdout-annotations.json",
];
const hashes = {};
for (const file of files)
  hashes[file] = createHash("sha256")
    .update(await readFile(new URL(file, directory)))
    .digest("hex");
const positive = labels.filter((l) => l.expectedId !== "__none__");
const manifest = {
  version: 2,
  frozenAt: new Date().toISOString(),
  development: { cases: 48, pages: 16, previousAll48NowDevelopment: true },
  holdout: {
    cases: inputs.length,
    pages: snapshots.length,
    newWorks: 4,
    workDetailProviders: 4,
    nonDetailPages: 2,
    positiveFields: positive.length,
    negativeFields: labels.length - positive.length,
  },
  collection: {
    browser: "Playwright Chromium, anonymous new contexts, ko-KR, 1440x1000",
    method:
      "domcontentloaded then 4.5 seconds; live DOM read without page modifications or sign-in",
    candidateCap: 8,
    candidatePolicy:
      "v1 generic extraction: bounded document-order candidates, exact-value dedup; first 8 plus none; SHA256-based deterministic shuffle by case ID; no labels or model output consulted",
    annotationMethod: annotations.annotationMethod,
  },
  poolRecall: {
    positiveGoldFields: positive.length,
    positiveGoldInPresentedPool: positive.filter(
      (l) => !l.quality.allAcceptedOutsidePool,
    ).length,
    allCasesWithAcceptedChoice: labels.filter(
      (l) => !l.quality.allAcceptedOutsidePool,
    ).length,
    denominatorAllCases: labels.length,
  },
  excludedCaptureAttempts: [
    {
      url: "https://laftel.net/item/39431",
      observedDocumentTitle: "회원가입 / 로그인 - 라프텔",
      reason:
        "Initial intended detail redirected to login/age access page. Before model evaluation, replaced by a publicly readable movie in the same new franchise to meet the four-work-detail target.",
      replacementUrl: "https://laftel.net/item/40587",
      rawLocation: ".tmp/tiny-dom-v2-holdout/demon-slayer-laftel-blocked.html",
    },
  ],
  modelIsolation:
    "Model payload builders receive only input rows. Labels, annotation notes, work provenance and canonical title targets are separate and must not enter prompts. Template selection uses only development; new holdout labels remain unread by template author until selection is locked.",
  hashes,
};
await writeFile(
  new URL("manifest.json", directory),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    developmentCases: 48,
    holdoutCases: inputs.length,
    holdoutPages: snapshots.length,
    poolRecall: manifest.poolRecall,
    hashes,
  }),
);

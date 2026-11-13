import test from "node:test";
import assert from "node:assert/strict";
import { loadTitleNormalizer } from "../../../scripts/title-recovery-tiny-decisions.mjs";
import {
  visibleTitleValue,
  measureV2TitleRecovery,
  summarizeV2TitleRecovery,
  analyzeTitleGroups,
} from "../../../scripts/title-recovery-v2.mjs";
const normalizer = await loadTitleNormalizer();
function fixture(title = "Cloud Train") {
  return {
    id: "fictional-title",
    split: "holdout",
    field: "title",
    expectedId: "n1",
    acceptedIds: ["n1"],
    pageEvidence: {
      url: "https://www.crunchyroll.com/series/fictional",
      documentTitle: "Fictional work",
      headings: [],
      visibleDialogCount: 0,
    },
    options: [
      {
        id: "n1",
        text: `value=${JSON.stringify(title)}; main>h1 @text visible`,
        evidence: {
          id: "n1",
          value: title,
          nodes: [{ tag: "h1", attribute: "text", hidden: false }],
        },
      },
      {
        id: "n2",
        text: `value=${JSON.stringify("Watch " + title)}; head>meta @og:title head-metadata`,
        evidence: {
          id: "n2",
          value: "Watch " + title,
          nodes: [{ tag: "meta", attribute: "og:title", hidden: true }],
        },
      },
      { id: "__none__", text: "None", evidence: null },
    ],
  };
}
test("provider cleanup can recover a wrong element without gold references or changing its score", () => {
  const target = fixture(),
    calls = [];
  const wrapped = {
    ...normalizer,
    cleanPageTitle: (...args) => {
      calls.push(args);
      return normalizer.cleanPageTitle(...args);
    },
  };
  const row = measureV2TitleRecovery(
    { chosenId: "n2", valid: true, correct: false, textLimit: 96 },
    target,
    wrapped,
    "v2-feature-pack",
  );
  assert.equal(row.elementCorrect, false);
  assert.equal(row.rawNormalizedCorrect, false);
  assert.equal(row.rawCleanedCorrect, true);
  assert.equal(row.visibleCleanedCorrect, true);
  assert.ok(
    calls.every(
      (args) => args[0] === "Watch Cloud Train" && args[3].length === 0,
    ),
  );
  assert.equal(row.rescuedRawElementMistake, true);
});
test("v2 visible recovery uses recorded feature tier rather than longer v1 option text", () => {
  const title =
    "An Unusually Long Fictional Title Beyond Thirty Two Characters";
  const target = fixture(title),
    prediction = { chosenId: "n1", valid: true, correct: true, textLimit: 32 };
  const v2 = measureV2TitleRecovery(
    prediction,
    target,
    normalizer,
    "v2-feature-pack",
  );
  const v1 = measureV2TitleRecovery(
    prediction,
    target,
    normalizer,
    "v1-option-text",
  );
  assert.equal(v2.visibleValue, title.slice(0, 32));
  assert.equal(v2.rawCleanedCorrect, true);
  assert.equal(v2.visibleCleanedCorrect, false);
  assert.equal(v1.visibleValue, title);
  assert.equal(v1.visibleCleanedCorrect, true);
  assert.throws(
    () =>
      visibleTitleValue(
        target,
        { ...prediction, textLimit: undefined },
        "v2-feature-pack",
      ),
    /actual v2 text tier/,
  );
});
test("errors and abstentions remain failures for positive title recovery", () => {
  const target = fixture();
  const rows = [
    measureV2TitleRecovery(
      { chosenId: "n2", valid: false, error: "budget", textLimit: 96 },
      target,
      normalizer,
      "v2-feature-pack",
    ),
    measureV2TitleRecovery(
      { chosenId: "__none__", valid: true, correct: false, textLimit: 96 },
      target,
      normalizer,
      "v2-feature-pack",
    ),
  ];
  const summary = summarizeV2TitleRecovery(rows);
  assert.equal(summary.positive.n, 2);
  assert.equal(summary.positive.rawCleaned.correct, 0);
  assert.equal(summary.positive.visibleCleaned.correct, 0);
  assert.equal(summary.positive.errorsOrInvalid, 1);
});
test("absent-detail cases receive no recovery credit even when the string looks like a title", () => {
  const target = {
    ...fixture(),
    expectedId: "__none__",
    acceptedIds: ["__none__"],
  };
  const row = measureV2TitleRecovery(
    { chosenId: "n2", valid: true, correct: false, textLimit: 96 },
    target,
    normalizer,
    "v2-feature-pack",
  );
  assert.equal(row.rawCleanedCorrect, null);
  assert.equal(row.visibleCleanedCorrect, null);
  assert.equal(row.rawWorkLikeOutputOnAbsentDetail, true);
  assert.equal(summarizeV2TitleRecovery([row]).positive.n, 0);
  assert.equal(
    summarizeV2TitleRecovery([row]).noOpenWork.incorrectSelections,
    1,
  );
});
test("auxiliary analysis has four fixed groups, preserves element scores and excludes reversals", () => {
  const target = fixture();
  const prediction = {
    id: target.id,
    chosenId: "n2",
    valid: true,
    correct: false,
    textLimit: 96,
  };
  const comparison = {
    groups: Object.fromEntries(
      ["selected", "enriched", "unchanged", "baseline", "reversed"].map(
        (name) => [name, { rows: [prediction] }],
      ),
    ),
  };
  const groups = analyzeTitleGroups(
    [target],
    [{ id: target.id, expectedId: "n1", acceptedIds: ["n1"] }],
    comparison,
    normalizer,
  );
  assert.deepEqual(Object.keys(groups), [
    "selected",
    "enriched",
    "unchanged",
    "baseline",
  ]);
  assert.ok(
    Object.values(groups).every(
      (group) => group.rows[0].elementCorrect === false,
    ),
  );
  assert.ok(
    Object.values(groups).every(
      (group) => group.summary.positive.rawCleaned.correct === 1,
    ),
  );
  assert.equal(comparison.groups.selected.rows[0].correct, false);
});

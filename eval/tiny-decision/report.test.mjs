import test from "node:test";
import assert from "node:assert/strict";
import { aggregateReports } from "../../scripts/report-tiny-decisions.mjs";

const make = (id, expectedId = "n1") => ({
  id,
  split: "holdout",
  field: "title",
  expectedId,
  acceptedIds: [expectedId],
  options: [{ id: "n1" }, { id: "n2" }, { id: "__none__" }],
  quality: { atLeastThreeCandidates: false },
  provenance: { kind: "real-public-dom" },
});
const corpus = [make("positive"), make("negative", "__none__")];
const input = (rows) => [
  {
    path: "model.json",
    report: { model: "model", runtime: "CPU", finishedAt: "2026-01-01", rows },
  },
];
test("failure rows without gold and missing rows remain in corpus-joined denominators", () => {
  const report = aggregateReports(
    input([{ id: "positive", valid: false, error: "Context overflow" }]),
    corpus,
  );
  const group = report.groups[0];
  assert.equal(group.summary.attempted, 2);
  assert.equal(group.summary.errors, 2);
  assert.equal(group.byTarget.positive.attempted, 1);
  assert.equal(group.byTarget.none.attempted, 1);
  assert.deepEqual(group.coverage.missingIds, ["negative"]);
});
test("Needle suppressed raw proposal is diagnostic, never a correct accepted abstention", () => {
  const report = aggregateReports(
    [
      {
        path: "needle.json",
        report: {
          model: "needle",
          engine: "WASM",
          finishedAt: "2026-01-01",
          runs: [
            {
              template: "native",
              split: "holdout",
              rows: [
                {
                  id: "positive",
                  chosenId: null,
                  suppressedId: "n1",
                  valid: false,
                },
                { id: "negative", chosenId: "__none__", valid: true },
              ],
            },
          ],
        },
      },
    ],
    corpus,
  );
  assert.equal(report.groups[0].summary.correct, 1);
  assert.equal(report.groups[0].summary.rawProposal.correct, 2);
});
test("reordering compares semantic IDs and distinguishes stable wrong predictions", () => {
  const variants = corpus.map((r) => ({
    ...r,
    id: r.id + "::permuted",
    provenance: {
      kind: "synthetic-layout-stress",
      transform: "candidate-permutation",
      baseCaseId: r.id,
    },
    options: [...r.options].reverse(),
  }));
  const report = aggregateReports(
    input(
      [...corpus, ...variants].map((r) => ({
        id: r.id,
        template: "locked",
        chosenId: "n2",
        valid: true,
      })),
    ),
    [...corpus, ...variants],
  );
  assert.equal(report.paired[0].sameChoiceAmongBothValid, 2);
  assert.equal(report.paired[0].bothCorrect, 0);
  assert.equal(report.paired[0].bothWrong, 2);
});
test("incomplete runs, option order mismatches and fabricated recorded accuracy are rejected", () => {
  assert.throws(
    () =>
      aggregateReports(
        [{ path: "partial", report: { model: "model", rows: [] } }],
        corpus,
      ),
    /Incomplete/,
  );
  assert.throws(
    () =>
      aggregateReports(
        input([{ id: "positive", optionIds: ["n2", "n1", "__none__"] }]),
        corpus,
      ),
    /Option order/,
  );
  assert.throws(
    () =>
      aggregateReports(
        input([{ id: "positive", chosenId: "n2", correct: true }]),
        corpus,
      ),
    /disagrees/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  binaryPrompt,
  reconstructPointwise,
  choosePointwise,
  selectPointwiseThreshold,
} from "./pointwise.mjs";

test("binary prompt exposes one observed candidate and no gold/private case metadata", () => {
  const row = {
    id: "private_case",
    field: "title",
    expectedId: "gold_secret",
    provenance: "private_provenance",
    pageEvidence: {
      documentTitle: "Moon House",
      url: "https://example.test/work",
      headings: [],
    },
    options: [
      {
        id: "n_a",
        evidence: {
          value: "Moon House",
          nodes: [{ tag: "h1", attribute: "text", parents: [] }],
        },
      },
      {
        id: "n_b",
        evidence: {
          value: "Another hidden option",
          nodes: [{ tag: "h2", attribute: "text", parents: [] }],
        },
      },
      { id: "__none__" },
    ],
  };
  for (const order of [0, 1]) {
    const prompt = binaryPrompt(row, "n_a", order);
    for (const secret of [
      row.id,
      row.expectedId,
      row.provenance,
      "Another hidden option",
    ])
      assert.ok(!prompt.includes(secret));
    assert.ok(prompt.includes("Moon House"));
    assert.ok(prompt.endsWith("Best answer: ["));
  }
});
test("symmetric scoring cancels pure first-label preference and charges both calls", () => {
  const parents = [
    {
      id: "p",
      field: "title",
      split: "development",
      expectedId: "n",
      options: [{ id: "n" }, { id: "__none__" }],
    },
  ];
  const jobs = [
    {
      id: "f",
      parentCaseId: "p",
      candidateId: "n",
      labelOrder: 0,
      options: [{ id: "qualifies" }, { id: "does-not-qualify" }],
    },
    {
      id: "r",
      parentCaseId: "p",
      candidateId: "n",
      labelOrder: 1,
      options: [{ id: "does-not-qualify" }, { id: "qualifies" }],
    },
  ];
  const inference = {
    rows: jobs.map((job) => ({
      id: job.id,
      valid: true,
      optionIds: job.options.map((o) => o.id),
      logScores: [-1, -5],
      elapsedMs: 7,
    })),
  };
  const [result] = reconstructPointwise(parents, jobs, inference);
  assert.equal(result.candidates[0].score, 0);
  assert.equal(result.elapsedMs, 14);
  assert.equal(result.calls, 2);
  assert.equal(choosePointwise(result, 0).chosenId, "__none__");
});
test("ties are invariant to candidate order and missing inference is not correct abstention", () => {
  const row = {
    id: "p",
    valid: true,
    expectedId: "n1",
    acceptedIds: ["n1"],
    candidates: [
      { id: "n1", score: 1 },
      { id: "n2", score: 1 },
    ],
  };
  assert.equal(choosePointwise(row, 0).chosenId, "__none__");
  assert.equal(
    choosePointwise({ ...row, candidates: [...row.candidates].reverse() }, 0)
      .chosenId,
    "__none__",
  );
  const invalid = choosePointwise(
    { ...row, valid: false, expectedId: "__none__", acceptedIds: ["__none__"] },
    0,
  );
  assert.equal(invalid.correct, false);
  assert.ok(invalid.error);
});
test("one global development threshold is fixed then applied without holdout labels", () => {
  const development = [
    {
      id: "a",
      valid: true,
      expectedId: "n",
      acceptedIds: ["n"],
      candidates: [{ id: "n", score: 0.8 }],
    },
    {
      id: "b",
      valid: true,
      expectedId: "__none__",
      acceptedIds: ["__none__"],
      candidates: [{ id: "n", score: 0.2 }],
    },
  ];
  const selected = selectPointwiseThreshold(development);
  assert.equal(selected.trials[0].summary.correct, 2);
  const observed = {
    id: "fresh",
    valid: true,
    expectedId: "__none__",
    acceptedIds: ["__none__"],
    candidates: [{ id: "n", score: 0.7 }],
  };
  assert.equal(choosePointwise(observed, selected.threshold).chosenId, "n");
  assert.equal(
    choosePointwise(
      { ...observed, expectedId: "n", acceptedIds: ["n"] },
      selected.threshold,
    ).chosenId,
    "n",
  );
});

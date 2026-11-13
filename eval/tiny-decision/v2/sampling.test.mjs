import test from "node:test";
import assert from "node:assert/strict";
import { sampleDevelopment } from "./sampling.mjs";

const rows = ["title", "image", "description"].flatMap((field) =>
  [false, true].flatMap((none) => [
    {
      id: `${field}-${none}-a`,
      field,
      expectedId: none ? "__none__" : "a",
      provenance: { url: "https://a.example/x", work: "first" },
    },
    {
      id: `${field}-${none}-b`,
      field,
      expectedId: none ? "__none__" : "a",
      provenance: { url: "https://a.example/y", work: "second" },
    },
    {
      id: `${field}-${none}-c`,
      field,
      expectedId: none ? "__none__" : "a",
      provenance: { url: "https://c.example/y", work: "third" },
    },
  ]),
);
test("development sampling spans fields/classes and prefers independent host/work", () => {
  const result = sampleDevelopment(rows);
  assert.equal(result.selectedIds.length, 12);
  assert.ok(result.selectedIds.every((id) => !id.endsWith("-b")));
  for (const field of ["title", "image", "description"]) {
    assert.equal(
      result.strata.filter((s) => s.field === field && s.targetClass === "none")
        .length,
      2,
    );
    assert.equal(
      result.strata.filter(
        (s) => s.field === field && s.targetClass === "positive",
      ).length,
      2,
    );
  }
});
test("sampling cannot be steered by model predictions or option values", () => {
  const changed = rows.map((row) => ({
    ...row,
    correct: Math.random() > 0.5,
    chosenId: "bad",
    options: [{ id: "bad", text: "preferred gold" }],
  }));
  assert.deepEqual(
    sampleDevelopment(rows).selectedIds,
    sampleDevelopment(changed).selectedIds,
  );
  assert.throws(() => sampleDevelopment(rows.slice(0, 2)), /Need two/);
});

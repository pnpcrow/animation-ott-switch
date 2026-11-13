import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildInputs } from "./collect-inputs.mjs";
const read = async (relative) =>
  JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const [
  oldRows,
  oldObservations,
  development,
  developmentLabels,
  developmentObservations,
  holdout,
  labels,
  snapshots,
  manifest,
] = await Promise.all(
  [
    "../data/dom-selection.json",
    "../data/observations.json",
    "./data/development-inputs.json",
    "./data/development-labels.json",
    "./data/development-observations.json",
    "./data/holdout-inputs.json",
    "./data/holdout-labels.json",
    "./data/holdout-observations.json",
    "./data/manifest.json",
  ].map(read),
);

test("all 48 old rows become development without altering candidates, ordering or labels", () => {
  assert.equal(development.length, 48);
  assert.equal(developmentObservations.length, 16);
  for (const original of oldRows) {
    const row = development.find((r) => r.id === original.id);
    const label = developmentLabels.find((r) => r.id === original.id);
    assert.equal(row.split, "development");
    assert.deepEqual(
      row.options.map(({ id, text }) => ({ id, text })),
      original.options,
    );
    assert.equal(label.expectedId, original.expectedId);
    assert.deepEqual(label.acceptedIds, original.acceptedIds);
  }
  for (const original of oldObservations) {
    const rich = developmentObservations.find((s) => s.id === original.id);
    for (const [field, candidates] of Object.entries(original.fields)) {
      assert.deepEqual(
        rich.fields[field].map((c) => [c.id, c.value]),
        candidates.map((c) => [c.id, c.value]),
      );
      candidates.forEach((c, i) =>
        c.nodes.forEach((node, j) => {
          for (const [key, value] of Object.entries(node))
            assert.deepEqual(rich.fields[field][i].nodes[j][key], value);
        }),
      );
    }
  }
});

test("holdout contains six actual captures, four disjoint work details, and eighteen field tasks", () => {
  assert.equal(holdout.length, 18);
  assert.equal(snapshots.length, 6);
  const works = new Set(oldObservations.map((s) => s.work));
  const newDetails = snapshots.filter((s) => !s.work.startsWith("none-"));
  assert.equal(newDetails.length, 4);
  assert.equal(
    new Set(newDetails.map((s) => new URL(s.pageUrl).hostname)).size,
    4,
  );
  for (const s of snapshots) {
    assert.ok(!works.has(s.work));
    assert.match(s.htmlSha256, /^[a-f0-9]{64}$/);
    assert.ok(!s.error);
    assert.equal(s.enrichment.computedLayout, true);
  }
  assert.equal(labels.length, 18);
  assert.deepEqual(buildInputs(snapshots), holdout);
});

test("model input data excludes labels, annotation/provenance and canonical answers recursively", () => {
  const forbidden = new Set([
    "expectedId",
    "acceptedIds",
    "canonicalTitle",
    "provenance",
    "quality",
    "annotationMethod",
    "note",
    "work",
    "isCorrectScope",
    "isArtwork",
    "isMain",
  ]);
  function check(value) {
    if (Array.isArray(value)) return value.forEach(check);
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!forbidden.has(key), `Unexpected model input key: ${key}`);
        check(child);
      }
  }
  check(development);
  check(holdout);
  for (const row of holdout) {
    assert.ok(row.options.some((o) => o.id === "__none__"));
    assert.ok(row.options.length <= 9);
    assert.equal(
      new Set(row.options.map((o) => o.id)).size,
      row.options.length,
    );
  }
});

test("label attachment reports candidate recall without injecting a missing gold option", () => {
  const positive = labels.filter((l) => l.expectedId !== "__none__");
  const inPool = positive.filter((l) =>
    holdout
      .find((r) => r.id === l.id)
      .options.some((o) => l.acceptedIds.includes(o.id)),
  );
  assert.equal(manifest.poolRecall.positiveGoldFields, positive.length);
  assert.equal(manifest.poolRecall.positiveGoldInPresentedPool, inPool.length);
  assert.ok(positive.every((l) => l.acceptedIds.includes(l.expectedId)));
});

test("frozen input, observation and annotation hashes match the manifest", async () => {
  for (const [filename, expected] of Object.entries(manifest.hashes)) {
    const content = await readFile(
      new URL(`./data/${filename}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expected,
      filename,
    );
  }
});

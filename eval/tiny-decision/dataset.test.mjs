import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { collectDomSnapshot } from "./collect.mjs";
import { buildDataset } from "./dataset.mjs";
import { makeStressVariants } from "./stress.mjs";
import { removeDomContext } from "./ablation.mjs";
import { chooseCompactHeuristic } from "./baseline.mjs";

const snapshots = JSON.parse(
  await readFile(new URL("./data/observations.json", import.meta.url), "utf8"),
);
const annotations = JSON.parse(
  await readFile(new URL("./data/annotations.json", import.meta.url), "utf8"),
);
const rows = buildDataset(snapshots, annotations);
test("dataset preserves real provenance, grouped split and bounded multi-candidate pools", () => {
  assert.equal(rows.length, 48);
  assert.equal(new Set(snapshots.map((p) => p.work)).size, 8);
  assert.equal(new Set(snapshots.map((p) => new URL(p.url).hostname)).size, 10);
  const works = new Map();
  for (const row of rows) {
    assert.match(row.provenance.htmlSha256, /^[a-f0-9]{64}$/);
    if (works.has(row.provenance.work))
      assert.equal(works.get(row.provenance.work), row.split);
    works.set(row.provenance.work, row.split);
    assert.ok(row.options.some((o) => o.id === "__none__"));
    assert.ok(row.options.length <= 9);
    assert.equal(row.quality.expectedOutsidePool, false);
    assert.ok(row.acceptedIds.includes(row.expectedId));
    assert.ok(
      row.acceptedIds.every((id) => row.options.some((o) => o.id === id)),
    );
    assert.ok(
      !/expectedId|acceptedIds|annotationMethod/.test(
        row.document + row.question + JSON.stringify(row.options),
      ),
    );
  }
  assert.equal(rows.filter((r) => r.quality.atLeastThreeCandidates).length, 38);
});
test("generic collection retains hidden distractors, rejects non-HTTPS image and executable text", () => {
  const { document } = parseHTML(
    '<html><head><title>Catalog</title></head><body><nav><h1>Browse</h1></nav><dialog open><h1>Story</h1><p>A sufficiently long plot describes this particular story in detail.</p><img src="https://cdn.example/story.jpg" alt="Story"></dialog><div hidden><h1>Old story</h1></div><img src="javascript:alert(1)" alt="Bad"><script>private_token_should_not_appear()</script></body></html>',
  );
  const snapshot = collectDomSnapshot(document, "https://video.example/work/1");
  assert.ok(
    snapshot.fields.title.some(
      (c) => c.value === "Old story" && c.nodes[0].hidden,
    ),
  );
  assert.ok(
    snapshot.fields.title.some(
      (c) => c.value === "Browse" && c.nodes[0].navigation,
    ),
  );
  assert.equal(snapshot.fields.image.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes("private_token"));
});
test("stress variants preserve labels and candidate membership, remain dependent samples", () => {
  const stress = makeStressVariants(rows, snapshots);
  assert.equal(stress.length, 96);
  for (const variant of stress) {
    const original = rows.find((r) => r.id === variant.provenance.baseCaseId);
    assert.equal(variant.independentSample, false);
    assert.equal(variant.expectedId, original.expectedId);
    assert.deepEqual(
      variant.options.map((o) => o.id).sort(),
      original.options.map((o) => o.id).sort(),
    );
  }
});
test("DOM ablation retains values/options/labels exactly and removes structural evidence", () => {
  const ablations = removeDomContext(rows);
  assert.equal(ablations.length, 18);
  for (const variant of ablations) {
    const original = rows.find((r) => r.id === variant.provenance.baseCaseId);
    assert.equal(variant.document, original.document);
    assert.deepEqual(variant.acceptedIds, original.acceptedIds);
    assert.deepEqual(
      variant.options.map((o) => o.id),
      original.options.map((o) => o.id),
    );
    for (const o of variant.options.filter((o) => o.id !== "__none__")) {
      assert.ok(
        original.options
          .find((x) => x.id === o.id)
          .text.startsWith(o.text + "; "),
      );
      assert.ok(!/ @|; (?:prev|next)=/.test(o.text));
    }
  }
});
test("compact heuristic is a pure function of model-visible inputs", () => {
  for (const row of rows) {
    const pure = {
      document: row.document,
      field: row.field,
      options: row.options,
    };
    assert.equal(chooseCompactHeuristic(pure), chooseCompactHeuristic(row));
  }
});

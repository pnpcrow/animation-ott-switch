import test from "node:test";
import assert from "node:assert/strict";
import { providerFor, corpusRecords, providerHeldoutFolds, assertDisjoint } from "./protocol.mjs";

test("provider families include subdomains but reject lookalike domains", () => {
  assert.equal(providerFor("https://help.netflix.com/a"), "netflix");
  assert.equal(providerFor("https://policy.laftel.net/"), "laftel");
  assert.throws(() => providerFor("https://evilnetflix.com/"), /Unmapped/);
  assert.throws(() => providerFor("https://netflix.com.attacker.test/"), /Unmapped/);
});

const records = [
  { id: "a-title", pageId: "a", provider: "laftel", work: "shared", field: "title", positive: true },
  { id: "a-image", pageId: "a", provider: "laftel", work: "shared", field: "image", positive: true },
  { id: "b-search", pageId: "b", provider: "netflix", work: "shared", field: "title", positive: false },
  { id: "c-title", pageId: "c", provider: "netflix", work: "other", field: "title", positive: true },
  { id: "d-title", pageId: "d", provider: "apple", work: "third", field: "title", positive: true },
];
test("provider exclusion also purges same-work search examples from training", () => {
  const fold = providerHeldoutFolds(records).find(x => x.provider === "laftel");
  assert.deepEqual(fold.testIds, ["a-title", "a-image"]);
  assert.deepEqual(fold.excludedSameWorkIds, ["b-search"]);
  assert.deepEqual(fold.trainIds, ["c-title", "d-title"]);
  assert.deepEqual(fold.missingPositiveFields, ["description"]);
  assert.equal(fold.canMeasureBothPositiveAndAbsent, false);
  assert.equal(fold.executed, false);
});
test("leakage guard rejects provider, page and target identities crossing partitions", () => {
  assert.throws(() => assertDisjoint([records[0]], [records[1]]), /pageId/);
  assert.throws(() => assertDisjoint([records[0]], [records[2]]), /work/);
  assert.throws(() => assertDisjoint([records[2]], [records[3]]), /provider/);
});
const input = { id: "x", field: "title", pageEvidence: { url: "https://laftel.net/search" }, options: [{ id: "t1" }, { id: "__none__" }] };
const label = { id: "x", expectedId: "__none__", provenance: { pageId: "x", work: "none-search", url: "https://laftel.net/search" } };
test("consumed evaluation stays development and no-work groups are not fabricated work identities", () => {
  const [row] = corpusRecords([input], [label]);
  assert.equal(row.work, null);
  assert.equal(row.status, "consumed-development");
  assert.equal(row.positive, false);
  assert.equal(row.concreteCandidates, 1);
});
test("unmatched inputs, duplicate labels and impossible gold targets fail closed", () => {
  assert.throws(() => corpusRecords([input], []), /count/);
  assert.throws(() => corpusRecords([input], [label, label]), /Duplicate/);
  assert.throws(() => corpusRecords([input], [{ ...label, expectedId: "missing" }]), /outside pool/);
  assert.throws(() => corpusRecords([input], [{ ...label, acceptedIds: ["t1", "__none__"] }]), /Ambiguous/);
});
test("reviewed explicit work search identity is purged despite historical none-search grouping", () => {
  const url = "https://laftel.net/search?keyword=스파이%20패밀리";
  const rows = corpusRecords([{ ...input, pageEvidence: { url } }], [{ ...label, provenance: { pageId: "new-search-laftel", work: "none-search", url } }]);
  assert.equal(rows[0].work, "spy-family");
  const fold = providerHeldoutFolds([...rows, { ...records[4], work: "spy-family" }]).find(x => x.provider === "apple");
  assert.deepEqual(fold.excludedSameWorkIds, ["x"]);
  assert.throws(() => corpusRecords([input], [{ ...label, provenance: { pageId: "new-search-laftel", work: "none-search", url } }]), /override evidence/);
});

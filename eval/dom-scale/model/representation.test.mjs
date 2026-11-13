import test from "node:test";
import assert from "node:assert/strict";
import { prepare } from "./representation.mjs";

const row = { id: "identity-secret", field: "title", pageEvidence: { url: "https://laftel.net/item/123", documentTitle: "구름 정원", headings: [{ text: "구름 정원", hidden: false }], visibleDialogCount: 1 }, options: [{ id: "node-secret", evidence: { value: "구름 정원", nodes: [{ tag: "h1", attribute: "text", parents: [{ tag: "main" }] }] } }, { id: "__none__" }] };
test("compact facts preserve unknown visibility instead of fabricating visible", () => {
  const plan = prepare([row], "small-compact");
  assert.match(plan.cases[0].candidates[0].variants[0].passage, /숨김=미확인/);
  assert.match(plan.cases[0].candidates[0].variants[0].passage, /모달=미확인/);
});
test("annotations and opaque evaluation identities cannot become model text", () => {
  const a = prepare([row], "full-compact");
  const b = prepare([{ ...row, expectedId: "gold-secret", acceptedIds: ["gold-secret"], provenance: { work: "work-secret" } }], "full-compact");
  assert.deepEqual(a, b);
  for (const c of a.cases[0].candidates) for (const v of c.variants) assert.doesNotMatch(v.query + v.passage, /identity-secret|node-secret|gold-secret|work-secret|laftel/);
});
test("all recipes preserve candidate pool and pointwise content under permutation", () => {
  for (const recipe of ["full-natural", "full-compact", "small-compact"]) {
    const a = prepare([row], recipe), b = prepare([{ ...row, options: [...row.options].reverse() }], recipe);
    assert.deepEqual(a.cases[0].candidates.map(x=>x.id).sort(), row.options.map(x=>x.id).sort());
    assert.deepEqual(a.cases[0].candidates, [...b.cases[0].candidates].reverse());
  }
});

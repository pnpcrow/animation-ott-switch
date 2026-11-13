import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeBatch } from "./tokenize.mjs";

const tensor = data => ({ type: "int64", dims: [1, 4], data });
const batch = { id: "batch", candidateIds: ["candidate"], inputs: { input_ids: tensor([2, 5, 3, 0]), attention_mask: tensor([1, 1, 1, 0]), token_type_ids: tensor([0, 0, 1, 0]) } };
const specification = { batchId: "batch", paddingLength: 4, pairs: [{ candidateId: "candidate", query: "제목", passage: "관측 사실" }] };
const encoded = { ids: [2, 5, 3], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 1] };

test("browser tokenization adds only right padding and checks every tensor", () => {
  const result = tokenizeBatch({ encode: () => encoded }, batch, specification);
  assert.deepEqual(result.inputs, batch.inputs);
  for (const field of ["ids", "attention_mask", "token_type_ids"]) {
    const changed = structuredClone(encoded); changed[field][1]++;
    assert.throws(() => tokenizeBatch({ encode: () => changed }, batch, specification), /mismatch/);
  }
});
test("tokenizer may neither truncate overflow nor remap candidate identities", () => {
  assert.throws(() => tokenizeBatch({ encode: () => ({ ids: [1, 2, 3, 4, 5] }) }, batch, specification), /exceeds/);
  const changed = structuredClone(specification); changed.pairs[0].candidateId = "wrong";
  assert.throws(() => tokenizeBatch({ encode: () => encoded }, batch, changed), /identity/);
});

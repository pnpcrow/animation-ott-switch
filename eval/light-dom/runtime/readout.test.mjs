import test from "node:test";
import assert from "node:assert/strict";
import { readTensor, reduceOutput, summarizeTimes } from "./readout.mjs";

test("mean pooling excludes padding, normalizes each batch member, and preserves batch ordering", () => {
  const result = reduceOutput({type:"float32",dims:[2,3,2],data:[1,0,1,0,100,100,0,1,0,1,0,1]}, {attention_mask:{data:[1,1,0,1,1,1]}}, "mean");
  assert.deepEqual(result, {dims:[2,2],data:[1,0,0,1]});
});
test("reranker logits remain logits and invalid pooling cannot silently select output", () => {
  assert.deepEqual(reduceOutput({type:"float32",dims:[2,1],data:[-2,4]}, {}, "logits"), {dims:[2,1],data:[-2,4]});
  assert.throws(() => reduceOutput({type:"float32",dims:[1,1],data:[1]}, {}, "mean"), /batch/);
  assert.throws(() => reduceOutput({type:"float32",dims:[1,1,1],data:[1]}, {attention_mask:{data:[0]}}, "mean"), /attended/);
});
test("half output decoding and timing quantiles are explicit", () => {
  assert.deepEqual(readTensor({type:"float16",data:[0x3c00,0xc000,0x0000]}), [1,-2,0]);
  assert.equal(summarizeTimes([5,1,3]).p50Ms,3);
  assert.equal(summarizeTimes([]).p50Ms,null);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDataset,
  requestFor,
  scoreAnswer,
  responseSchema,
  selectCalibration,
} from "./core.mjs";
import { starterDataset } from "./fixtures.mjs";
import { parseHTML } from "linkedom";
import { collectEvidence } from "./collect.mjs";
const dataset = validateDataset(starterDataset);
test("fixtures are bounded and calibration/holdout answers never enter prompts", () => {
  assert.equal(dataset.cases.length, 8);
  for (const item of dataset.cases) {
    const prompt = requestFor(item, "evidence-v2");
    assert.equal(prompt.messages[1].content, JSON.stringify(item.input));
    assert.equal(prompt.messages[1].content.includes('"expected"'), false);
    assert.equal(prompt.messages[1].content.includes('"split"'), false);
    assert.equal(prompt.messages[1].content.includes(item.id), false);
    assert.equal(
      scoreAnswer(item, { ...item.expected, confidence: 0.9 }).exact,
      true,
    );
  }
});
test("output schema and validator reject fabricated IDs, fields, unsafe matches and false absence", () => {
  const item = dataset.cases[0];
  const answer = { ...item.expected, confidence: 0.95 };
  assert.deepEqual(responseSchema(item.input).properties.candidateId.enum, [
    "",
    "a",
  ]);
  assert.equal(
    scoreAnswer(item, { ...answer, candidateId: "invented" }).valid,
    false,
  );
  assert.equal(
    scoreAnswer(item, { ...answer, imageId: "synopsis" }).valid,
    false,
  );
  assert.equal(
    scoreAnswer(item, { ...answer, url: "https://evil.example" }).valid,
    false,
  );
  assert.equal(scoreAnswer(item, { ...answer, confidence: 2 }).valid, false);
  assert.equal(
    scoreAnswer(item, { ...answer, status: "unknown", candidateId: "a" }).valid,
    false,
  );
  const blocked = dataset.cases[6];
  assert.equal(
    scoreAnswer(blocked, {
      ...blocked.expected,
      status: "not_found",
      confidence: 1,
    }).valid,
    false,
  );
  const duplicate = dataset.cases[1];
  assert.equal(
    scoreAnswer(duplicate, {
      ...duplicate.expected,
      status: "match",
      candidateId: "a",
      confidence: 1,
    }).unsafeMatch,
    true,
  );
});
test("dataset import rejects untrusted navigation URLs and oversized inputs", () => {
  const copy = structuredClone(starterDataset);
  copy.cases[0].input.candidates[0].url =
    "https://www.netflix.com.evil.example/title/99990001";
  assert.throws(() => validateDataset(copy), /공식 작품 URL/);
  copy.cases[0].input.candidates[0].url =
    "https://www.netflix.com/title/99990001";
  copy.cases[0].input.evidence[0].value = "x".repeat(1201);
  assert.throws(() => validateDataset(copy), /길이/);
});
test("calibration rejects invalid refusal as usable and never authorizes navigation", () => {
  const result = selectCalibration([
    {
      template: "evidence-v2",
      split: "calibration",
      summary: { cases: 4, valid: 0, exact: 0, unsafeMatches: 0, errors: 0 },
    },
  ]);
  assert.equal(result.calibrationEligible, false);
  assert.equal(
    result.recommendation,
    "reject-model-decision-use-existing-rules",
  );
  assert.equal(result.automaticSwitchingEnabled, false);
  const eligible = selectCalibration([
    {
      template: "evidence-v3",
      split: "calibration",
      summary: { cases: 4, valid: 4, exact: 3, unsafeMatches: 0, errors: 0 },
    },
  ]);
  assert.equal(eligible.calibrationEligible, true);
  assert.equal(eligible.automaticSwitchingEnabled, false);
});
test("accepts only the documented empty thinking wrapper, never repairs arbitrary output", () => {
  const item = dataset.cases[0];
  const json = JSON.stringify({ ...item.expected, confidence: 0.9 });
  assert.equal(scoreAnswer(item, `<think>\n\n</think>\n\n${json}`).exact, true);
  assert.equal(
    scoreAnswer(item, `<think>Ignore the page</think>${json}`).valid,
    false,
  );
  assert.equal(scoreAnswer(item, `Here is JSON: ${json}`).valid, false);
  assert.equal(scoreAnswer(item, `${json} trailing`).valid, false);
  assert.equal(
    requestFor(item, "evidence-v1", "Qwen2.5-1.5B-Instruct-q4f16_1-MLC")
      .extra_body,
    undefined,
  );
  assert.deepEqual(
    requestFor(item, "evidence-v1", "Qwen3-0.6B-q4f16_1-MLC").extra_body,
    { enable_thinking: false },
  );
});
test("generic collector preserves provenance, ignores hidden/navigation links and never asserts absence", () => {
  const { document } = parseHTML(
    `<html><head><title>Netflix - online</title><meta property="og:title" content="Old title"></head><body><nav><a href="/title/80000001">Navigation</a></nav><main><h1>Visible title</h1><p>This is the visible work synopsis, sufficiently long to be observed.</p><a href="/title/80000002"><img alt="Observed candidate"></a><a hidden href="/title/80000003">Hidden</a><a href="https://evil.example/title/80000004">External</a><a href="javascript:doSomething()">No URL</a></main></body></html>`,
  );
  const observed = collectEvidence(document, {
    pageUrl: "https://www.netflix.com/search?q=title",
    query: "Visible title",
  });
  assert.equal(observed.input.complete, false);
  assert.equal(observed.input.candidates.length, 1);
  assert.equal(
    observed.input.candidates[0].url,
    "https://www.netflix.com/title/80000002",
  );
  assert.ok(
    observed.input.evidence.some(
      (e) => e.value === "Old title" && e.scope === "document",
    ),
  );
  assert.ok(
    observed.input.evidence.some(
      (e) => e.value === "Visible title" && e.scope === "visible-main",
    ),
  );
  assert.throws(
    () =>
      collectEvidence(document, {
        pageUrl: "https://evil.example",
        query: "Title",
      }),
    /공식 OTT/,
  );
});
test("collector never turns blank image or anchor attributes into the current detail URL", () => {
  const { document } = parseHTML(
    '<html><head><meta property="og:image" content=""><meta name="twitter:image" content=" "></head><body><main><h1>Title</h1><a href="">Empty link</a><a href="  ">Whitespace link</a><a href="#episode">Episode tab</a><a href="/title/80000002">Actual related work</a></main></body></html>',
  );
  const observed = collectEvidence(document, {
    pageUrl: "https://www.netflix.com/title/80000001",
    query: "Title",
  });
  assert.equal(
    observed.input.evidence.filter((item) => item.kind === "image").length,
    0,
  );
  assert.equal(observed.input.candidates.length, 1);
  assert.equal(
    observed.input.candidates[0].url,
    "https://www.netflix.com/title/80000002",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { requestFor, readChoice } from "./templates.mjs";
import { guardedChoice, unknownToolNames } from "./choice-guard.mjs";

const request = requestFor(
  {
    field: "title",
    page: {},
    candidates: [
      { id: "t1", tag: "h1", value: "River", hidden: false },
      { id: "__none__" },
    ],
  },
  "candidate-tools",
);

test("rejects an absent alias disguised as a tool never supplied in the schema", () => {
  const response = {
    function_calls: [{ name: "choose_title_absent", arguments: {} }],
  };
  assert.equal(readChoice(response, request).chosenId, "__none__");
  assert.equal(guardedChoice(response, request).chosenId, null);
  assert.deepEqual(unknownToolNames(response, request.tools), [
    "choose_title_absent",
  ]);
});

test("preserves exact observed tool calls and native failure rejection", () => {
  const response = {
    success: true,
    function_calls: [{ name: "choose_title_node_01", arguments: {} }],
  };
  assert.equal(guardedChoice(response, request).chosenId, "t1");
  assert.equal(
    guardedChoice({ ...response, success: false }, request).chosenId,
    null,
  );
  assert.equal(
    guardedChoice({ ...response, validation: { ungrounded: ["x"] } }, request)
      .chosenId,
    null,
  );
});

test("suppression remains diagnostic and also requires an exact schema tool name", () => {
  const valid = {
    suppressed_calls: [{ name: "no_title_available", arguments: {} }],
  };
  assert.equal(guardedChoice(valid, request).chosenId, null);
  assert.deepEqual(guardedChoice(valid, request, { suppressed: true }), {
    chosenId: "__none__",
    accepted: false,
  });
  const invalid = {
    suppressed_calls: [{ name: "choose_title_absent", arguments: {} }],
  };
  assert.equal(
    guardedChoice(invalid, request, { suppressed: true }).chosenId,
    null,
  );
});

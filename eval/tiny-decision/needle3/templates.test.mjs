import test from "node:test";
import assert from "node:assert/strict";
import {
  requestFor,
  readChoice,
  suppressedChoice,
  templates,
} from "./templates.mjs";
const input = {
  document: "<main>Observed content</main>",
  question: "Pick the title element",
  options: [
    { id: "candidate_a", text: "main h1" },
    { id: "abstain", text: "Insufficient evidence" },
  ],
  expectedId: "SECRET_GOLD",
  split: "SECRET_SPLIT",
  id: "SECRET_CASE",
};
test("Needle templates pass only observed inputs, never scoring metadata", () => {
  for (const template of templates)
    assert.doesNotMatch(JSON.stringify(requestFor(input, template)), /SECRET_/);
});
test("low-confidence suppressed calls are diagnostic only", () => {
  const raw = {
    function_calls: [],
    suppressed_calls: [
      { name: "select_dom_element", arguments: { element_id: "candidate_a" } },
    ],
  };
  assert.equal(readChoice(raw, input.options, "enum-direct").accepted, false);
  assert.equal(
    suppressedChoice(raw, input.options, "enum-direct"),
    "candidate_a",
  );
});
test("unobserved and multiple tool calls cannot select a DOM element", () => {
  assert.equal(
    readChoice(
      {
        function_calls: [
          { name: "select_dom_element", arguments: { element_id: "invented" } },
        ],
      },
      input.options,
      "enum-direct",
    ).accepted,
    false,
  );
  assert.equal(
    readChoice(
      {
        function_calls: [
          { name: "choose_option_0" },
          { name: "choose_option_1" },
        ],
      },
      input.options,
      "tool-routing",
    ).accepted,
    false,
  );
  assert.equal(
    readChoice(
      { function_calls: [{ name: "choose_option_1", arguments: {} }] },
      input.options,
      "tool-routing",
    ).chosenId,
    "abstain",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { templates, requestFor, readChoice } from "./templates.mjs";
const pack = {
  field: "title",
  page: {
    title: "River | Brand",
    url: "https://example.test/search",
    headings: ["River"],
    dialogs: 1,
  },
  candidates: [
    {
      id: "t3",
      value: "River",
      tag: "h1",
      source: "text",
      hidden: false,
      dialog: true,
      parents: [{ tag: "dialog" }],
    },
    {
      id: "t1",
      value: "Brand",
      tag: "title",
      source: "metadata",
      hidden: true,
    },
    { id: "__none__", value: "" },
  ],
  expectedId: "t3",
  provenance: "private provenance",
};
test("Needle schemas use neutral aliases and exclude scoring/provenance metadata", () => {
  for (const template of templates) {
    const request = requestFor(pack, template);
    const payload = JSON.stringify({
      tools: request.tools,
      input: request.input,
    });
    assert.ok(!payload.includes("t3") && !payload.includes("t1"));
    assert.ok(
      !payload.includes("expectedId") &&
        !payload.includes("private provenance"),
    );
    assert.equal(request.binding.length, 3);
    assert.ok(request.measured.chars < 1800);
  }
});
test("only one observed tool choice maps back to the original candidate; suppression is diagnostic", () => {
  const request = requestFor(pack, "field-enum");
  const result = {
    success: true,
    function_calls: [
      { name: "choose_title_element", arguments: { node: "node_01" } },
    ],
    suppressed_calls: [
      { name: "choose_title_element", arguments: { node: "absent" } },
    ],
  };
  assert.equal(readChoice(result, request).chosenId, "t3");
  assert.equal(
    readChoice(result, request, { suppressed: true }).accepted,
    false,
  );
  assert.equal(
    readChoice(
      {
        function_calls: [
          { name: "choose_title_element", arguments: { node: "t3" } },
        ],
      },
      request,
    ).chosenId,
    null,
  );
  assert.equal(
    readChoice(
      { function_calls: [result.function_calls[0], result.function_calls[0]] },
      request,
    ).chosenId,
    null,
  );
});
test("candidate tools avoid repeated task instructions and reject over-budget inputs instead of dropping options", () => {
  const request = requestFor(pack, "candidate-tools");
  assert.ok(
    request.tools.every((t) => !t.description.includes("Select the current")),
  );
  assert.equal(
    readChoice(
      { function_calls: [{ name: "choose_title_node_01", arguments: {} }] },
      request,
    ).chosenId,
    "t3",
  );
  assert.throws(
    () => requestFor(pack, "field-enum", { maxChars: 10 }),
    /no candidate dropped/,
  );
});

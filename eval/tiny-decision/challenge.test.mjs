import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildChallenges } from "./challenge.mjs";
import { compactCase } from "./compact.mjs";

test("fictional challenge is separate, bounded and has internally consistent gold", () => {
  const rows = buildChallenges();
  assert.equal(rows.length, 12);
  assert.equal(new Set(rows.map((r) => r.scenario[0])).size, 12);
  for (const row of rows) {
    assert.equal(row.provenance.fictional, true);
    assert.equal(row.independentSample, false);
    assert.equal(row.options.length, 4);
    assert.ok(row.options.some((o) => o.id === row.expectedId));
    assert.ok(
      [row.document, row.question, ...row.options.map((o) => o.text)].join("\n")
        .length <= 1000,
    );
    assert.ok(
      !/expectedId|acceptedIds|annotationMethod/.test(
        row.document + row.question + JSON.stringify(row.options),
      ),
    );
  }
});
test("compact paired input preserves labels/order/semantic structure and needs only visible input", async () => {
  const rows = JSON.parse(
    await readFile(
      new URL("./data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  for (const row of rows) {
    const compact = compactCase(row);
    assert.deepEqual(
      compact.options.map((o) => o.id),
      row.options.map((o) => o.id),
    );
    assert.deepEqual(compact.acceptedIds, row.acceptedIds);
    assert.equal(compact.expectedId, row.expectedId);
    assert.ok(Array.from(compact.document).length <= 240);
    const publicOnly = {
      id: row.id,
      field: row.field,
      document: row.document,
      options: row.options,
    };
    assert.deepEqual(compactCase(publicOnly).options, compact.options);
    for (const option of compact.options.filter((o) => o.id !== "__none__")) {
      const value = JSON.parse(
        option.text.match(/^value=("(?:\\.|[^"\\])*")/)[1],
      );
      assert.ok(Array.from(value).length <= (row.field === "title" ? 80 : 60));
      const original = row.options.find((o) => o.id === option.id).text;
      assert.equal(
        option.text.match(/ @([^;]+)/)[1],
        original.match(/ @([^;]+)/)[1],
      );
    }
  }
});

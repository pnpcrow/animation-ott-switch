import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pairsFor, preparePairs, templates, naturalPassage } from "./templates.mjs";
import { featurePack } from "../tiny-decision/v2/features.mjs";

const rows = JSON.parse(await readFile(new URL("../light-dom/data/development-inputs.json", import.meta.url)));

test("template inputs cannot see evaluation identity, labels or CSS classes", () => {
  const source = rows[0];
  const poisoned = structuredClone(source);
  poisoned.id = "CASE_ID_SECRET";
  poisoned.expectedId = "GOLD_SECRET";
  poisoned.provenance = { work: "GOLD_SECRET" };
  poisoned.question = "GOLD_SECRET";
  poisoned.document = "GOLD_SECRET";
  for (const option of poisoned.options) {
    option.text = "GOLD_SECRET";
    if (option.evidence) for (const node of option.evidence.nodes) node.class = "CSS_SECRET";
  }
  for (const template of templates) {
    const before = pairsFor(source, template).map(p => p.variants);
    const after = pairsFor(poisoned, template).map(p => p.variants);
    assert.deepEqual(before, after);
    assert.doesNotMatch(JSON.stringify(after), /CASE_ID_SECRET|GOLD_SECRET|CSS_SECRET/);
  }
});

test("all templates preserve every concrete candidate and explicit budget tiers", () => {
  const jobs = preparePairs(rows);
  assert.equal(jobs.cases.length, rows.length * templates.length);
  for (const planned of jobs.cases) {
    const source = rows.find(row => row.id === planned.id);
    const actual = jobs.pairs.filter(p => p.caseId === planned.id && p.template === planned.template);
    assert.deepEqual(actual.map(p => p.candidateId), source.options.filter(o => o.id !== "__none__").map(o => o.id));
    for (const pair of actual) {
      assert.deepEqual(pair.variants.map(v => v.textLimit), [96, 64, 32]);
      assert.ok(pair.variants.every(v => v.premise && v.hypothesis));
      assert.ok(pair.variants.every(v => !/Answer only|Select one|Best answer/.test(v.hypothesis)));
    }
  }
});

test("candidate order does not alter the premise or hypothesis for a candidate", () => {
  const row = rows[0];
  const reversed = { ...row, options: [...row.options].reverse() };
  for (const template of templates) {
    const byId = new Map(pairsFor(row, template).map(p => [p.candidateId, p.variants]));
    for (const pair of pairsFor(reversed, template)) assert.deepEqual(pair.variants, byId.get(pair.candidateId));
  }
});

test("source and target languages expose equivalent observed scope flags", () => {
  const facts = featurePack(rows[0]);
  const node = { ...facts.candidates[0], hidden: true, navigation: true, inert: true, dialog: "dialog 0 last-visible-in-DOM", role: "heading" };
  assert.match(naturalPassage(facts.page, node), /hidden.*navigation.*inert.*dialog/);
  assert.match(naturalPassage(facts.page, node, "ko"), /숨겨져.*내비게이션.*비활성.*dialog/);
  assert.throws(() => naturalPassage(facts.page, { none: true }), /None/);
  assert.throws(() => preparePairs(rows, ["unknown"]), /Invalid/);
});

test("rendered text element dimensions are not falsely described as image dimensions", () => {
  const facts = featurePack(rows[0]);
  const node = { ...facts.candidates[0], tag: "p", width: 600, height: 72 };
  assert.match(naturalPassage(facts.page, node), /element dimensions are 600 by 72/);
  assert.doesNotMatch(naturalPassage(facts.page, node), /image dimensions/);
  assert.match(naturalPassage(facts.page, node, "ko"), /요소 크기는 600 × 72/);
  assert.match(naturalPassage(facts.page, { ...node, tag: "img" }), /image dimensions are 600 by 72/);
});

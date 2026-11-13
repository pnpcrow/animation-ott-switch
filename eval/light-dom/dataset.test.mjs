import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildInputs } from "../tiny-decision/v2/collect-inputs.mjs";
const read = async (file, root = "./data/") => JSON.parse(await readFile(new URL(root + file, import.meta.url), "utf8"));

test("all consumed 66 tasks become development without modifying pools, order or gold", async () => {
  for (const kind of ["inputs", "labels", "observations"]) {
    const previous = (await Promise.all(["development", "holdout"].map(split => read(`${split}-${kind}.json`, "../tiny-decision/v2/data/")))).flat();
    const current = await read(`development-${kind}.json`);
    assert.equal(current.length, kind === "observations" ? 22 : 66);
    assert.deepEqual(current, previous.map(row => kind === "observations" ? row : { ...row, split: "development" }));
    assert.equal(new Set(current.map(row => row.id)).size, current.length);
  }
});

test("new tasks come from six real page clusters with four disjoint target works", async () => {
  const observations = await read("holdout-observations.json"), inputs = await read("holdout-inputs.json"), labels = await read("holdout-labels.json");
  const oldWorks = new Set((await read("development-labels.json")).map(row => row.provenance.work));
  const positive = observations.filter(row => row.pageKind === "detail");
  assert.equal(observations.length, 6); assert.equal(inputs.length, 18); assert.equal(labels.length, 18);
  assert.equal(new Set(positive.map(row => row.work)).size, 4);
  assert.equal(new Set(positive.map(row => new URL(row.url).hostname)).size, 4);
  assert.ok(positive.every(row => !oldWorks.has(row.work)));
  for (const observation of observations) {
    assert.match(observation.htmlSha256, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(observation.capturedAt));
    assert.equal(observation.error, undefined);
    assert.ok(new URL(observation.pageUrl).protocol === "https:");
  }
  assert.equal(new Set(inputs.map(row => row.id)).size, inputs.length);
});

test("fixed generic pool construction does not consult annotations or insert gold", async () => {
  const observations = await read("holdout-observations.json"), inputs = await read("holdout-inputs.json"), labels = await read("holdout-labels.json");
  assert.deepEqual(inputs, buildInputs(observations));
  assert.equal(labels.filter(row => row.expectedId !== "__none__").length, 12);
  assert.equal(labels.filter(row => row.quality.emptyConcretePool).length, 1);
  for (const row of inputs) {
    assert.ok(row.options.length <= 9);
    assert.equal(new Set(row.options.map(option => option.id)).size, row.options.length);
    const label = labels.find(label => label.id === row.id);
    assert.ok(label.acceptedIds.includes(label.expectedId));
    assert.ok(label.acceptedIds.some(id => row.options.some(option => option.id === id)));
    assert.equal(label.quality.allAcceptedOutsidePool, false);
  }
});

test("model-input files recursively exclude scoring labels, provenance and annotation keys", async () => {
  const forbidden = new Set(["expectedId", "acceptedIds", "canonicalTitle", "provenance", "quality", "annotationMethod", "work", "pageKind"]);
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), `Forbidden input key: ${key}`); visit(child); }
  };
  visit(await read("development-inputs.json")); visit(await read("holdout-inputs.json"));
});

test("data bytes match the frozen manifest or exact documented public sanitization", async () => {
  const manifest = await read("manifest.json");
  const sanitization = await read("publication-sanitization.json", "../");
  for (const [file, expected] of Object.entries(manifest.hashes)) {
    const actual = createHash("sha256").update(await readFile(new URL("./data/" + file, import.meta.url))).digest("hex");
    const published = sanitization.files.find(row => row.path === `eval/light-dom/data/${file}`);
    if (published) assert.equal(published.beforeSha256, expected, "Sanitization must refer to the exact frozen input");
    assert.equal(actual, published?.afterSha256 ?? expected, `${file} changed outside the documented sanitization`);
  }
  assert.equal(manifest.poolRecall.positiveWithAcceptedChoice, 12);
  assert.equal(manifest.holdout.emptyConcretePools, 1);
});

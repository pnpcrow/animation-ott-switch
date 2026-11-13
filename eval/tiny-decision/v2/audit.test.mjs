import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { templates, v2Prompt } from "./templates.mjs";
import { refinedTemplates, refinedPrompt } from "./refined.mjs";

const run = promisify(execFile);
const allTemplates = [...templates, ...refinedTemplates];
const prompt = (row, template, textLimit = 96) =>
  (refinedTemplates.includes(template) ? refinedPrompt : v2Prompt)(
    row,
    template,
    { textLimit },
  );
const fixture = () => ({
  id: "PRIVATE_CASE_IDENTIFIER",
  split: "development",
  field: "image",
  question: "Choose the representative image for the opened work.",
  pageEvidence: {
    url: "https://example.test/work/7?token=PRIVATE_QUERY",
    documentTitle: "Observed work",
    headings: [{ text: "Observed work", hidden: false }],
    visibleDialogCount: 1,
  },
  options: [
    {
      id: "PRIVATE_CANDIDATE_A",
      text: "PRIVATE_LEGACY_OPTION",
      evidence: {
        value:
          "https://cdn.example.test/cover.webp?credential=PRIVATE_IMAGE_QUERY",
        nodes: [
          {
            tag: "img",
            attribute: "src",
            hidden: false,
            navigation: false,
            alt: "Observed cover",
            width: 600,
            height: 900,
            inert: false,
            parents: [{ tag: "main", class: "PRIVATE_CSS_SELECTOR" }],
            previous: "BEFORE_LOCAL",
            next: "AFTER_LOCAL",
          },
        ],
      },
    },
    {
      id: "PRIVATE_CANDIDATE_B",
      text: "PRIVATE_LEGACY_OPTION",
      evidence: {
        value: "https://cdn.example.test/icon.png",
        nodes: [
          {
            tag: "img",
            attribute: "src",
            hidden: false,
            navigation: true,
            alt: "Service icon",
            width: 16,
            height: 16,
          },
        ],
      },
    },
    { id: "__none__", text: "None", evidence: null },
  ],
});

test("all templates are invariant to scoring labels, provenance and opaque element IDs", () => {
  const row = fixture();
  const relabeled = structuredClone(row);
  Object.assign(relabeled, {
    id: "CHANGED_PRIVATE_CASE",
    expectedId: "PRIVATE_CANDIDATE_B",
    acceptedIds: ["PRIVATE_CANDIDATE_B"],
    canonicalTitle: "PRIVATE_CANONICAL_GOLD",
    quality: { isCorrectScope: true },
    provenance: { work: "PRIVATE_PROVENANCE" },
  });
  relabeled.options[0].id = "CHANGED_PRIVATE_A";
  relabeled.options[1].id = "CHANGED_PRIVATE_B";
  for (const template of allTemplates) {
    assert.equal(prompt(relabeled, template), prompt(row, template), template);
    assert.ok(!prompt(row, template).includes("PRIVATE_"), template);
  }
});

test("all declared evidence tiers retain every candidate in the same option position", () => {
  const row = fixture();
  for (const template of allTemplates)
    for (const limit of [96, 72, 48, 32]) {
      const rendered = prompt(row, template, limit);
      const options = rendered.split("\nOptions:\n")[1];
      assert.deepEqual(
        [...options.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1])),
        [1, 2, 3],
      );
      assert.ok(options.indexOf("cover.webp") < options.indexOf("icon.png"));
      assert.ok(rendered.endsWith("Best answer: ["));
    }
});

const report = (results, extra = {}) => ({
  finishedAt: "2026-01-01T00:00:00Z",
  model: "fixture-model",
  revision: "fixture-revision",
  inputsSha256: "fixture-inputs",
  labelsSha256: "fixture-labels",
  results,
  ...extra,
});
const predictions = () =>
  ["alpha", "beta"].flatMap((template) =>
    ["one", "two"].map((id) => ({
      id,
      template,
      split: "development",
      expectedId: "present",
      acceptedIds: ["present"],
      chosenId: "present",
      valid: true,
      correct: true,
      elapsedMs: template === "alpha" ? 99 : 1,
    })),
  );
async function harness(data, expectedCases, extraArgs = []) {
  const base = resolve(".tmp/v2-contract-audit");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "run-"));
  const reportPath = join(directory, "report.json"),
    outputPath = join(directory, "selection.json"),
    expectedPath = join(directory, "jobs.json");
  await writeFile(reportPath, JSON.stringify(data));
  const parameters = [
    "scripts/select-v2-templates.mjs",
    `--reports=${reportPath}`,
    `--output=${outputPath}`,
    ...extraArgs,
  ];
  if (expectedCases) {
    await writeFile(expectedPath, JSON.stringify({ cases: expectedCases }));
    parameters.push(`--expected=${expectedPath}`);
  }
  return {
    reportPath,
    outputPath,
    invoke: () =>
      run(process.execPath, parameters, {
        cwd: resolve("."),
        windowsHide: true,
      }),
  };
}

test("selector rejects identical omissions across templates using the frozen job plan", async () => {
  const planned = predictions();
  const h = await harness(
    report(planned.filter((r) => r.id !== "two")),
    planned,
  );
  await assert.rejects(h.invoke, /Incomplete planned development coverage/);
});

test("selector rejects a wholly missing planned template and validation-stage predictions", async () => {
  const planned = predictions();
  const missing = await harness(
    report(planned.filter((r) => r.template === "alpha")),
    planned,
  );
  await assert.rejects(missing.invoke, /every planned template/);
  const contaminated = await harness(
    report(planned.map((r) => ({ ...r, split: "holdout" }))),
    planned,
  );
  await assert.rejects(contaminated.invoke, /No validation data allowed/);
});

test("sampling plans validate screen coverage and unsampled reports require a job plan", async () => {
  const complete = await harness(
    report(predictions(), { sampling: { selectedIds: ["one", "two"] } }),
  );
  await complete.invoke();
  const incomplete = await harness(
    report(
      predictions().filter((r) => r.id !== "two"),
      { sampling: { selectedIds: ["one", "two"] } },
    ),
  );
  await assert.rejects(
    incomplete.invoke,
    /Incomplete planned development coverage/,
  );
  const unplanned = await harness(report(predictions()));
  await assert.rejects(unplanned.invoke, /Missing planned IDs/);
});

test("selection locks replay unchanged, reject altered evidence, and use stable name rather than latency", async () => {
  const rows = predictions();
  const h = await harness(report(rows), rows);
  await h.invoke();
  const first = JSON.parse(await readFile(h.outputPath, "utf8"));
  assert.deepEqual(first.selectedTemplates, ["alpha"]);
  await h.invoke();
  const replay = JSON.parse(await readFile(h.outputPath, "utf8"));
  assert.equal(replay.lockedAt, first.lockedAt);
  assert.equal(replay.validation.source, "explicit-expected-jobs");
  await writeFile(
    h.reportPath,
    JSON.stringify(
      report(
        rows.map((r) =>
          r.template === "alpha" ? { ...r, correct: false } : r,
        ),
      ),
    ),
  );
  await assert.rejects(h.invoke, /Existing selection lock differs/);
  assert.deepEqual(JSON.parse(await readFile(h.outputPath, "utf8")), replay);
});

test("failed inference remains in the planned denominator instead of disappearing", async () => {
  const planned = predictions();
  const rows = planned.map((r) =>
    r.template === "alpha" && r.id === "two"
      ? {
          ...r,
          chosenId: null,
          valid: false,
          correct: false,
          error: "fixture inference error",
        }
      : r,
  );
  const h = await harness(report(rows), planned);
  await h.invoke();
  const selected = JSON.parse(await readFile(h.outputPath, "utf8"));
  const alpha = selected.candidates.find((c) => c.template === "alpha");
  assert.equal(alpha.summary.attempted, 2);
  assert.equal(alpha.summary.accuracy, 0.5);
  assert.equal(alpha.summary.errors, 1);
  assert.deepEqual(selected.selectedTemplates, ["beta"]);
});

test("job generation keeps changed scoring sidecars outside prompts", async () => {
  const row = fixture();
  const base = resolve(".tmp/v2-contract-audit");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "prepare-"));
  const inputs = join(directory, "inputs.json"),
    labels = join(directory, "labels.json"),
    output = join(directory, "jobs.json");
  await writeFile(inputs, JSON.stringify([row]));
  const args = [
    "scripts/prepare-v2-jobs.mjs",
    `--inputs=${inputs}`,
    `--labels=${labels}`,
    `--output=${output}`,
    `--templates=${allTemplates.join(",")}`,
  ];
  await writeFile(
    labels,
    JSON.stringify([
      {
        id: row.id,
        expectedId: row.options[0].id,
        acceptedIds: [row.options[0].id],
        provenance: { work: "PRIVATE_FIRST_GOLD" },
      },
    ]),
  );
  await run(process.execPath, args, { cwd: resolve("."), windowsHide: true });
  const first = JSON.parse(await readFile(output, "utf8"));
  await writeFile(
    labels,
    JSON.stringify([
      {
        id: row.id,
        expectedId: row.options[1].id,
        acceptedIds: [row.options[1].id],
        provenance: { work: "PRIVATE_SECOND_GOLD" },
      },
    ]),
  );
  await run(process.execPath, args, { cwd: resolve("."), windowsHide: true });
  const second = JSON.parse(await readFile(output, "utf8"));
  assert.notEqual(first.labelsSha256, second.labelsSha256);
  assert.deepEqual(
    first.cases.map((c) => c.promptVariants),
    second.cases.map((c) => c.promptVariants),
  );
  assert.notDeepEqual(
    first.cases.map((c) => c.expectedId),
    second.cases.map((c) => c.expectedId),
  );
});

import { readFile, writeFile } from "node:fs/promises";
import { hash, summarize } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
const folder = "eval/tiny-decision/v2/slayer";
const sources = [];
const read = async (path) => {
  const text = await readFile(path, "utf8");
  sources.push({ path, sha256: hash(text) });
  return JSON.parse(text);
};
const screen = await read(`${folder}/screen.json`);
const development = await read(`${folder}/development.json`);
const selection = await read(`${folder}/selection.json`);
const pointwise = await read(`${folder}/pointwise-pilot.json`);
const pointwiseInference = await read(
  `${folder}/pointwise-pilot-inference.json`,
);
const order = await read(`${folder}/order.json`);
if (
  ![screen, development, pointwise, pointwiseInference, order].every(
    (report) => report.finishedAt,
  )
)
  throw new Error("All development diagnostics must be completed");
const winner = selection.selectedTemplates[0];
const describe = (rows) => {
  const positive = rows.filter((row) => row.expectedId !== "__none__");
  const absent = rows.filter((row) => row.expectedId === "__none__");
  return {
    summary: summarize(rows),
    positive: {
      n: positive.length,
      correct: positive.filter((row) => row.valid && row.correct).length,
    },
    absent: {
      n: absent.length,
      correct: absent.filter((row) => row.valid && row.correct).length,
    },
    constantNone: { n: rows.length, correct: absent.length },
    fields: Object.fromEntries(
      ["title", "image", "description"].map((field) => [
        field,
        summarize(rows.filter((row) => row.field === field)),
      ]),
    ),
    firstOptionChoices: rows.filter(
      (row) => row.valid && row.chosenId === row.optionIds?.[0],
    ).length,
    budget: {
      overLimit: rows.filter((row) => row.budget && !row.budget.withinBudget)
        .length,
      maximumNeededTokens: Math.max(
        0,
        ...rows.map((row) => row.budget?.neededTokens || 0),
      ),
      tierCounts: Object.fromEntries(
        [96, 72, 48, 32, null].map((tier) => [
          String(tier),
          rows.filter((row) => row.chosenTextLimit === tier).length,
        ]),
      ),
    },
  };
};
const byTemplate = (report) =>
  [...new Set(report.rows.map((row) => row.template))].map((template) => ({
    template,
    ...describe(report.rows.filter((row) => row.template === template)),
  }));
const pair = (before, after) => {
  if (
    new Set(before.map((row) => row.id)).size !== before.length ||
    new Set(after.map((row) => row.id)).size !== after.length
  )
    throw new Error("Paired cohorts require unique IDs");
  const right = new Map(after.map((row) => [row.id, row]));
  if (
    before.length !== after.length ||
    before.some((row) => !right.has(row.id))
  )
    throw new Error("Paired cohorts do not contain the same cases");
  const pairs = before.map((row) => {
    const next = right.get(row.id);
    if (
      row.field !== next.field ||
      row.expectedId !== next.expectedId ||
      JSON.stringify([...(row.acceptedIds || [row.expectedId])].sort()) !==
        JSON.stringify([...(next.acceptedIds || [next.expectedId])].sort())
    )
      throw new Error(`Paired labels/field differ: ${row.id}`);
    return {
      id: row.id,
      beforeValid: row.valid,
      afterValid: next.valid,
      bothValid: row.valid && next.valid,
      sameChoice: row.valid && next.valid && row.chosenId === next.chosenId,
      beforeCorrect: !!row.correct,
      afterCorrect: !!next.correct,
      beforeError: row.error || null,
      afterError: next.error || null,
    };
  });
  return {
    n: pairs.length,
    bothValid: pairs.filter((row) => row.bothValid).length,
    sameChoices: pairs.filter((row) => row.sameChoice).length,
    commonValidBeforeCorrect: pairs.filter(
      (row) => row.bothValid && row.beforeCorrect,
    ).length,
    commonValidAfterCorrect: pairs.filter(
      (row) => row.bothValid && row.afterCorrect,
    ).length,
    newlyValid: pairs.filter((row) => !row.beforeValid && row.afterValid)
      .length,
    newlyValidCorrect: pairs.filter(
      (row) => !row.beforeValid && row.afterValid && row.afterCorrect,
    ).length,
    correctToWrong: pairs.filter(
      (row) => row.beforeCorrect && !row.afterCorrect,
    ).length,
    wrongToCorrect: pairs.filter(
      (row) => !row.beforeCorrect && row.afterCorrect,
    ).length,
    pairs,
  };
};
const report = {
  schemaVersion: 2,
  model: development.model,
  revision: development.revision,
  runtime: development.runtime,
  winner,
  selectedAt: selection.selectedAt,
  development: byTemplate(development),
  screen: byTemplate(screen),
  pointwise: {
    summary: pointwise.summary,
    positive: pointwise.positive,
    absent: pointwise.absent,
    constantNone: pointwise.constantNone,
    threshold: pointwise.selection.threshold,
    lockedAt: pointwise.selection.lockedAt,
    eligibleForFreshHoldout: pointwise.eligibleForFreshHoldout,
    totalCandidateCalls: pointwise.totalCandidateCalls,
    totalInferenceMs: pointwise.totalInferenceMs,
    firstOptionChoices: pointwiseInference.rows.filter(
      (row) => row.chosenId === row.optionIds?.[0],
    ).length,
    disagreeingLabelOrderDecisions: pointwise.disagreeingLabelOrderDecisions,
    interpretation:
      "Threshold optimized on the same 12 development cases. Not calibrated probability or independent validation. All calls and both answer orders count toward parent latency.",
  },
  order,
  notes: [
    "All original 48 cases are development. Six templates screen on 12; top two expand to 48; one global winner is locked. Field-specific routing is not used.",
    "Raw observed features are used, not inferred correctness or artwork labels. Missing DOM attributes remain unknown.",
    "V2 uses native 0-based options and real-tokenizer tiers96/72/48/32; unchanged v1 uses its original 1-based options and uncompressed prompt. All options remain; over-budget cases fail explicitly.",
    "Slayer v1 winner is Korean korean-structure; legacy-enriched uses English dom-hierarchy. The v1-to-enriched comparison changes language/instruction and numbering as well as evidence, so it is not an isolated evidence ablation.",
    "The two v2 conditions share evidence compiler and native numbering. They compare template/serialization choices, but tokenizer-selected text tiers can also differ.",
    "CPU float32 inference, not new WebGPU timing. Concurrent load and reused observations preclude fair latency ranking.",
  ],
};
if (args["development-only"] !== "true") {
  const freeze = await read("eval/tiny-decision/v2/global-freeze.json");
  if (
    !freeze.lockedAt ||
    Date.parse(freeze.lockedAt) < Date.parse(selection.selectedAt)
  )
    throw new Error("Global freeze must follow development selection");
  for (const [path, expected] of Object.entries(freeze.sources)) {
    if (hash(await readFile(path, "utf8")) !== expected)
      throw new Error(`Frozen source changed: ${path}`);
  }
  for (const entry of Object.values(freeze.selections)) {
    if (hash(await readFile(entry.path, "utf8")) !== entry.sha256)
      throw new Error(`Frozen selection changed: ${entry.path}`);
  }
  const fresh = await read(args.fresh || `${folder}/fresh.json`);
  const legacy = await read(args.legacy || `${folder}/legacy-fresh.json`);
  if (
    !fresh.finishedAt ||
    !legacy.finishedAt ||
    [...fresh.rows, ...legacy.rows].some((row) => row.split !== "holdout")
  )
    throw new Error("Completed frozen holdout reports are required");
  const selectedRows = fresh.rows.filter((row) => row.template === winner);
  const enrichedRows = fresh.rows.filter(
    (row) => row.template === "legacy-enriched",
  );
  if (
    selectedRows.length !== 18 ||
    enrichedRows.length !== 18 ||
    legacy.rows.length !== 18
  )
    throw new Error(
      "Every frozen comparison condition must contain all 18 cases",
    );
  report.fresh = {
    globalFreezeAt: freeze.lockedAt,
    selected: { template: winner, ...describe(selectedRows) },
    legacyEnriched: { template: "legacy-enriched", ...describe(enrichedRows) },
    unchangedV1: { template: "korean-structure", ...describe(legacy.rows) },
    pairedV1ToSelected: pair(legacy.rows, selectedRows),
    pairedEnrichedToSelected: pair(enrichedRows, selectedRows),
  };
}
report.sources = sources;
report.generatedAt = new Date().toISOString();
const resultPath = args.output || `${folder}/summary.json`;
await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n");
const percent = (value) => `${(100 * value).toFixed(1)}%`;
const tableRow = (name, data) =>
  `| ${name} | ${data.summary.correct}/${data.summary.attempted} (${percent(data.summary.accuracy)}) | ${data.positive.correct}/${data.positive.n} | ${data.absent.correct}/${data.absent.n} | ${data.summary.falseSelections} | ${data.summary.errors} |`;
const constantNone = (data) => ({
  summary: {
    correct: data.absent.n,
    attempted: data.summary.attempted,
    accuracy: data.absent.n / data.summary.attempted,
    falseSelections: 0,
    errors: 0,
  },
  positive: { n: data.positive.n, correct: 0 },
  absent: { n: data.absent.n, correct: data.absent.n },
});
const lines = [
  "# Slayer v2 measured results",
  "",
  `Frozen global template: \`${winner}\` at \`${selection.selectedAt}\`. Runtime: ${development.runtime}, float32.`,
  "",
  "All original 48 cases are development. The selected template is not re-tuned after the team-wide freeze.",
  "",
  "| Development condition | Correct | Positive correct | Absent correct | Wrong positive choices | Errors |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...report.development.map((data) => tableRow(data.template, data)),
  tableRow(
    "Constant-none baseline (no model)",
    constantNone(report.development[0]),
  ),
  "",
  `The separate pointwise pilot returned ${pointwise.summary.correct}/12, with ${pointwise.positive.correct}/6 positive elements correct. Constant-none also scores ${pointwise.constantNone.correct}/12. It made ${pointwise.totalCandidateCalls} binary calls and used ${(pointwise.totalInferenceMs / 1000).toFixed(2)} seconds total inference time. The predeclared fresh gate ${pointwise.eligibleForFreshHoldout ? "passed" : "failed"}. These scores optimize a threshold on the pilot itself; they are not independent validation.`,
  "",
  `Binary answer reversal changed all ${pointwise.disagreeingLabelOrderDecisions} candidate decisions; ${report.pointwise.firstOptionChoices}/${pointwise.totalCandidateCalls} individual calls selected the first option. The fixed multichoice winner retained ${order.sameChoices}/${order.validPairs} element choices under candidate reversal in the six-case development diagnostic.`,
  "",
];
if (report.fresh)
  lines.push(
    `Fresh evaluation after team freeze at \`${report.fresh.globalFreezeAt}\`:`,
    "",
    "| Frozen fresh condition | Correct | Positive correct | Absent correct | Wrong positive choices | Errors |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    tableRow(
      "Unchanged v1 Korean structure (1-based)",
      report.fresh.unchangedV1,
    ),
    tableRow("V2 legacy-enriched (0-based)", report.fresh.legacyEnriched),
    tableRow(`V2 ${winner} (0-based)`, report.fresh.selected),
    tableRow(
      "Constant-none baseline (no model)",
      constantNone(report.fresh.selected),
    ),
    "",
    `These ${report.fresh.selected.summary.attempted} cases are a small frozen fixture cohort, not proof of production accuracy. They preserve all errors in the denominator.`,
    "",
    `On the ${report.fresh.pairedV1ToSelected.bothValid} cases valid in both unchanged v1 and selected v2, correctness is ${report.fresh.pairedV1ToSelected.commonValidBeforeCorrect}/${report.fresh.pairedV1ToSelected.bothValid} versus ${report.fresh.pairedV1ToSelected.commonValidAfterCorrect}/${report.fresh.pairedV1ToSelected.bothValid}. Selected v2 makes ${report.fresh.pairedV1ToSelected.newlyValid} previously failed cases evaluable, of which ${report.fresh.pairedV1ToSelected.newlyValidCorrect} are correct. Against the v2 enriched control, ${report.fresh.pairedEnrichedToSelected.wrongToCorrect} cases change from wrong to correct and ${report.fresh.pairedEnrichedToSelected.correctToWrong} regress.`,
    "",
  );
lines.push(...report.notes.map((note) => `- ${note}`), "");
await writeFile(args.markdown || `${folder}/RESULTS.md`, lines.join("\n"));
console.log(
  JSON.stringify({
    output: resultPath,
    winner,
    fresh: !!report.fresh,
    pointwiseFreshEligible: pointwise.eligibleForFreshHoldout,
  }),
);

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, summarize } from "../eval/tiny-decision/metrics.mjs";

export function cohortOf(row) {
  if (row.provenance.kind === "synthetic-layout-stress")
    return row.provenance.transform;
  return row.provenance.kind;
}
function stats(rows) {
  const completed = rows.filter((r) => !r.error && !r.missing);
  const latency = summarize(completed);
  return {
    ...summarize(rows),
    completedInferenceLatency: {
      n: completed.length,
      p50Ms: latency.p50Ms,
      p95Ms: latency.p95Ms,
      note: "Excludes runtime/context errors and missing predictions; includes completed but invalid/suppressed outputs.",
    },
    invalid: rows.filter((r) => !r.valid).length,
    missing: rows.filter((r) => r.missing).length,
    rawProposal: {
      proposed: rows.filter((r) => r.rawProposalId != null).length,
      correct: rows.filter((r) => r.rawProposalCorrect).length,
      note: "Diagnostic proposal only; suppressed or invalid calls never become accepted selections.",
    },
  };
}
function slices(rows, key) {
  return Object.fromEntries(
    [...new Set(rows.map(key))].map((k) => [
      k,
      stats(rows.filter((r) => key(r) === k)),
    ]),
  );
}
export function aggregateReports(inputs, corpus) {
  const gold = new Map(corpus.map((row) => [row.id, row]));
  if (gold.size !== corpus.length) throw new Error("Duplicate corpus IDs");
  const grouped = new Map(),
    sources = [];
  for (const { path, report } of inputs) {
    const model = report.model || report.export?.model;
    if (!model) throw new Error(`Missing model identity: ${path}`);
    const baseline = model.startsWith("generic-dom-heuristic");
    if (!baseline && !report.finishedAt)
      throw new Error(`Incomplete report: ${path}`);
    if (report.error)
      throw new Error(`Report-level failure: ${path}: ${report.error}`);
    const runtime =
      report.runtime ||
      report.engine ||
      (baseline ? "JavaScript deterministic" : "unknown");
    const rows =
      report.results ||
      report.rows ||
      report.runs?.flatMap((run) =>
        run.rows.map((r) => ({
          ...r,
          template: r.template || run.template,
          split: r.split || run.split,
        })),
      );
    if (!rows?.length) throw new Error(`Raw prediction rows required: ${path}`);
    sources.push({
      path,
      sha256: hash(report),
      model,
      runtime,
      finishedAt: report.finishedAt || null,
      calibrationSampling: report.calibrationSampling || null,
    });
    for (const raw of rows) {
      const target = gold.get(raw.id);
      if (!target)
        throw new Error(
          `Unknown case ${raw.id} in ${path}; do not mix smoke or other datasets`,
        );
      if (raw.split && raw.split !== target.split)
        throw new Error(`Split mismatch: ${raw.id}`);
      if (raw.expectedId && raw.expectedId !== target.expectedId)
        throw new Error(`Gold mismatch: ${raw.id}`);
      if (
        raw.acceptedIds &&
        JSON.stringify(raw.acceptedIds) !==
          JSON.stringify(target.acceptedIds || [target.expectedId])
      )
        throw new Error(`Accepted-set mismatch: ${raw.id}`);
      const recordedOptions = raw.optionIds || raw.options?.map((o) => o.id);
      if (
        recordedOptions &&
        JSON.stringify(recordedOptions) !==
          JSON.stringify(target.options.map((o) => o.id))
      )
        throw new Error(`Option order mismatch: ${raw.id}`);
      const cohort = cohortOf(target),
        template = raw.template || "baseline";
      const key = JSON.stringify([
        model,
        runtime,
        template,
        target.split,
        cohort,
      ]);
      let group = grouped.get(key);
      if (!group) {
        group = {
          key,
          model,
          runtime,
          template,
          split: target.split,
          cohort,
          sourcePaths: [],
          rows: [],
          expectedIds: new Set(),
        };
        grouped.set(key, group);
      }
      if (group.rows.some((r) => r.id === raw.id))
        throw new Error(
          `Duplicate prediction ${raw.id}/${template}; use raw reports once`,
        );
      if (!group.sourcePaths.includes(path)) group.sourcePaths.push(path);
      const planned =
        target.split === "calibration" &&
        report.calibrationSampling?.selectedIds;
      const expected = corpus.filter(
        (c) =>
          c.split === target.split &&
          cohortOf(c) === cohort &&
          (!planned || planned.includes(c.id)),
      );
      for (const r of expected) group.expectedIds.add(r.id);
      if (planned && !planned.includes(raw.id))
        throw new Error(
          `Prediction outside declared calibration subset: ${raw.id}`,
        );
      const chosenId = raw.chosenId ?? raw.selectedId ?? null;
      const valid =
        !raw.error &&
        raw.valid !== false &&
        target.options.some((o) => o.id === chosenId);
      const correct =
        valid && (target.acceptedIds || [target.expectedId]).includes(chosenId);
      if (raw.correct !== undefined && Boolean(raw.correct) !== correct)
        throw new Error(
          `Recorded score disagrees with fresh scoring: ${raw.id}`,
        );
      const proposal = chosenId ?? raw.suppressedId ?? null;
      group.rows.push({
        id: raw.id,
        baseCaseId: target.provenance.baseCaseId || raw.id,
        field: target.field,
        targetClass: target.expectedId === "__none__" ? "none" : "positive",
        multiCandidate:
          target.quality?.atLeastThreeCandidates ?? target.options.length >= 4,
        chosenId,
        valid,
        correct,
        error: raw.error || null,
        elapsedMs: raw.elapsedMs ?? raw.latencyMs,
        expectedId: target.expectedId,
        acceptedIds: target.acceptedIds || [target.expectedId],
        rawProposalId: proposal,
        rawProposalCorrect: (
          target.acceptedIds || [target.expectedId]
        ).includes(proposal),
      });
    }
  }
  const groups = [...grouped.values()].map((group) => {
    const observedIds = new Set(group.rows.map((r) => r.id));
    const missingIds = [...group.expectedIds].filter(
      (id) => !observedIds.has(id),
    );
    for (const id of missingIds) {
      const target = gold.get(id);
      group.rows.push({
        id,
        baseCaseId: target.provenance.baseCaseId || id,
        field: target.field,
        targetClass: target.expectedId === "__none__" ? "none" : "positive",
        multiCandidate:
          target.quality?.atLeastThreeCandidates ?? target.options.length >= 4,
        chosenId: null,
        valid: false,
        correct: false,
        error: "Missing completed prediction",
        missing: true,
        expectedId: target.expectedId,
        acceptedIds: target.acceptedIds || [target.expectedId],
      });
    }
    return {
      ...group,
      expectedIds: undefined,
      coverage: {
        expected: group.expectedIds.size,
        reported: observedIds.size,
        missingIds,
      },
      summary: stats(group.rows),
      byField: slices(group.rows, (r) => r.field),
      byTarget: slices(group.rows, (r) => r.targetClass),
      byCandidateCount: slices(group.rows, (r) =>
        r.multiCandidate ? "at-least-three" : "fewer-than-three",
      ),
    };
  });
  const paired = [];
  for (const variant of groups.filter((g) =>
    [
      "candidate-permutation",
      "class-rename",
      "synthetic-context-ablation",
      "compact-input-sensitivity",
    ].includes(g.cohort),
  )) {
    const base = groups.find(
      (g) =>
        g.model === variant.model &&
        g.runtime === variant.runtime &&
        g.template === variant.template &&
        g.split === variant.split &&
        g.cohort === "real-public-dom",
    );
    if (!base) {
      paired.push({
        group: variant.key,
        error: "Matching original report absent; no paired claim possible",
      });
      continue;
    }
    const rows = variant.rows.map((changed) => ({
      changed,
      original: base.rows.find((r) => r.id === changed.baseCaseId),
    }));
    if (rows.some((r) => !r.original))
      throw new Error(`Missing original cases for ${variant.key}`);
    const bothValid = rows.filter(
      ({ original, changed }) => original.valid && changed.valid,
    );
    paired.push({
      group: variant.key,
      originalGroup: base.key,
      pairs: rows.length,
      bothValid: bothValid.length,
      originalCorrect: rows.filter((r) => r.original.correct).length,
      variantCorrect: rows.filter((r) => r.changed.correct).length,
      sameChoiceAmongBothValid: bothValid.filter(
        (r) => r.original.chosenId === r.changed.chosenId,
      ).length,
      stableCorrect: bothValid.filter(
        (r) =>
          r.original.chosenId === r.changed.chosenId &&
          r.original.correct &&
          r.changed.correct,
      ).length,
      stableWrong: bothValid.filter(
        (r) =>
          r.original.chosenId === r.changed.chosenId &&
          !r.original.correct &&
          !r.changed.correct,
      ).length,
      changedBetweenAcceptedAlternatives: bothValid.filter(
        (r) =>
          r.original.chosenId !== r.changed.chosenId &&
          r.original.correct &&
          r.changed.correct,
      ).length,
      bothCorrect: bothValid.filter(
        (r) => r.original.correct && r.changed.correct,
      ).length,
      bothWrong: bothValid.filter(
        (r) => !r.original.correct && !r.changed.correct,
      ).length,
      correctToWrong: rows.filter(
        (r) => r.original.correct && !r.changed.correct,
      ).length,
      wrongToCorrect: rows.filter(
        (r) => !r.original.correct && r.changed.correct,
      ).length,
      errorOrInvalidPairs: rows.length - bothValid.length,
      note: "Choice stability is not accuracy: stable wrong answers and equivalent accepted IDs must be distinguished. Pairs are dependent, not new samples.",
    });
  }
  const holdout = groups.filter(
    (g) => g.split === "holdout" && g.cohort === "real-public-dom",
  );
  const comparable = [];
  for (let a = 0; a < holdout.length; a++)
    for (let b = a + 1; b < holdout.length; b++) {
      const first = holdout[a],
        second = holdout[b];
      const pairs = first.rows
        .map((r) => [r, second.rows.find((o) => o.id === r.id)])
        .filter((p) => p[1]);
      const validPairs = pairs.filter((p) => p.every((r) => r.valid));
      comparable.push({
        first: first.key,
        second: second.key,
        sharedCases: pairs.length,
        bothValid: validPairs.length,
        firstCorrectAllShared: pairs.filter((p) => p[0].correct).length,
        secondCorrectAllShared: pairs.filter((p) => p[1].correct).length,
        firstCorrectBothValid: validPairs.filter((p) => p[0].correct).length,
        secondCorrectBothValid: validPairs.filter((p) => p[1].correct).length,
        bothValidCaseIds: validPairs.map((p) => p[0].id),
        note: "All-shared counts include errors. Both-valid subset is only a coverage diagnostic and must not replace the full denominator.",
      });
    }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    corpusSha256: hash(corpus),
    sources,
    groups,
    paired,
    comparable,
    note: "Gold joined by frozen case ID; errors/missing predictions retained. Synthetic, compact and ablation cohorts are separate. No model is executed or template selected by this script.",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((s) => {
      const i = s.indexOf("=");
      return [s.slice(2, i), s.slice(i + 1)];
    }),
  );
  if (!args.reports || !args.output)
    throw new Error(
      "--reports=raw1.json,raw2.json --output=summary.json required",
    );
  const paths = (
    args.datasets ||
    [
      "dom-selection.json",
      "dom-selection-stress.json",
      "dom-selection-ablation.json",
      "dom-selection-compact.json",
      "synthetic-challenge.json",
    ]
      .map((n) => `eval/tiny-decision/data/${n}`)
      .join(",")
  ).split(",");
  const corpus = (
    await Promise.all(
      paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
    )
  ).flat();
  const inputs = await Promise.all(
    args.reports.split(",").map(async (path) => ({
      path,
      report: JSON.parse(await readFile(path, "utf8")),
    })),
  );
  const report = aggregateReports(inputs, corpus);
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      output: args.output,
      groups: report.groups.map((g) => ({
        model: g.model,
        runtime: g.runtime,
        template: g.template,
        split: g.split,
        cohort: g.cohort,
        summary: g.summary,
        coverage: g.coverage,
      })),
      paired: report.paired.length,
    }),
  );
}

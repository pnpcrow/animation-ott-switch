import { summarize } from "../tiny-decision/metrics.mjs";

export function choose(scores, threshold) {
  if (!scores.length) return { chosenId: "__none__", valid: true };
  if (scores.some(s => !Number.isFinite(s.score) || s.error || s.valid === false)) return { valid: false, error: "Missing/failed candidate inference" };
  if (!Number.isFinite(threshold)) return { valid: false, error: "Non-finite decision threshold" };
  if (scores.some(s => typeof s.candidateId !== "string") || new Set(scores.map(s => s.candidateId)).size !== scores.length) return { valid: false, error: "Duplicate or missing candidate identity" };
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  if (sorted[0].score < threshold || (sorted[1] && Math.abs(sorted[0].score - sorted[1].score) < 1e-9)) return { chosenId: "__none__", valid: true };
  return { chosenId: sorted[0].candidateId, valid: true };
}

export function scoreCases(jobs, labels, predictions, template, threshold) {
  const byLabel = new Map(labels.map(r => [r.id, r]));
  const byPrediction = new Map(predictions.map(r => [r.id, r]));
  if (byLabel.size !== labels.length || byPrediction.size !== predictions.length) throw new Error("Duplicate labels/predictions");
  if (!jobs.cases.length || !jobs.templates.length) throw new Error("At least one planned case and template are required");
  if (new Set(jobs.templates).size !== jobs.templates.length || !jobs.templates.includes(template)) throw new Error("Unknown or duplicate planned template");
  if (new Set(jobs.cases.map(row => JSON.stringify([row.id, row.template]))).size !== jobs.cases.length) throw new Error("Duplicate planned case");
  const byPair = new Map(jobs.pairs.map(p => [p.id, p]));
  if (byPair.size !== jobs.pairs.length) throw new Error("Duplicate planned pair");
  const covered = new Set();
  for (const row of jobs.cases) {
    if (!jobs.templates.includes(row.template)) throw new Error("Case belongs to an unplanned template");
    if (!row.optionIds.includes("__none__") || new Set(row.optionIds).size !== row.optionIds.length) throw new Error("Every case requires unique observed choices including none");
    const concrete = new Set(row.optionIds.filter(id => id !== "__none__"));
    const observed = new Set();
    for (const id of row.pairIds) {
      const pair = byPair.get(id);
      if (!pair || pair.caseId !== row.id || pair.field !== row.field || pair.template !== row.template) throw new Error("Pair identity disagrees with parent case");
      if (covered.has(id) || observed.has(pair.candidateId)) throw new Error("Duplicate pair coverage in case plan");
      if (!concrete.has(pair.candidateId)) throw new Error("Pair candidate was not observed");
      covered.add(id); observed.add(pair.candidateId);
    }
    if (observed.size !== concrete.size) throw new Error("Every concrete candidate requires a planned pair");
  }
  if (covered.size !== byPair.size) throw new Error("Unreferenced pair outside case plan");
  const shape = row => JSON.stringify([row.id, row.field, row.split, [...row.optionIds].sort()]);
  const perTemplate = jobs.templates.map(name => jobs.cases.filter(row => row.template === name).map(shape).sort());
  if (new Set(perTemplate.map(rows => JSON.stringify(rows))).size !== 1) throw new Error("Templates must share the same planned cases and candidates");
  const caseIds = new Set(jobs.cases.map(row => row.id));
  if (caseIds.size !== byLabel.size || [...caseIds].some(id => !byLabel.has(id))) throw new Error("Every planned case requires exactly one scoring label");
  const expected = jobs.pairs.map(p => p.id);
  if (expected.length !== predictions.length || expected.some(id => !byPrediction.has(id))) throw new Error("Every planned pair must have a result, including failures");
  return jobs.cases.filter(row => row.template === template).map(row => {
    const label = byLabel.get(row.id);
    if (!label) throw new Error("Missing scoring label");
    const predictionsForCase = row.pairIds.map(id => ({ ...byPrediction.get(id), candidateId: byPair.get(id).candidateId }));
    const selected = choose(predictionsForCase, threshold);
    const acceptedIds = label.acceptedIds || [label.expectedId];
    if (!Array.isArray(acceptedIds) || !acceptedIds.length || new Set(acceptedIds).size !== acceptedIds.length || !acceptedIds.includes(label.expectedId)) throw new Error("Scoring labels require nonempty consistent accepted IDs");
    if (!acceptedIds.every(id => row.optionIds.includes(id))) throw new Error("Gold missing from fixed pool");
    return {
      id: row.id, field: row.field, split: row.split, template, expectedId: label.expectedId, acceptedIds,
      optionIds: row.optionIds, ...selected,
      correct: !!selected.valid && acceptedIds.includes(selected.chosenId),
      elapsedMs: predictionsForCase.every(p => Number.isFinite(p.elapsedMs)) ? predictionsForCase.reduce((s, p) => s + p.elapsedMs, 0) : null,
      trivialNoCandidate: row.pairIds.length === 0,
    };
  });
}

export function selectConfiguration(jobs, labels, predictions) {
  if (jobs.cases.some(r => r.split !== "development") || labels.some(r => r.split !== "development")) throw new Error("Development only");
  const candidates = [];
  for (const template of jobs.templates) {
    const selectedIds = new Set(jobs.pairs.filter(p => p.template === template).map(p => p.id));
    const values = predictions.filter(p => selectedIds.has(p.id) && Number.isFinite(p.score) && !p.error && p.valid !== false).map(p => p.score);
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    const thresholds = distinct.length ? [distinct[0] - 1, ...distinct, distinct.at(-1) + 1] : [0];
    for (const threshold of thresholds) {
      const rows = scoreCases(jobs, labels, predictions, template, threshold);
      candidates.push({ template, threshold, summary: summarize(rows), positiveCorrect: rows.filter(r => r.correct && r.expectedId !== "__none__").length });
    }
  }
  candidates.sort((a, b) => b.summary.correct - a.summary.correct || a.summary.falseSelections - b.summary.falseSelections || b.positiveCorrect - a.positiveCorrect || a.template.localeCompare(b.template) || b.threshold - a.threshold);
  return {
    selected: candidates[0], perTemplate: jobs.templates.map(template => candidates.find(c => c.template === template)),
    policy: "One global threshold per template; development accuracy, fewer false selections, positive correctness, stable template ID, larger threshold. No timing criterion; no fresh labels.",
    lockedAt: new Date().toISOString(), automaticNavigation: false,
  };
}

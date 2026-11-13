import { summarize } from "../tiny-decision/metrics.mjs";

export function summarizeCases(rows) {
  const summarizeGroup = selected => ({
    ...summarize(selected),
    positive: summarize(selected.filter(r => r.expectedId !== "__none__")),
    none: summarize(selected.filter(r => r.expectedId === "__none__")),
  });
  return {
    all: summarizeGroup(rows),
    nontrivial: summarizeGroup(rows.filter(r => !r.trivialNoCandidate)),
    fields: Object.fromEntries(["title", "image", "description"].map(field => [field, summarizeGroup(rows.filter(r => r.field === field))])),
    rows,
  };
}

export function paired(before, after) {
  const right = new Map(after.rows.map(r => [r.id, r]));
  if (right.size !== after.rows.length || new Set(before.rows.map(r => r.id)).size !== before.rows.length || right.size !== before.rows.length || before.rows.some(r => !right.has(r.id))) throw new Error("One-to-one paired cases required");
  const result = { total: right.size, bothCorrect: 0, improved: 0, regressed: 0, bothWrong: 0 };
  for (const left of before.rows) {
    const next = right.get(left.id);
    result[left.correct ? next.correct ? "bothCorrect" : "regressed" : next.correct ? "improved" : "bothWrong"]++;
  }
  return result;
}

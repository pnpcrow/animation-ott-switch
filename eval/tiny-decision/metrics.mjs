import { createHash } from "node:crypto";
export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function summarize(rows) {
  const attempted = rows.length,
    valid = rows.filter((r) => r.valid),
    accepted = valid.filter((r) => r.chosenId !== "__none__");
  const numeric = rows
    .map((r) => r.elapsedMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const quantile = (q) =>
    numeric.length
      ? numeric[
          Math.min(numeric.length - 1, Math.floor((numeric.length - 1) * q))
        ]
      : null;
  return {
    attempted,
    valid: valid.length,
    correct: valid.filter((r) => r.correct).length,
    accuracy: attempted ? valid.filter((r) => r.correct).length / attempted : 0,
    accepted: accepted.length,
    acceptedPrecision: accepted.length
      ? accepted.filter((r) => r.correct).length / accepted.length
      : null,
    falseSelections: accepted.filter((r) => !r.correct).length,
    correctAbstentions: valid.filter(
      (r) => r.chosenId === "__none__" && r.correct,
    ).length,
    errors: rows.filter((r) => r.error).length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
  };
}
export function score(row, result) {
  const valid =
    typeof result.chosenId === "string" &&
    row.options.some((o) => o.id === result.chosenId) &&
    !result.error;
  return {
    ...result,
    id: row.id,
    split: row.split,
    scenario: row.scenario,
    expectedId: row.expectedId,
    acceptedIds: row.acceptedIds || [row.expectedId],
    valid,
    correct:
      valid && (row.acceptedIds || [row.expectedId]).includes(result.chosenId),
  };
}
export function selectTemplate(reports) {
  const scored = reports.filter((r) => r.split === "calibration");
  if (!scored.length) throw new Error("Calibration reports required");
  const ranked = [...scored].sort(
    (a, b) =>
      b.summary.accuracy - a.summary.accuracy ||
      a.summary.falseSelections - b.summary.falseSelections ||
      b.summary.valid - a.summary.valid ||
      (a.summary.p50Ms ?? Infinity) - (b.summary.p50Ms ?? Infinity) ||
      a.template.localeCompare(b.template),
  );
  return {
    template: ranked[0].template,
    policy:
      "Highest calibration accuracy; then fewer false selections, more valid outputs, lower median latency, stable name tie-break. Holdout is never used.",
    calibration: ranked[0].summary,
    automaticNavigation: false,
  };
}

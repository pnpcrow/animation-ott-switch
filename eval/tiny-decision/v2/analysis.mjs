import { summarize } from "../metrics.mjs";

export function scorePinned(corpus, predictions) {
  if (new Set(corpus.map((row) => row.id)).size !== corpus.length)
    throw new Error("Duplicate corpus ID");
  const byId = new Map(predictions.map((row) => [row.id, row]));
  if (byId.size !== predictions.length)
    throw new Error("Duplicate prediction ID");
  const ids = new Set(corpus.map((row) => row.id));
  if (byId.size !== ids.size || predictions.some((row) => !ids.has(row.id)))
    throw new Error("Incomplete or unexpected prediction coverage");
  const rows = corpus.map((label) => {
    const prediction = byId.get(label.id);
    const acceptedIds = label.acceptedIds || [label.expectedId];
    const optionIds = label.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length)
      throw new Error("Duplicate corpus option ID");
    const recordedOptionIds =
      prediction.optionIds ?? prediction.options?.map((option) => option.id);
    if (
      recordedOptionIds !== undefined &&
      (new Set(recordedOptionIds).size !== recordedOptionIds.length ||
        JSON.stringify([...recordedOptionIds].sort()) !==
          JSON.stringify([...optionIds].sort()))
    )
      throw new Error("Recorded option identities changed");
    const observed = label.options.some(
      (option) => option.id === prediction.chosenId,
    );
    const valid = prediction.valid === true && observed && !prediction.error;
    const correct = valid && acceptedIds.includes(prediction.chosenId);
    if (prediction.correct !== undefined && prediction.correct !== correct)
      throw new Error(
        `Recorded score disagrees with frozen label: ${label.id}`,
      );
    if (
      prediction.expectedId !== undefined &&
      prediction.expectedId !== label.expectedId
    )
      throw new Error("Recorded gold changed");
    if (
      prediction.acceptedIds !== undefined &&
      JSON.stringify([...prediction.acceptedIds].sort()) !==
        JSON.stringify([...acceptedIds].sort())
    )
      throw new Error("Recorded accepted gold changed");
    return {
      ...prediction,
      id: label.id,
      split: label.split,
      field: label.field,
      expectedId: label.expectedId,
      acceptedIds,
      valid,
      correct,
    };
  });
  return {
    summary: summarize(rows),
    fields: Object.fromEntries(
      ["title", "image", "description"].map((field) => [
        field,
        summarize(rows.filter((row) => row.field === field)),
      ]),
    ),
    target: Object.fromEntries(
      ["positive", "none"].map((target) => [
        target,
        summarize(
          rows.filter(
            (row) => (row.expectedId === "__none__") === (target === "none"),
          ),
        ),
      ]),
    ),
    rows,
  };
}

export function pairedOutcomes(before, after) {
  if (
    new Set(before.rows.map((row) => row.id)).size !== before.rows.length ||
    new Set(after.rows.map((row) => row.id)).size !== after.rows.length
  )
    throw new Error("Duplicate paired prediction ID");
  const right = new Map(after.rows.map((row) => [row.id, row]));
  if (
    right.size !== before.rows.length ||
    before.rows.some((row) => !right.has(row.id))
  )
    throw new Error("Unmatched comparison");
  const transitions = {
    bothCorrect: 0,
    improved: 0,
    regressed: 0,
    bothWrong: 0,
    sameChoice: 0,
    total: before.rows.length,
  };
  for (const left of before.rows) {
    const r = right.get(left.id);
    transitions[
      left.correct
        ? r.correct
          ? "bothCorrect"
          : "regressed"
        : r.correct
          ? "improved"
          : "bothWrong"
    ]++;
    if (left.valid && r.valid && left.chosenId === r.chosenId)
      transitions.sameChoice++;
  }
  return transitions;
}

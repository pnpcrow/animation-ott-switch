// Dataset stratification only. No prediction or candidate content enters selection.
export function sampleDevelopment(cases) {
  const hostname = (row) => {
    const url =
      row.provenance?.url ||
      row.url ||
      row.document?.match(/^URL: (.+)$/m)?.[1];
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  };
  const work = (row) =>
    row.provenance?.work || row.work || row.provenance?.pageId || row.id;
  const selected = [];
  for (const field of ["title", "image", "description"]) {
    for (const none of [false, true]) {
      const pool = cases.filter(
        (row) =>
          row.field === field && (row.expectedId === "__none__") === none,
      );
      if (pool.length < 2)
        throw new Error(
          `Need two development examples for ${field}/${none ? "none" : "positive"}`,
        );
      const first = pool[0];
      const rest = pool.slice(1);
      const second =
        rest.find(
          (row) =>
            hostname(row) !== hostname(first) && work(row) !== work(first),
        ) ||
        rest.find((row) => hostname(row) !== hostname(first)) ||
        rest.find((row) => work(row) !== work(first)) ||
        rest[0];
      selected.push(first, second);
    }
  }
  if (new Set(selected.map((row) => row.id)).size !== 12)
    throw new Error("Development IDs must be unique");
  return {
    policy:
      "Fixed dataset order: two rows per field × positive/none. Second prefers a different hostname AND work, then hostname, then work, then next row. No model outputs used.",
    selectedIds: selected.map((row) => row.id),
    available: cases.length,
    excludedIds: cases
      .filter((row) => !selected.includes(row))
      .map((row) => row.id),
    strata: selected.map((row) => ({
      id: row.id,
      field: row.field,
      targetClass: row.expectedId === "__none__" ? "none" : "positive",
      hostname: hostname(row),
      work: work(row),
    })),
  };
}

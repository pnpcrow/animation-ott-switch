export function diagnosticSummary(rows) {
  const range = (values) => {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    return ordered.length
      ? {
          min: ordered[0],
          max: ordered.at(-1),
          median: ordered[Math.floor(ordered.length / 2)],
        }
      : null;
  };
  const withoutDescriptions = (value) => {
    if (Array.isArray(value)) return value.map(withoutDescriptions);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "description" ? "" : withoutDescriptions(item),
        ]),
      );
    return value;
  };
  const grouped = (kind) =>
    rows.filter(
      (row) => (row.expectedId === "__none__" ? "none" : "positive") === kind,
    );
  const slice = (selected) => ({
    total: selected.length,
    finalCorrect: selected.filter((row) => row.valid && row.correct).length,
    validFinal: selected.filter((row) => row.valid).length,
    concreteSelections: selected.filter(
      (row) => row.valid && row.chosenId !== "__none__",
    ).length,
    singleProposalCount: selected.filter(
      (row) => typeof (row.chosenId || row.suppressedId) === "string",
    ).length,
    singleProposalCorrect: selected.filter((row) =>
      (row.acceptedIds || [row.expectedId]).includes(
        row.chosenId || row.suppressedId,
      ),
    ).length,
    suppressedWithObservedId: selected.filter(
      (row) => !row.chosenId && row.suppressedId,
    ).length,
  });
  const size = rows.map((row) => row.inputSize).filter(Boolean);
  const serializedRequests = rows
    .filter(
      (row) => row.request?.tools && typeof row.request?.input === "string",
    )
    .map((row) =>
      JSON.stringify({ tools: row.request.tools, input: row.request.input }),
    );
  return {
    positive: slice(grouped("positive")),
    none: slice(grouped("none")),
    input: {
      count: size.length,
      maxChars: Math.max(0, ...size.map((s) => s.chars || 0)),
      maxUtf8Bytes: Math.max(0, ...size.map((s) => s.utf8Bytes || 0)),
      serializedRequestChars: range(
        serializedRequests.map((request) => [...request].length),
      ),
      serializedRequestUtf8Bytes: range(
        serializedRequests.map((request) => Buffer.byteLength(request)),
      ),
      toolJsonChars: range(size.map((s) => s.toolChars)),
      inputTextChars: range(size.map((s) => s.inputChars)),
      toolSchemaWithoutDescriptionsChars: range(
        rows
          .filter((row) => row.request?.tools)
          .map(
            (row) =>
              [...JSON.stringify(withoutDescriptions(row.request.tools))]
                .length,
          ),
      ),
      overTarget1800: size.filter((s) => s.chars > 1800).length,
      tiers: Object.fromEntries(
        [...new Set(size.map((s) => s.textTier))].map((t) => [
          t,
          size.filter((s) => s.textTier === t).length,
        ]),
      ),
    },
    note: "Single proposals include a valid emitted ID or a unique observed suppressed ID. They remain an engine diagnostic, never automatically promoted to final choices or pure-model logits. Positive and none strata must be read separately. Budget chars/bytes sum serialized tools JSON and plain input text, matching the two native ABI string arguments. serializedRequest measures the full {tools,input} JSON wrapper separately. Tool schema overhead is serialized tool JSON with description values emptied; it includes tool names, property keys and enum values, not native prompt tokens.",
  };
}

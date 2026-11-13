import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const clip = (s, max) => Array.from(s).slice(0, max).join("");
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
export function compactOption(option, field) {
  if (option.id === "__none__") return { ...option };
  const match = option.text.match(
    /^value=("(?:\\.|[^"\\])*"); (.*?) @([^\s]+) ([^;]+)(?:; (.*))?$/s,
  );
  if (!match)
    throw new Error(`Not a frozen generic DOM candidate: ${option.id}`);
  const value = clip(decode(JSON.parse(match[1])), field === "title" ? 80 : 60);
  // Keep only tag and observed semantic attributes; discard CSS names entirely.
  const ancestry = match[2]
    .split(">")
    .map(
      (segment) =>
        segment.match(/^[a-z][a-z0-9]*(?:\[[^\]]*\])*/i)?.[0] || "element",
    )
    .join(">");
  const context = match[5] || "";
  const previous = context.match(/^prev=(.*?)(?: next=|$)/)?.[1];
  const next = context.match(/(?:^| )next=(.*)$/)?.[1];
  const siblings = [
    previous && `prev=${clip(previous, 16)}`,
    next && `next=${clip(next, 16)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: option.id,
    text: `value=${JSON.stringify(value)}; ${ancestry} @${match[3]} ${match[4]}${siblings ? `; ${siblings}` : ""}`,
  };
}
export function compactCase(row) {
  return {
    ...row,
    id: `${row.id}::compact`,
    cohort: "compact-input-sensitivity",
    independentSample: false,
    provenance: {
      ...row.provenance,
      kind: "compact-input-sensitivity",
      baseCaseId: row.id,
      transform: "remove-css-limit-value-and-neighbor-text",
    },
    document: clip(decode(row.document), 240),
    options: row.options.map((o) => compactOption(o, row.field)),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(
    await readFile(
      new URL("./data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  const compact = rows.map(compactCase);
  await writeFile(
    new URL("./data/dom-selection-compact.json", import.meta.url),
    JSON.stringify(compact, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      pairedCases: compact.length,
      holdout: compact.filter((c) => c.split === "holdout").length,
      maxInputChars: Math.max(
        ...compact.map(
          (c) =>
            [c.document, c.question, ...c.options.map((o) => o.text)].join("\n")
              .length,
        ),
      ),
    }),
  );
}

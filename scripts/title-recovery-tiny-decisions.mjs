import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

export async function loadTitleNormalizer() {
  const source = await readFile(
    new URL("../src/providers/identity.ts", import.meta.url),
    "utf8",
  );
  const compiled = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const implementation = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`
  );
  return {
    ...implementation,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  };
}

export function measureTitleRecovery(raw, target, snapshot, normalizer) {
  if (target.field !== "title") throw new Error("Title cases only");
  const selectedId = raw.chosenId ?? raw.selectedId ?? null;
  const option = target.options.find((o) => o.id === selectedId);
  const valid = !raw.error && raw.valid !== false && !!option;
  const candidate = valid
    ? snapshot.fields.title.find((c) => c.id === selectedId)
    : null;
  const provider = normalizer.detectProvider(snapshot.pageUrl);
  const node =
    candidate?.nodes.find((n) => !n.hidden && !n.navigation) ||
    candidate?.nodes[0];
  const source =
    node?.tag === "meta" || node?.tag === "title" ? "metadata" : "title";
  // No references/aliases are supplied: reference gold can never repair the prediction.
  const clean = (value) =>
    provider
      ? normalizer.cleanPageTitle(value, provider, source, [])
      : normalizer.cleanTitle(value);
  const recovered = candidate ? clean(candidate.value) : "";
  const visibleMatch = option?.text.match(/^value=("(?:\\.|[^"\\])*")/);
  const visibleValue = visibleMatch ? JSON.parse(visibleMatch[1]) : "";
  const visibleRecovered = visibleValue ? clean(visibleValue) : "";
  const isPositive = target.expectedId !== "__none__";
  const expected = isPositive
    ? snapshot.fields.title.find((c) => c.id === target.expectedId)?.value
    : null;
  if (isPositive && !expected)
    throw new Error(`Missing frozen positive title ${target.id}`);
  // Gold is read only for equality after prediction processing; it is never an input to cleaning.
  const normalizedExpected = expected
    ? normalizer.normalizeTitle(expected)
    : null;
  const equal = (value) =>
    !!value &&
    normalizer.isWorkTitle(value) &&
    !!normalizedExpected &&
    normalizer.normalizeTitle(value) === normalizedExpected;
  const elementCorrect =
    valid && (target.acceptedIds || [target.expectedId]).includes(selectedId);
  return {
    id: target.id,
    split: target.split,
    template: raw.template || "baseline",
    targetClass: isPositive ? "positive" : "none",
    selectedId,
    valid,
    elementCorrect,
    error: raw.error || null,
    selectedValue: candidate?.value || null,
    normalizerSource: source,
    recoveredTitle: recovered || null,
    visibleCandidateValue: visibleValue || null,
    visibleRecoveredTitle: visibleRecovered || null,
    frozenExpectedTitle: expected,
    rawTitleRecoverable: isPositive ? equal(recovered) : null,
    visibleTitleRecoverable: isPositive ? equal(visibleRecovered) : null,
    rescuedElementMistake: isPositive && !elementCorrect && equal(recovered),
    nonEmptyWorkLikeOutputOnAbsentDetail:
      !isPositive && !!recovered && normalizer.isWorkTitle(recovered),
  };
}
export function recoverySummary(rows) {
  const positives = rows.filter((r) => r.targetClass === "positive"),
    none = rows.filter((r) => r.targetClass === "none");
  return {
    positive: {
      n: positives.length,
      elementCorrect: positives.filter((r) => r.elementCorrect).length,
      rawTitleRecoverable: positives.filter((r) => r.rawTitleRecoverable)
        .length,
      visibleTitleRecoverable: positives.filter(
        (r) => r.visibleTitleRecoverable,
      ).length,
      rescuedElementMistakes: positives.filter((r) => r.rescuedElementMistake)
        .length,
      errorsOrInvalid: positives.filter((r) => !r.valid).length,
    },
    noOpenWork: {
      n: none.length,
      correctAbstentions: none.filter((r) => r.elementCorrect).length,
      incorrectSelections: none.filter(
        (r) => r.valid && r.selectedId !== "__none__",
      ).length,
      workLikeOutputAfterCleaning: none.filter(
        (r) => r.nonEmptyWorkLikeOutputOnAbsentDetail,
      ).length,
      note: "No recovery credit is defined for absent-detail cases; a plausible cleaned string cannot establish an open work.",
    },
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
      "--reports=raw1.json,raw2.json --output=result.json required",
    );
  const cases = JSON.parse(
    await readFile(
      new URL("../eval/tiny-decision/data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshots = JSON.parse(
    await readFile(
      new URL("../eval/tiny-decision/data/observations.json", import.meta.url),
      "utf8",
    ),
  );
  const normalizer = await loadTitleNormalizer(),
    reports = [];
  for (const path of args.reports.split(",")) {
    const input = await readFile(path, "utf8"),
      report = JSON.parse(input);
    if (!report.finishedAt && args["allow-partial"] !== "true")
      throw new Error(
        `Incomplete report ${path}; explicitly pass --allow-partial=true for a provisional snapshot`,
      );
    if (report.error) throw new Error(`Report-level failure: ${path}`);
    const rawRows =
      report.results ||
      report.rows ||
      report.runs?.flatMap((run) =>
        run.rows.map((r) => ({ ...r, template: r.template || run.template })),
      );
    if (!rawRows) throw new Error(`Raw rows required: ${path}`);
    const rows = rawRows.flatMap((raw) => {
      const target = cases.find((c) => c.id === raw.id && c.field === "title");
      return target
        ? [
            measureTitleRecovery(
              raw,
              target,
              snapshots.find((s) => s.id === target.provenance.pageId),
              normalizer,
            ),
          ]
        : [];
    });
    const groups = [
      ...new Set(rows.map((r) => `${r.split}/${r.template}`)),
    ].map((key) => {
      const selected = rows.filter((r) => `${r.split}/${r.template}` === key);
      return { key, summary: recoverySummary(selected), rows: selected };
    });
    reports.push({
      path,
      model: report.model || report.export?.model,
      runtime: report.runtime || report.engine,
      sourceSha256: createHash("sha256").update(input).digest("hex"),
      provisional: !report.finishedAt,
      finishedAt: report.finishedAt || null,
      sourceRows: rawRows.length,
      titleRows: rows.length,
      groups,
    });
  }
  const output = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    normalizer: {
      source: "src/providers/identity.ts",
      sha256: normalizer.sourceSha256,
      functions: [
        "detectProvider",
        "cleanPageTitle (empty references)",
        "cleanTitle",
        "normalizeTitle",
        "isWorkTitle",
      ],
    },
    method:
      "Post-hoc title recovery only. Original element-selection gold/scores unchanged. Raw uses the selected frozen DOM value; visible uses only the bounded value the model saw. Equality targets come only from frozen positive title nodes. Not an end-to-end retrieval, identity or availability score.",
    reports,
  };
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(output, null, 2) + "\n");
  console.log(
    JSON.stringify(
      reports.map((r) => ({
        path: r.path,
        provisional: r.provisional,
        groups: r.groups.map((g) => ({ key: g.key, summary: g.summary })),
      })),
    ),
  );
}

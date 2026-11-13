import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadTitleNormalizer } from "./title-recovery-tiny-decisions.mjs";
import { featurePack } from "../eval/tiny-decision/v2/features.mjs";
import { scorePinned } from "../eval/tiny-decision/v2/analysis.mjs";

const groupModes = {
  selected: "v2-feature-pack",
  enriched: "v2-feature-pack",
  unchanged: "v1-option-text",
  baseline: "v1-option-text",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");

// Reconstruct only the chosen value. Other headings/aliases cannot repair it.
export function visibleTitleValue(target, prediction, mode) {
  const option = target.options.find(
    (option) => option.id === prediction.chosenId,
  );
  if (
    !option ||
    option.id === "__none__" ||
    !prediction.valid ||
    prediction.error
  )
    return "";
  if (mode === "v2-feature-pack") {
    if (![96, 72, 48, 32].includes(prediction.textLimit))
      throw new Error(`Missing actual v2 text tier for ${target.id}`);
    return featurePack(target, {
      textLimit: prediction.textLimit,
    }).candidates.find((candidate) => candidate.id === option.id).value;
  }
  if (mode === "v1-option-text") {
    const match = option.text.match(/^value=("(?:\\.|[^"\\])*")/);
    if (!match)
      throw new Error(`Missing v1 visible title value for ${target.id}`);
    return JSON.parse(match[1]);
  }
  throw new Error("Unknown title visibility mode");
}

export function measureV2TitleRecovery(prediction, target, normalizer, mode) {
  if (target.field !== "title") throw new Error("Title cases only");
  // Presented frozen title evidence is this auxiliary analysis's raw snapshot.
  const snapshot = {
    pageUrl: target.pageEvidence?.url,
    fields: {
      title: target.options
        .filter((option) => option.evidence)
        .map((option) => option.evidence),
    },
  };
  const selectedId = prediction.chosenId ?? null;
  const option = target.options.find((option) => option.id === selectedId);
  const valid = prediction.valid === true && !prediction.error && !!option;
  const candidate =
    valid && selectedId !== "__none__"
      ? snapshot.fields.title.find((candidate) => candidate.id === selectedId)
      : null;
  if (valid && selectedId !== "__none__" && !candidate)
    throw new Error("Missing selected frozen title evidence");
  const node =
    candidate?.nodes.find((node) => !node.hidden && !node.navigation) ||
    candidate?.nodes[0];
  const source =
    node?.tag === "meta" || node?.tag === "title" ? "metadata" : "title";
  const provider = normalizer.detectProvider(snapshot.pageUrl);
  const clean = (value) =>
    value
      ? provider
        ? normalizer.cleanPageTitle(value, provider, source, [])
        : normalizer.cleanTitle(value)
      : "";
  const rawValue = candidate?.value || "";
  const visibleValue = visibleTitleValue(
    target,
    { ...prediction, valid },
    mode,
  );
  const rawCleaned = clean(rawValue),
    visibleCleaned = clean(visibleValue);
  // Gold is first read after candidate processing; it only supplies equality.
  const positive = target.expectedId !== "__none__";
  const expected = positive
    ? snapshot.fields.title.find(
        (candidate) => candidate.id === target.expectedId,
      )?.value
    : null;
  if (positive && !expected)
    throw new Error(`Missing frozen title equality target ${target.id}`);
  const normalizedExpected = expected
    ? normalizer.normalizeTitle(expected)
    : null;
  const equivalent = (value) =>
    !!value &&
    normalizer.isWorkTitle(value) &&
    !!normalizedExpected &&
    normalizer.normalizeTitle(value) === normalizedExpected;
  const workLike = (value) => !!value && normalizer.isWorkTitle(value);
  const elementCorrect =
    valid && (target.acceptedIds || [target.expectedId]).includes(selectedId);
  if (prediction.correct !== undefined && prediction.correct !== elementCorrect)
    throw new Error("Element score changed during auxiliary title analysis");
  return {
    id: target.id,
    split: target.split,
    template: prediction.template || "baseline",
    targetClass: positive ? "positive" : "none",
    selectedId,
    valid,
    error: prediction.error || null,
    elementCorrect,
    visibleMode: mode,
    textLimit:
      mode === "v2-feature-pack" ? (prediction.textLimit ?? null) : null,
    normalizerSource: source,
    provider,
    rawValue: rawValue || null,
    rawCleaned: rawCleaned || null,
    visibleValue: visibleValue || null,
    visibleCleaned: visibleCleaned || null,
    frozenExpectedTitle: expected,
    rawNormalizedCorrect: positive ? equivalent(rawValue) : null,
    rawCleanedCorrect: positive ? equivalent(rawCleaned) : null,
    visibleNormalizedCorrect: positive ? equivalent(visibleValue) : null,
    visibleCleanedCorrect: positive ? equivalent(visibleCleaned) : null,
    rescuedRawElementMistake:
      positive && !elementCorrect && equivalent(rawCleaned),
    rescuedVisibleElementMistake:
      positive && !elementCorrect && equivalent(visibleCleaned),
    rawWorkLikeOutputOnAbsentDetail: !positive && workLike(rawCleaned),
    visibleWorkLikeOutputOnAbsentDetail: !positive && workLike(visibleCleaned),
  };
}

export function summarizeV2TitleRecovery(rows) {
  const positives = rows.filter((row) => row.targetClass === "positive"),
    absent = rows.filter((row) => row.targetClass === "none");
  const metric = (key) => ({
    correct: positives.filter((row) => row[key]).length,
    attempted: positives.length,
    accuracy: positives.length
      ? positives.filter((row) => row[key]).length / positives.length
      : null,
  });
  return {
    positive: {
      n: positives.length,
      element: metric("elementCorrect"),
      rawNormalized: metric("rawNormalizedCorrect"),
      rawCleaned: metric("rawCleanedCorrect"),
      visibleNormalized: metric("visibleNormalizedCorrect"),
      visibleCleaned: metric("visibleCleanedCorrect"),
      rescuedRawElementMistakes: positives.filter(
        (row) => row.rescuedRawElementMistake,
      ).length,
      rescuedVisibleElementMistakes: positives.filter(
        (row) => row.rescuedVisibleElementMistake,
      ).length,
      errorsOrInvalid: positives.filter((row) => !row.valid).length,
    },
    noOpenWork: {
      n: absent.length,
      correctAbstentions: absent.filter((row) => row.elementCorrect).length,
      incorrectSelections: absent.filter(
        (row) => row.valid && row.selectedId !== "__none__",
      ).length,
      errorsOrInvalid: absent.filter((row) => !row.valid).length,
      rawWorkLikeOutputAfterCleaning: absent.filter(
        (row) => row.rawWorkLikeOutputOnAbsentDetail,
      ).length,
      visibleWorkLikeOutputAfterCleaning: absent.filter(
        (row) => row.visibleWorkLikeOutputOnAbsentDetail,
      ).length,
      note: "Absent-detail cases receive no recovery credit. A plausible string does not establish an opened work.",
    },
  };
}

export function analyzeTitleGroups(inputs, labels, comparison, normalizer) {
  const byId = new Map(labels.map((label) => [label.id, label]));
  if (byId.size !== labels.length || labels.length !== inputs.length)
    throw new Error("Unique complete scoring labels required");
  const corpus = inputs.map((input) => {
    const label = byId.get(input.id);
    if (!label?.expectedId) throw new Error("Missing scoring label");
    return {
      ...input,
      expectedId: label.expectedId,
      acceptedIds: label.acceptedIds || [label.expectedId],
    };
  });
  return Object.fromEntries(
    Object.entries(groupModes).map(([name, mode]) => {
      if (!comparison.groups?.[name]?.rows)
        throw new Error(`Missing completed comparison group ${name}`);
      const pinned = scorePinned(corpus, comparison.groups[name].rows);
      const rows = pinned.rows
        .filter((row) => row.field === "title")
        .map((prediction) =>
          measureV2TitleRecovery(
            prediction,
            corpus.find((target) => target.id === prediction.id),
            normalizer,
            mode,
          ),
        );
      return [
        name,
        { visibleMode: mode, summary: summarizeV2TitleRecovery(rows), rows },
      ];
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const i = arg.indexOf("=");
      return [arg.slice(2, i), arg.slice(i + 1)];
    }),
  );
  const root = "eval/tiny-decision/v2/";
  const comparisonPath =
    args.comparison || root + "reports/jev-comparison.json";
  const output = args.output || root + "reports/title-recovery.json";
  const freeze = JSON.parse(
    await readFile(root + "global-freeze.json", "utf8"),
  );
  if (!freeze.lockedAt || !freeze.sources || !freeze.selections?.jev)
    throw new Error("Global development freeze required");
  for (const [path, expected] of Object.entries(freeze.sources))
    if (digest(await readFile(path)) !== expected)
      throw new Error(`Frozen source changed: ${path}`);
  const selectionBytes = await readFile(freeze.selections.jev.path);
  if (digest(selectionBytes) !== freeze.selections.jev.sha256)
    throw new Error("Frozen Jev selection changed");
  const comparisonBytes = await readFile(comparisonPath);
  const comparison = JSON.parse(comparisonBytes);
  if (
    comparison.globalFreezeAt !== freeze.lockedAt ||
    comparison.template !== JSON.parse(selectionBytes).selectedTemplates[0]
  )
    throw new Error("Comparison does not belong to the frozen selection");
  const inputBytes = await readFile(root + "data/holdout-inputs.json"),
    labelBytes = await readFile(root + "data/holdout-labels.json");
  for (const [name, bytes] of [
    ["data/holdout-inputs.json", inputBytes],
    ["data/holdout-labels.json", labelBytes],
  ])
    if (comparison.sourceHashes?.[name] !== digest(bytes))
      throw new Error("Comparison dataset hash changed");
  const normalizer = await loadTitleNormalizer();
  const groups = analyzeTitleGroups(
    JSON.parse(inputBytes),
    JSON.parse(labelBytes),
    comparison,
    normalizer,
  );
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    globalFreezeAt: freeze.lockedAt,
    postHoc: true,
    influencesModelSelection: false,
    originalElementScoresUnchanged: true,
    comparison: { path: comparisonPath, sha256: digest(comparisonBytes) },
    normalizer: {
      source: "src/providers/identity.ts",
      sha256: normalizer.sourceSha256,
      reusedLoader:
        "scripts/title-recovery-tiny-decisions.mjs#loadTitleNormalizer",
      references: [],
      configurationChanges: false,
    },
    method:
      "Post-hoc auxiliary title equality only. Raw uses the selected frozen input evidence value. V2 visible uses featurePack at the recorded textLimit; unchanged v1 and generic baseline use their actual option.text value. Each passes production isWorkTitle and normalizeTitle equality, and is separately evaluated after production provider/source-aware cleanPageTitle with empty references. normalizeTitle itself already includes generic cleanTitle. Gold is used only for normalized equality after candidate processing. No other page text, aliases, or gold references repair a prediction. Reverse diagnostics are excluded. No retrieval, availability or navigation claim.",
    groups,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      output,
      summaries: Object.fromEntries(
        Object.entries(groups).map(([name, group]) => [name, group.summary]),
      ),
    }),
  );
}

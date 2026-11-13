import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// Frozen generic rules. No provider/work names, CSS classes, annotated labels or model calls.
export function chooseHeuristic(row, snapshot) {
  const path = new URL(snapshot.pageUrl).pathname;
  const blocked =
    /access denied|security check|잠시만 기다리십시오|보안 확인/i.test(
      snapshot.documentTitle,
    );
  if (blocked || /(?:^|\/)(?:search|login|signin)(?:\/|$)/i.test(path))
    return "__none__";
  const ids = new Set(row.options.map((o) => o.id));
  const candidates = snapshot.fields[row.field].filter((c) => ids.has(c.id));
  const score = (candidate) => {
    if (row.field === "description" && /^\{[^}]+\}$/.test(candidate.value))
      return -Infinity;
    return Math.max(
      ...candidate.nodes.map((node) => {
        let result = node.navigation ? -90 : 0;
        const metadata = node.tag === "meta" || node.tag === "title";
        if (node.hidden && !metadata) result -= 45;
        const ancestry = [node, ...(node.parents || [])];
        if (ancestry.some((n) => n.tag === "dialog" || n.role === "dialog"))
          result += 12;
        if (row.field === "title") {
          result +=
            node.tag === "h1"
              ? 65
              : node.attribute === "alt"
                ? 42
                : node.tag === "h2"
                  ? 20
                  : node.attribute === "og:title"
                    ? 30
                    : 10;
          if (ancestry.some((n) => n.tag === "h1")) result += 20;
          if (/\d+\s*(?:화|회)|^\d+\./.test(candidate.value)) result -= 25;
        } else if (row.field === "image") {
          result +=
            node.attribute === "og:image"
              ? 48
              : node.attribute === "twitter:image"
                ? 42
                : 20;
          if (/(?:logo|favicon|icon)/i.test(candidate.value)) result -= 70;
          if (ancestry.some((n) => n.tag === "h1")) result -= 35;
        } else {
          result +=
            node.tag === "meta"
              ? 30
              : node.attribute === "aria-label"
                ? 42
                : 35;
          if (ancestry.some((n) => n.tag === "li" || n.tag === "a"))
            result -= 25;
          if (
            /^\d+\.|\d+\s*(?:화|회|분)/.test(node.previous || "") ||
            /\d+\s*분/.test(node.next || "")
          )
            result -= 18;
          if (
            /합법적으로|무제한|스트리밍|구독|Copyright|아직 준비되지/.test(
              candidate.value,
            )
          )
            result -= 50;
          if (candidate.value.length < 35) result -= 45;
        }
        return result;
      }),
    );
  };
  const ranked = candidates
    .map((c) => ({ id: c.id, score: score(c) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].id : "__none__";
}
export function evaluateBaseline(rows, snapshots) {
  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const results = rows.map((row) => {
    const start = performance.now();
    const selectedId = chooseHeuristic(row, byId.get(row.provenance.pageId));
    return {
      id: row.id,
      split: row.split,
      field: row.field,
      selectedId,
      expectedId: row.expectedId,
      acceptedIds: row.acceptedIds,
      correct: (row.acceptedIds || [row.expectedId]).includes(selectedId),
      latencyMs: performance.now() - start,
      multiCandidate: row.quality.atLeastThreeCandidates,
    };
  });
  const summarize = (selected) => ({
    n: selected.length,
    correct: selected.filter((r) => r.correct).length,
    accuracy: selected.length
      ? selected.filter((r) => r.correct).length / selected.length
      : null,
    meanLatencyMs:
      selected.reduce((n, r) => n + r.latencyMs, 0) /
      Math.max(1, selected.length),
  });
  return {
    model: "generic-dom-heuristic",
    rulesFrozen: "before first scoring",
    summary: Object.fromEntries(
      ["calibration", "holdout"].map((split) => [
        split,
        summarize(results.filter((r) => r.split === split)),
      ]),
    ),
    multiCandidate: summarize(results.filter((r) => r.multiCandidate)),
    results,
  };
}
// Mechanical projection of the same rules onto exactly the compact model input.
// No raw snapshots or annotations are read by this prediction function.
export function chooseCompactHeuristic(row) {
  const pageUrl =
    row.document.match(/^URL: (.+)$/m)?.[1] || "https://invalid.example/";
  const documentTitle =
    row.document.match(/^Document title: (.+)$/m)?.[1] || "";
  const tagPart = (part) => ({
    tag: part.match(/^([a-z][a-z0-9]*)/i)?.[1] || "div",
    role: part.match(/\[role=([^\]]+)\]/)?.[1],
  });
  const candidates = row.options
    .filter((o) => o.id !== "__none__")
    .map((option) => {
      const match = option.text.match(/^value=("(?:\\.|[^"\\])*"); (.*)$/s);
      if (!match)
        throw new Error(
          `Unrecognized compact candidate ${row.id}:${option.id}`,
        );
      const value = JSON.parse(match[1]);
      const structure = match[2].split(" @")[0].split(">");
      const node = {
        ...tagPart(structure.at(-1)),
        parents: structure.slice(0, -1).reverse().map(tagPart),
        attribute: option.text.match(/ @([^\s]+)/)?.[1],
        hidden: / (?:hidden|head-metadata)(?:;|$| navigation)/.test(
          option.text,
        ),
        navigation: / navigation(?:;|$)/.test(option.text),
        previous: option.text.match(/; prev=(.*?)(?: next=|$)/)?.[1],
        next: option.text.match(/(?:; | )next=(.*)$/)?.[1],
      };
      return { id: option.id, value, nodes: [node] };
    });
  return chooseHeuristic(row, {
    pageUrl,
    documentTitle,
    fields: { [row.field]: candidates },
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(
    await readFile(
      new URL("./data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshots = JSON.parse(
    await readFile(
      new URL("./data/observations.json", import.meta.url),
      "utf8",
    ),
  );
  const report = evaluateBaseline(rows, snapshots);
  await mkdir(new URL("./reports/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("./reports/generic-baseline.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  const compactResults = rows.map((row) => {
    const start = performance.now();
    const selectedId = chooseCompactHeuristic(row);
    return {
      id: row.id,
      split: row.split,
      selectedId,
      expectedId: row.expectedId,
      acceptedIds: row.acceptedIds,
      correct: (row.acceptedIds || [row.expectedId]).includes(selectedId),
      latencyMs: performance.now() - start,
    };
  });
  const compact = {
    model: "generic-dom-heuristic-compact",
    information:
      "Only document/options.text, same input as decision models; mechanical projection of frozen full-snapshot rules, no later rule tuning",
    summary: Object.fromEntries(
      ["calibration", "holdout"].map((split) => {
        const selected = compactResults.filter((r) => r.split === split);
        return [
          split,
          {
            n: selected.length,
            correct: selected.filter((r) => r.correct).length,
            accuracy:
              selected.filter((r) => r.correct).length / selected.length,
            meanLatencyMs:
              selected.reduce((n, r) => n + r.latencyMs, 0) / selected.length,
          },
        ];
      }),
    ),
    results: compactResults,
  };
  await writeFile(
    new URL("./reports/generic-baseline-compact.json", import.meta.url),
    JSON.stringify(compact, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      fullSnapshot: report.summary,
      compact: compact.summary,
      multiCandidate: report.multiCandidate,
    }),
  );
}

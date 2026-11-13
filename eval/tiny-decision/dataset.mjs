import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const clip = (value, limit) => String(value || "").slice(0, limit);
const calibrationWorks = new Set(["witch", "frieren", "apothecary", "nia"]);
const questions = {
  title:
    "Select the element giving the clean series/movie title of the currently opened work detail. Exclude episode names/numbers, service slogans, search-result or recommendation titles. Return none if no work detail is open or evidence is insufficient.",
  image:
    "Select representative artwork for the currently opened series/movie: official artwork metadata or its main poster/backdrop. Exclude site/title logos, age icons, episode and recommendation thumbnails. Return none when no work detail or artwork evidence exists.",
  description:
    "Select the series/movie plot synopsis of the currently opened work detail. Metadata or visible synopsis is valid; exclude episode plots, service marketing, placeholders, legal text and recommendations. Return none when the work or synopsis is absent.",
};
function label(node) {
  return (
    node.tag +
    (node.role ? `[role=${node.role}]` : "") +
    (node["aria-label"] ? `[label=${clip(node["aria-label"], 25)}]` : "") +
    (node.class ? `.${clip(node.class, 48)}` : "")
  );
}
function nodeText(node) {
  const parent = (node.parents || [])
    .slice(0, 3)
    .reverse()
    .map(label)
    .join(">");
  return `${parent}>${label(node)} @${node.attribute} ${node.tag === "meta" || node.tag === "title" ? "head-metadata" : node.hidden ? "hidden" : "visible"}${node.navigation ? " navigation" : ""}`;
}
export function optionText(candidate, field) {
  let value = candidate.value;
  if (field === "image") {
    const u = new URL(value);
    value =
      u.hostname +
      u.pathname.slice(0, 55) +
      (u.pathname.length > 55 ? "…" + u.pathname.slice(-35) : "");
  }
  // Include the most useful observed node without inspecting labels: prefer visible body evidence.
  const node =
    candidate.nodes.find((n) => !n.hidden && !n.navigation) ||
    candidate.nodes[0];
  const siblings = [
    node.previous && `prev=${clip(node.previous, 32)}`,
    node.next && `next=${clip(node.next, 32)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return `value=${JSON.stringify(clip(value, field === "description" ? 135 : 105))}; ${nodeText(node)}${siblings ? "; " + siblings : ""}`;
}
export function shuffleOptions(options, seed) {
  return [...options].sort((a, b) =>
    createHash("sha256")
      .update(seed + a.id)
      .digest("hex")
      .localeCompare(
        createHash("sha256")
          .update(seed + b.id)
          .digest("hex"),
      ),
  );
}
export function buildDataset(snapshots, annotations) {
  return snapshots.flatMap((page) =>
    Object.keys(questions).map((field) => {
      const gold = annotations.pages[page.id];
      if (!gold) throw new Error(`Missing annotations for ${page.id}`);
      // Fixed generic cap is applied before gold lookup; missing gold is reported, never inserted.
      const pool = page.fields[field].slice(0, 8);
      const id = `${page.id}-${field}`;
      const expectedId = gold[field];
      const acceptedIds = gold.accepted?.[field] || [expectedId];
      const document = `URL: ${page.pageUrl}\nDocument title: ${clip(page.documentTitle, 140)}\nCandidates are bounded observations from this same live DOM; head metadata may be hidden normally. Ancestors use >; adjacent text is local context.`;
      return {
        id,
        split: calibrationWorks.has(page.work) ? "calibration" : "holdout",
        provenance: {
          kind: "real-public-dom",
          pageId: page.id,
          work: page.work,
          url: page.url,
          capturedAt: page.capturedAt,
          htmlSha256: page.htmlSha256,
        },
        field,
        scenario: page.scenarios,
        document,
        question: questions[field],
        options: shuffleOptions(
          [
            ...pool.map((c) => ({ id: c.id, text: optionText(c, field) })),
            {
              id: "__none__",
              text: "None: no suitable current-work element in the evidence.",
            },
          ],
          id,
        ),
        expectedId,
        acceptedIds,
        quality: {
          observedCandidates: page.fields[field].length,
          presentedCandidates: pool.length,
          atLeastThreeCandidates: pool.length >= 3,
          expectedOutsidePool:
            expectedId !== "__none__" && !pool.some((c) => c.id === expectedId),
        },
      };
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshots = JSON.parse(
    await readFile(
      new URL("./data/observations.json", import.meta.url),
      "utf8",
    ),
  );
  const annotations = JSON.parse(
    await readFile(new URL("./data/annotations.json", import.meta.url), "utf8"),
  );
  const cases = buildDataset(snapshots, annotations);
  await writeFile(
    new URL("./data/dom-selection.json", import.meta.url),
    JSON.stringify(cases, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      cases: cases.length,
      calibration: cases.filter((x) => x.split === "calibration").length,
      holdout: cases.filter((x) => x.split === "holdout").length,
      multiCandidate: cases.filter((x) => x.quality.atLeastThreeCandidates)
        .length,
      outsidePool: cases
        .filter((x) => x.quality.expectedOutsidePool)
        .map((x) => x.id),
      maxInputChars: Math.max(
        ...cases.map(
          (c) =>
            c.document.length +
            c.question.length +
            c.options.reduce((n, o) => n + o.text.length, 0),
        ),
      ),
    }),
  );
}

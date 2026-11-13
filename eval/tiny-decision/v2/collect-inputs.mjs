import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { optionText, shuffleOptions } from "../dataset.mjs";

export const questions = {
  title:
    "Select the element giving the clean series/movie title of the currently opened work detail. Exclude episode names/numbers, service slogans, search-result or recommendation titles. Return none if no work detail is open or evidence is insufficient.",
  image:
    "Select representative artwork for the currently opened series/movie: official artwork metadata or its main poster/backdrop. Exclude site/title logos, age icons, episode and recommendation thumbnails. Return none when no work detail or artwork evidence exists.",
  description:
    "Select the series/movie plot synopsis of the currently opened work detail. Metadata or visible synopsis is valid; exclude episode plots, service marketing, placeholders, legal text and recommendations. Return none when the work or synopsis is absent.",
};

// Candidate cap and order cannot inspect annotations: this function has no label input.
export function buildInputs(snapshots) {
  return snapshots.flatMap((page) =>
    Object.entries(questions).map(([field, question]) => {
      const id = `${page.id}-${field}`;
      const pool = page.fields[field].slice(0, 8);
      return {
        id,
        split: "holdout",
        field,
        question,
        document: `URL: ${page.pageUrl}\nDocument title: ${String(page.documentTitle || "").slice(0, 140)}\nCandidates are bounded observations from this same live DOM; head metadata may be hidden normally. Ancestors use >; adjacent text is local context.`,
        pageEvidence: page.pageEvidence,
        options: shuffleOptions(
          [
            ...pool.map((candidate) => ({
              id: candidate.id,
              text: optionText(candidate, field),
              evidence: candidate,
            })),
            {
              id: "__none__",
              text: "None: no suitable current-work element in the evidence.",
              evidence: null,
            },
          ],
          id,
        ),
      };
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshots = JSON.parse(
    await readFile(
      new URL("./data/holdout-observations.json", import.meta.url),
      "utf8",
    ),
  );
  const rows = buildInputs(snapshots);
  await writeFile(
    new URL("./data/holdout-inputs.json", import.meta.url),
    JSON.stringify(rows, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ cases: rows.length, pages: snapshots.length, cap: 8 }),
  );
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
const source = new URL("../tiny-decision/v2/data/", import.meta.url);
const target = new URL("./data/", import.meta.url);
await mkdir(target, { recursive: true });
for (const kind of ["inputs", "labels", "observations"]) {
  const groups = await Promise.all(["development", "holdout"].map(async split => JSON.parse(await readFile(new URL(`${split}-${kind}.json`, source), "utf8"))));
  const rows = groups.flat().map(row => kind === "observations" ? row : { ...row, split: "development" });
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`Duplicate ${kind} ID`);
  await writeFile(new URL(`development-${kind}.json`, target), JSON.stringify(rows, null, 2) + "\n");
}
console.log("Consolidated 66 previously consumed cases from 22 pages as development; candidates and labels preserved.");

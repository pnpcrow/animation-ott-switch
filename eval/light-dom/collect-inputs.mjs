import { readFile, writeFile } from "node:fs/promises";
import { buildInputs } from "../tiny-decision/v2/collect-inputs.mjs";
const snapshots = JSON.parse(await readFile(new URL("./data/holdout-observations.json", import.meta.url), "utf8"));
const inputs = buildInputs(snapshots);
await writeFile(new URL("./data/holdout-inputs.json", import.meta.url), JSON.stringify(inputs, null, 2) + "\n");
console.log(JSON.stringify({ pages: snapshots.length, cases: inputs.length, candidateCap: 8 }));

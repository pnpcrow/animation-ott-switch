import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : path.endsWith(".test.mjs") ? [path] : [];
  }))).flat().sort();
}
const result = spawnSync(process.execPath, ["--test", ...await collect("eval/dom-adaptation")], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

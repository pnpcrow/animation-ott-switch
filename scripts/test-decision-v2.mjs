import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function tests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? tests(path) : path.endsWith(".test.mjs") ? [path] : [];
  }));
  return nested.flat().sort();
}
const result = spawnSync(process.execPath, ["--test", ...await tests("eval/tiny-decision/v2")], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { verifyProjectIdentity } from "./verify-identity.mjs";
async function collect(dir, prefix = "") {
  let result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory())
      Object.assign(result, await collect(`${dir}/${entry.name}`, key + "/"));
    else result[key] = new Uint8Array(await readFile(`${dir}/${entry.name}`));
  }
  return result;
}
// Inspect both source and the actual built manifest; never zip a stale identity.
const { version } = await verifyProjectIdentity({
  root: process.cwd(),
  includeDist: true,
});
await mkdir("release", { recursive: true });
const path = `release/ott-switch-${version}.zip`;
await writeFile(path, zipSync(await collect("dist"), { level: 9 }));
console.log(path);

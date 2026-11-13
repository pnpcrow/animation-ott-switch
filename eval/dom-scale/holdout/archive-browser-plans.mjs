import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const root = "eval/dom-scale/holdout", directory = root + "/browser-plan-archives";
if (process.argv.includes("--restore")) {
  const manifest = JSON.parse(await readFile(directory + "/manifest.json", "utf8"));
  for (const file of manifest.files) {
    const compressed = await readFile(file.archive), original = gunzipSync(compressed);
    if (hash(compressed) !== file.archiveSha256 || hash(original) !== file.originalSha256 || original.length !== file.originalBytes) throw new Error("Archive integrity failure");
    let existing;
    try { existing = await readFile(file.original); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && hash(existing) !== file.originalSha256) throw new Error("Refuse to replace changed original: " + file.original);
    if (!existing) { await mkdir(dirname(file.original), { recursive: true }); await writeFile(file.original, original); }
  }
  console.log(JSON.stringify({ verifiedAndRestored: manifest.files.length }));
} else {
  await mkdir(directory, { recursive: true });
  const files = [], seen = new Set();
  for (const folder of [root + "/predictions", root + "/supplemental/predictions"]) {
    for (const name of (await readdir(folder)).filter(name => name.endsWith("-browser.json")).sort()) {
      if (seen.has(name)) throw new Error("Duplicate archive name"); seen.add(name);
      const original = `${folder}/${name}`, raw = await readFile(original), compressed = gzipSync(raw, { level: 9 });
      if (!gunzipSync(compressed).equals(raw)) throw new Error("Roundtrip mismatch");
      const archive = `${directory}/${basename(name)}.gz`;
      await writeFile(archive, compressed);
      files.push({ original, archive, originalBytes: raw.length, originalSha256: hash(raw), archiveBytes: compressed.length, archiveSha256: hash(compressed) });
    }
  }
  if (files.length !== 8) throw new Error("Expected four recipes times two batch plans");
  await writeFile(directory + "/manifest.json", JSON.stringify({ schemaVersion: 1, algorithm: "gzip level9; Node writes zero mtime; decompressed bytes preserved exactly", files }, null, 2) + "\n");
  console.log(JSON.stringify({ plans: files.length, originalBytes: files.reduce((n, f) => n + f.originalBytes, 0), archiveBytes: files.reduce((n, f) => n + f.archiveBytes, 0) }));
}

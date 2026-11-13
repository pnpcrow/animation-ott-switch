import { build } from "esbuild";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { zlibSync } from "fflate";
import { verifyProjectIdentity } from "./verify-identity.mjs";

// Fail before touching dist if the registered identity was removed or changed.
await verifyProjectIdentity({ root: process.cwd() });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: false,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};
await Promise.all([
  build({
    ...common,
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: ["src/content/index.tsx"],
    outfile: "dist/content.js",
    format: "iife",
    loader: { ".css": "text" },
  }),
  build({
    ...common,
    entryPoints: ["src/library/main.tsx"],
    outfile: "dist/library.js",
    format: "esm",
  }),
]);

// A small original vector-like arrow mark, encoded as PNG without remote assets.
function crc32(bytes) {
  let c = -1;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(
    crc32(Buffer.concat([name, Buffer.from(data)])),
    8 + data.length,
  );
  return out;
}
await mkdir("dist/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = x / size,
        b = y / size,
        off = y * (size * 4 + 1) + 1 + x * 4;
      const inside = !(
        Math.min(a, 1 - a) < 0.14 &&
        Math.min(b, 1 - b) < 0.14 &&
        Math.hypot(
          Math.max(0, 0.14 - Math.min(a, 1 - a)),
          Math.max(0, 0.14 - Math.min(b, 1 - b)),
        ) > 0.14
      );
      const arrow =
        (b > 0.29 && b < 0.38 && a > 0.22 && a < 0.73) ||
        (Math.abs(a - 0.66) < 0.13 - Math.abs(b - 0.335) && a > 0.59) ||
        (b > 0.62 && b < 0.71 && a > 0.27 && a < 0.78) ||
        (Math.abs(a - 0.34) < 0.13 - Math.abs(b - 0.665) && a < 0.41);
      raw.set(
        arrow ? [20, 23, 25, 255] : [240, 181, 79, inside ? 255 : 0],
        off,
      );
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    `dist/icons/icon-${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", zlibSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
for (const path of [
  "background.js",
  "content.js",
  "library.js",
  "library.css",
  ...Object.values(manifest.icons),
])
  await readFile(`dist/${path}`);
console.log("Chrome extension ready in dist/");

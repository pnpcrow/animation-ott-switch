import { build } from "esbuild";
import { mkdir, cp, readFile } from "node:fs/promises";
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

// Original branded PNG icons are copied from public/icons.
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

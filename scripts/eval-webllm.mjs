import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(".tmp/webllm-eval");
const source = resolve("eval/webllm");
await mkdir(root, { recursive: true });
try {
  await readFile(resolve(source, "node_modules/@mlc-ai/web-llm/package.json"));
} catch {
  throw new Error(
    "선택 평가 도구 설치: npm --prefix eval/webllm ci --ignore-scripts",
  );
}
await build({
  entryPoints: {
    main: resolve(source, "main.mjs"),
    worker: resolve(source, "worker.mjs"),
  },
  outdir: root,
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  logLevel: "info",
});
await Promise.all(
  ["index.html", "style.css"].map((file) =>
    copyFile(resolve(source, file), resolve(root, file)),
  ),
);
if (process.argv.includes("--build-only")) process.exit(0);
const port = Number(process.env.OTT_EVAL_PORT || 4174);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== `127.0.0.1:${port}` &&
      req.headers.host !== `localhost:${port}`
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(
    `Optional WebLLM evaluation: http://127.0.0.1:${port} (no model loaded automatically)`,
  ),
);

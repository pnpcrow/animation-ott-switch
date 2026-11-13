// Opt-in live QA, using only an isolated profile and the installed extension's RPC.
// No cookies/accounts from the user's browser are read. No catalog answer is built into the app.
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  cp,
} from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const mode = options.mode || "http";
if (!["http", "extension"].includes(mode))
  throw new Error("mode must be http or extension");
const selected = (value, name) => !value || value.split(",").includes(name);
const cases = JSON.parse(
  await readFile(options.cases || "qa/cross-check/cases.json", "utf8"),
).filter((c) => selected(options.works, c.id));
await mkdir(".tmp", { recursive: true });
await build({
  stdin: {
    contents:
      'export {providers,cleanSearchTitle} from "./src/providers/identity.ts"; export {searchProvider} from "./src/providers/search.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".tmp/cross-check-core.mjs",
  logLevel: "silent",
});
const { providers, searchProvider } = await import(
  pathToFileURL(resolve(".tmp/cross-check-core.mjs")).href
);
const targets = providers.filter((p) => selected(options.providers, p.id));
const output = resolve(options.output || `artifacts/cross-check-${mode}.json`);
await mkdir(dirname(output), { recursive: true });
const report = {
  schemaVersion: 1,
  mode,
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  environment:
    "isolated Chromium, anonymous public pages, Korea host; does not prove account playback entitlement",
  cases: [],
  results: [],
};
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let context, profile, worker, library;
try {
  if (mode === "extension") {
    profile = await mkdtemp(join(tmpdir(), "ott-switch-cross-check-"));
    const extensionPath = join(profile, "extension");
    await cp(resolve("dist"), extensionPath, { recursive: true });
    report.build = Object.fromEntries(
      await Promise.all(
        ["background.js", "content.js", "manifest.json"].map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(join(extensionPath, name)))
            .digest("hex"),
        ]),
      ),
    );
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      viewport: { width: 1440, height: 960 },
    });
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    library = await context.newPage();
    await library.goto(
      `chrome-extension://${new URL(worker.url()).host}/library.html`,
    );
    await worker.evaluate(() => {
      globalThis.qaProbes = [];
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      chrome.tabs.sendMessage = async (...args) => {
        const reply = await send(...args);
        const entry = {
          kind: args[1]?.kind,
          provider: args[1]?.provider,
          url: reply?.url,
          ready: reply?.ready,
          blocked: reply?.blocked,
          complete: reply?.complete,
          reason: reply?.reason,
          candidates: reply?.candidates,
          actions: reply?.actions?.map(({ title }) => ({ title })),
          detail: reply?.detail && {
            title: reply.detail.title,
            url: reply.detail.url,
            aliases: reply.detail.aliases,
            year: reply.detail.year,
            imageUrl: reply.detail.imageUrl,
            description: reply.detail.description?.slice(0, 350),
          },
        };
        const key = JSON.stringify(entry);
        if (
          !globalThis.qaProbes.some((e) => JSON.stringify(e) === key) &&
          globalThis.qaProbes.length < 200
        )
          globalThis.qaProbes.push(entry);
        return reply;
      };
    });
  }
  async function rpc(action, args = []) {
    const reply = await library.evaluate(
      ({ action, args }) =>
        chrome.runtime.sendMessage({ channel: "ott-switch", action, args }),
      { action, args },
    );
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  }
  async function inspectSource(item) {
    const tab = await worker.evaluate(
      async ({ url }) => chrome.tabs.create({ url, active: false }),
      item.source,
    );
    let detail = null,
      lastError = "",
      previous = "",
      stableAt = 0;
    const started = Date.now(),
      until = started + 18000;
    while (Date.now() < until) {
      try {
        const reply = await worker.evaluate(
          async ({ id, provider }) =>
            chrome.tabs.sendMessage(id, {
              channel: "ott-switch-probe",
              kind: "detail",
              provider,
              token: "qa-source",
            }),
          { id: tab.id, provider: item.source.provider },
        );
        if (reply.ready && reply.detail) {
          detail = reply.detail;
          const signature = JSON.stringify(detail);
          if (signature !== previous) {
            previous = signature;
            stableAt = Date.now();
          }
          if (Date.now() - started >= 4000 && Date.now() - stableAt >= 1200)
            break;
        }
      } catch (e) {
        lastError = e.message;
      }
      await pause(600);
    }
    const tabState = await worker.evaluate((id) => chrome.tabs.get(id), tab.id);
    await worker.evaluate((id) => chrome.tabs.remove(id), tab.id);
    return {
      detail,
      finalUrl: tabState.url,
      error: detail
        ? undefined
        : lastError || "No extractable detail in 18 seconds",
    };
  }
  for (const item of cases) {
    const source = mode === "extension" ? await inspectSource(item) : null;
    report.cases.push({
      id: item.id,
      requested: item.requested,
      query: item.query,
      note: item.note,
      source,
    });
    await save();
    const query = source?.detail || {
      provider: item.source.provider,
      url: item.source.url,
      title: item.query,
      aliases: [],
      description: "",
      imageUrl: "",
    };
    for (const target of targets) {
      if (item.targets && !item.targets.includes(target.id)) continue;
      if (mode === "extension" && target.id === query.provider) {
        report.results.push({
          caseId: item.id,
          target: target.id,
          outcome: "source-only",
          sourceExtracted: !!source?.detail,
        });
        await save();
        continue;
      }
      const start = Date.now();
      let row = {
        caseId: item.id,
        target: target.id,
        query: query.title,
        sourceExtracted: !!source?.detail,
        directSearchUrl: target.searchUrl(query.title),
      };
      try {
        if (mode === "http")
          row.result = await searchProvider(target.id, {
            ...query,
            title: item.query,
          });
        else {
          await rpc("clearSearchResults");
          await worker.evaluate(() => {
            globalThis.qaProbes = [];
          });
          row.result = await rpc("openResolved", [query, target.id]);
          if (
            options["verify-candidates"] !== undefined &&
            row.result.status === "ambiguous"
          ) {
            row.manualChecks = [];
            for (const candidate of (row.result.candidates || []).slice(0, 2)) {
              const result = await rpc("openResolved", [
                query,
                target.id,
                candidate.url,
              ]);
              row.manualChecks.push({ candidate, result });
            }
          }
          row.probes = await worker.evaluate(() => globalThis.qaProbes);
          const tabs = await worker.evaluate(() => chrome.tabs.query({}));
          row.finalTabs = tabs
            .filter((t) => t.active && !t.url?.startsWith("chrome-extension:"))
            .map((t) => ({ url: t.url, pendingUrl: t.pendingUrl }));
          // Close only tabs in this disposable profile, preserving the extension's QA page.
          await worker.evaluate(async () => {
            for (const t of await chrome.tabs.query({}))
              if (t.id && !t.url?.startsWith("chrome-extension:"))
                await chrome.tabs.remove(t.id);
          });
        }
      } catch (e) {
        row.error = e.message;
      }
      row.elapsedMs = Date.now() - start;
      report.results.push(row);
      await save();
      console.log(
        JSON.stringify({
          caseId: row.caseId,
          target: row.target,
          status: row.result?.status,
          opened: row.result?.opened,
          url: row.result?.url,
          error: row.error,
          seconds: Math.round(row.elapsedMs / 1000),
        }),
      );
    }
  }
  report.finishedAt = new Date().toISOString();
  report.summary = report.results.reduce((s, r) => {
    const k = r.result?.status || r.outcome || "error";
    s[k] = (s[k] || 0) + 1;
    return s;
  }, {});
  await save();
  console.log(JSON.stringify({ output, summary: report.summary }));
} finally {
  await context?.close();
  if (profile) {
    const target = await realpath(profile),
      parent = await realpath(tmpdir());
    if (
      dirname(target).toLowerCase() !== parent.toLowerCase() ||
      !basename(target).startsWith("ott-switch-cross-check-")
    )
      throw new Error("Unexpected temporary profile path");
    await rm(target, { recursive: true, force: true });
  }
}

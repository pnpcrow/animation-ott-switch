import { runInference } from "./inference.mjs";
globalThis.runScale = async ({ mode, ...options }) => {
  const wallStart = performance.now();
  const gaps = [];
  let previous = performance.now();
  const timer = setInterval(() => { const now = performance.now(); gaps.push(now - previous); previous = now; }, 16);
  const progress = async value => globalThis.reportScaleProgress?.(value);
  let worker, report;
  try {
    if (mode === "main") report = await runInference(options, progress);
    else if (mode === "worker") {
      worker = new Worker("/worker.mjs", { type: "module" });
      report = await new Promise((resolve, reject) => {
        worker.onerror = error => reject(new Error(error.message));
        worker.onmessage = async ({ data }) => {
          if (data.type === "progress") {
            try { await progress(data.value); worker.postMessage({ type: "ack", sequence: data.sequence }); }
            catch (error) { reject(error); }
          } else if (data.type === "done") resolve(data.value);
          else if (data.type === "failed") reject(new Error(data.error));
        };
        worker.postMessage({ type: "start", options });
      });
    } else throw new Error("Unknown execution mode");
  } finally {
    worker?.terminate();
    clearInterval(timer);
  }
  report.mode = mode;
  report.wallMs = performance.now() - wallStart;
  report.mainThreadTimer = { samples: gaps.length, maximumGapMs: gaps.length ? Math.max(...gaps) : null, note: "Diagnostic timer intervals include loading, reporting and browser scheduling; not a user interaction latency metric." };
  await progress({ stage: mode === "worker" ? "worker-terminated" : "main-finished", completedCases: options.caseCount || options.plan.cases.length, ...report });
  return report;
};

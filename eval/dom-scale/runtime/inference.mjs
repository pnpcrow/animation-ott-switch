import { validatePlan, assembleCases, timeSummary } from "./contract.mjs";
import { tokenizeBatch } from "./tokenize.mjs";

export async function runInference({ plan, planUrl, provider = "wasm", threads = 1, arena = true, memoryPattern = true, tokenize = false }, progress = async () => {}) {
  if (planUrl) plan = await fetch(planUrl).then(response => response.json());
  if (!plan.remoteCasePath) validatePlan(plan);
  if (!["wasm", "webgpu"].includes(provider) || ![1, 2, 4].includes(threads)) throw new Error("Invalid runtime options");
  const beforeImport = performance.now();
  const ort = await import(provider === "webgpu" ? "/ort/ort.webgpu.min.mjs" : "/ort/ort.wasm.min.mjs");
  const report = { provider, threads, arena, memoryPattern, importMs: performance.now() - beforeImport, rows: [], cases: [], referenceComparison: [], gpuQueueSubmissions: 0 };
  let session;
  let tokenizer;
  if (tokenize) {
    const started = performance.now();
    const [{ Tokenizer }, json, config] = await Promise.all([import("/tokenizers.mjs"), fetch("/tokenizer.json").then(r => r.json()), fetch("/tokenizer_config.json").then(r => r.json())]);
    tokenizer = new Tokenizer(json, config);
    report.tokenizerLoadMs = performance.now() - started;
  }
  const originalSubmit = globalThis.GPUQueue?.prototype.submit;
  if (originalSubmit) globalThis.GPUQueue.prototype.submit = function(...args) { report.gpuQueueSubmissions++; return originalSubmit.apply(this, args); };
  try {
    ort.env.wasm.numThreads = threads;
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.proxy = false;
    const began = performance.now();
    session = await ort.InferenceSession.create("/model.onnx", { executionProviders: [provider], graphOptimizationLevel: "all", enableCpuMemArena: arena, enableMemPattern: memoryPattern });
    report.loadMs = performance.now() - began;
    report.inputNames = session.inputNames;
    report.outputNames = session.outputNames;
    await progress({ stage: "loaded", completedCases: 0, ...report });
    for (const [caseIndex, item] of plan.cases.entries()) {
      const current = plan.remoteCasePath ? validatePlan(await fetch(plan.remoteCasePath + caseIndex).then(response => response.json())) : { ...plan, cases: [item], batches: plan.batches.filter(row => item.batchIds.includes(row.id)), autoCases: (plan.autoCases || []).filter(row => row.id === item.id) };
      if (current.cases[0].id !== item.id || JSON.stringify(current.cases[0]) !== JSON.stringify(item)) throw new Error("Streamed case identity mismatch");
      const batches = new Map(current.batches.map(row => [row.id, row]));
      const tokenization = new Map((current.tokenization || []).map(row => [row.batchId, row]));
      const caseRows = [];
      const referenceRows = [];
      for (const batchId of item.batchIds) {
        const batch = batches.get(batchId);
        const row = { id: batch.id, caseId: batch.caseId, candidateIds: batch.candidateIds, pairIds: batch.pairIds, inputShapes: Object.fromEntries(Object.entries(batch.inputs).map(([k, v]) => [k, v.dims])) };
        const feeds = {};
        const processingStart = performance.now();
        try {
          const encoded = tokenizer ? tokenizeBatch(tokenizer, batch, tokenization.get(batch.id)) : null;
          row.tokenizationMs = encoded?.encodeMs ?? null;
          row.tokenizerParity = tokenizer ? true : null;
          for (const name of session.inputNames) {
            const input = (encoded?.inputs || batch.inputs)[name];
            feeds[name] = new ort.Tensor("int64", BigInt64Array.from(input.data, BigInt), input.dims);
          }
          const start = performance.now();
          const output = await session.run(feeds);
          try {
            const tensor = output[plan.model.outputName || "scores"];
            if (!tensor || tensor.dims.length !== 1 || tensor.dims[0] !== batch.candidateIds.length) throw new Error("Wrong score shape");
            row.scores = Array.from(tensor.data, Number);
            if (!row.scores.every(Number.isFinite)) throw new Error("Invalid model score");
            row.elapsedMs = performance.now() - start;
          } finally { Object.values(output).forEach(value => value.dispose()); }
        } catch (error) { row.error = String(error); }
        finally { Object.values(feeds).forEach(value => value.dispose()); row.processingMs = performance.now() - processingStart; }
        report.rows.push(row);
        caseRows.push(row);
        const reference = current.reference[row.id];
        referenceRows.push(row.error || !reference || reference.length !== row.scores?.length ? { id: row.id, error: row.error || "Missing native reference" } : { id: row.id, maxAbsError: Math.max(...reference.map((value, index) => Math.abs(value - row.scores[index]))) });
      }
      const result = assembleCases(current, caseRows)[0];
      result.processingMs = result.valid ? caseRows.reduce((sum, row) => sum + row.processingMs, 0) : null;
      const native = assembleCases(current, caseRows.map(row => ({ id: row.id, scores: current.reference[row.id], elapsedMs: 0 })))[0];
      result.nativeReference = { valid: native.valid, selected: native.selected, sameSelection: result.valid && native.valid && result.selected === native.selected };
      report.cases.push(result);
      report.referenceComparison.push(...referenceRows);
      await progress({ stage: "inference", completedCases: caseIndex + 1, case: result, batchRows: caseRows, referenceRows });
    }
    for (const item of report.cases) {
      item.tokenizationMs = tokenizer ? report.rows.filter(row => row.caseId === item.id).reduce((sum, row) => sum + (row.tokenizationMs || 0), 0) : null;
      item.tokenizationAndInferenceMs = tokenizer && item.valid ? item.tokenizationMs + item.inferenceMs : null;
    }
    report.inference = timeSummary(report.cases.filter(row => row.valid && !row.automaticNone).map(row => row.inferenceMs));
    report.processing = timeSummary(report.cases.filter(row => row.valid && !row.automaticNone).map(row => row.processingMs));
    report.tokenizationAndInference = timeSummary(report.cases.filter(row => row.valid && !row.automaticNone && row.tokenizationAndInferenceMs !== null).map(row => row.tokenizationAndInferenceMs));
    report.nativeReference = { complete: report.referenceComparison.every(row => !row.error) && report.cases.every(row => row.nativeReference.valid), cases: report.cases.length, sameSelections: report.cases.filter(row => row.nativeReference.sameSelection).length, maximumAbsoluteLogitDifference: Math.max(0, ...report.referenceComparison.filter(row => !row.error).map(row => row.maxAbsError)), note: "Native and WASM numerical equality is not assumed. Score differences and top-choice agreement are separate from successful inference and exact tokenizer parity." };
  } finally {
    await session?.release();
    if (originalSubmit) globalThis.GPUQueue.prototype.submit = originalSubmit;
  }
  await progress({ stage: "released", completedCases: plan.cases.length, ...report });
  return report;
}

import * as ort from "/ort/ort.webgpu.min.mjs";

globalThis.runSlayer = async (jobs) => {
  const events = [];
  const gpuCalls = {
    queueSubmissions: 0,
    computePipelines: 0,
    computePipelineLabels: [],
  };
  const originalSubmit = GPUQueue.prototype.submit;
  const originalPipeline = GPUDevice.prototype.createComputePipeline;
  const originalAsyncPipeline = GPUDevice.prototype.createComputePipelineAsync;
  GPUQueue.prototype.submit = function (...args) {
    gpuCalls.queueSubmissions++;
    return originalSubmit.apply(this, args);
  };
  GPUDevice.prototype.createComputePipeline = function (...args) {
    gpuCalls.computePipelines++;
    if (gpuCalls.computePipelineLabels.length < 8)
      gpuCalls.computePipelineLabels.push(args[0]?.label || null);
    return originalPipeline.apply(this, args);
  };
  GPUDevice.prototype.createComputePipelineAsync = function (...args) {
    gpuCalls.computePipelines++;
    if (gpuCalls.computePipelineLabels.length < 8)
      gpuCalls.computePipelineLabels.push(args[0]?.label || null);
    return originalAsyncPipeline.apply(this, args);
  };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.webgpu.profiling = {
    mode: "default",
    ondata: (event) => events.push(event),
  };
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter available");
  const info = adapter.info;
  const started = performance.now();
  const session = await ort.InferenceSession.create("/model.onnx", {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  });
  const report = {
    runtime: "ONNX Runtime Web 1.31.1 WebGPU requested",
    browser: navigator.userAgent,
    adapter: {
      vendor: info?.vendor,
      architecture: info?.architecture,
      device: info?.device,
      description: info?.description,
      isFallbackAdapter: adapter.isFallbackAdapter,
    },
    loadMs: performance.now() - started,
    rows: [],
    gpuCalls,
  };
  const forward = async (ids) => {
    const input = new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [
      1,
      ids.length,
    ]);
    const result = await session.run({ input_ids: input });
    const value = result.log_probs;
    const output = Array.from(value.data);
    for (const tensor of Object.values(result)) tensor.dispose();
    input.dispose();
    return output;
  };
  for (const job of jobs) {
    const begin = performance.now(),
      before = events.length,
      submissionsBefore = gpuCalls.queueSubmissions;
    try {
      if (
        job.inputIds.length + Math.max(...job.tails.map((t) => t.length)) >
        2048
      )
        throw new Error("Context budget exceeded; no truncation");
      const first = await forward(job.inputIds);
      const scores = [];
      for (const tail of job.tails) {
        let score = first[tail[0]];
        for (let index = 1; index < tail.length; index++) {
          const logits = await forward([
            ...job.inputIds,
            ...tail.slice(0, index),
          ]);
          score += logits[tail[index]];
        }
        scores.push(score);
      }
      const selected = scores.indexOf(Math.max(...scores));
      const denominator = scores.reduce(
        (sum, score) => sum + Math.exp(score - Math.max(...scores)),
        0,
      );
      report.rows.push({
        id: job.id,
        template: job.template,
        promptSha256: job.promptSha256,
        chosenId: job.optionIds[selected],
        logScores: scores,
        probabilities: scores.map(
          (score) => Math.exp(score - Math.max(...scores)) / denominator,
        ),
        elapsedMs: performance.now() - begin,
        gpuProfileEvents: events.length - before,
        gpuQueueSubmissions: gpuCalls.queueSubmissions - submissionsBefore,
      });
    } catch (error) {
      report.rows.push({
        id: job.id,
        template: job.template,
        promptSha256: job.promptSha256,
        error: String(error),
        elapsedMs: performance.now() - begin,
      });
    }
    await globalThis.reportSlayerProgress?.(report);
  }
  await session.release();
  report.gpuProfileEventCount = events.length;
  report.gpuKernelTypes = [...new Set(events.map((e) => e.kernelType))];
  report.gpuProfileSample = events.slice(0, 4);
  report.gpuCalls = gpuCalls;
  GPUQueue.prototype.submit = originalSubmit;
  GPUDevice.prototype.createComputePipeline = originalPipeline;
  GPUDevice.prototype.createComputePipelineAsync = originalAsyncPipeline;
  report.note =
    "Custom float32 ONNX export. Intercepted WebGPU queue submissions and compute pipeline creation establish GPU use. ORT warns some nodes run CPU; this is mixed WebGPU/CPU. ORT 1.31 native WebGPU did not emit legacy JSEP profiling callbacks. This graph repeats the prefix for each second suffix token; CPU evaluation uses an exact KV trie. Timings are not architecture-equivalent.";
  return report;
};

import * as ort from "/ort/ort.webgpu.min.mjs";
import { reduceOutput, summarizeTimes } from "/readout.mjs";

function instrumentGpu() {
  const counters = { queueSubmissions: 0, computePipelines: 0, pipelineLabels: [], totalBufferBytes: 0, liveBufferBytes: 0, peakLiveBufferBytes: 0 };
  const restores = [], sizes = new WeakMap();
  const wrap = (target, name, replace) => { if (!target?.[name]) return; const original = target[name]; target[name] = replace(original); restores.push(() => { target[name] = original; }); };
  wrap(globalThis.GPUQueue?.prototype, "submit", original => function(...args) { counters.queueSubmissions++; return original.apply(this, args); });
  for (const name of ["createComputePipeline", "createComputePipelineAsync"]) wrap(globalThis.GPUDevice?.prototype, name, original => function(...args) {
    counters.computePipelines++; const label = args[0]?.label || "(unnamed)";
    if (counters.pipelineLabels.length < 100 && !counters.pipelineLabels.includes(label)) counters.pipelineLabels.push(label);
    return original.apply(this, args);
  });
  wrap(globalThis.GPUDevice?.prototype, "createBuffer", original => function(...args) {
    const buffer = original.apply(this, args), size = args[0].size;
    sizes.set(buffer, size); counters.totalBufferBytes += size; counters.liveBufferBytes += size;
    counters.peakLiveBufferBytes = Math.max(counters.peakLiveBufferBytes, counters.liveBufferBytes);
    return buffer;
  });
  wrap(globalThis.GPUBuffer?.prototype, "destroy", original => function(...args) {
    if (sizes.has(this)) { counters.liveBufferBytes -= sizes.get(this); sizes.delete(this); }
    return original.apply(this, args);
  });
  return { counters, restore: () => restores.reverse().forEach(fn => fn()) };
}

const heap = () => performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize, jsHeapSizeLimit: performance.memory.jsHeapSizeLimit } : null;
function makeTensor(input) {
  const arrays = {int64: BigInt64Array, int32: Int32Array, float32: Float32Array, float16: Uint16Array, bool: Uint8Array};
  if (!arrays[input.type]) throw new Error(`Unsupported input type ${input.type}`);
  if (input.data.length !== input.dims.reduce((a,b)=>a*b,1)) throw new Error("Input dimensions mismatch");
  return new ort.Tensor(input.type, arrays[input.type].from(input.data, input.type === "int64" ? BigInt : Number), input.dims);
}

globalThis.runLightDom = async ({jobs, provider}) => {
  const gpu = instrumentGpu(), report = {requestedProvider:provider, browser:navigator.userAgent, crossOriginIsolated, threads:1, beforeLoadHeap:heap(), rows:[], gpu:gpu.counters};
  let session;
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/ort/";
    if (provider === "webgpu") {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter");
      report.adapter = {vendor:adapter.info?.vendor, architecture:adapter.info?.architecture, device:adapter.info?.device, description:adapter.info?.description, isFallbackAdapter:adapter.isFallbackAdapter??null};
    }
    const start = performance.now();
    session = await ort.InferenceSession.create("/model.onnx", {executionProviders:[provider], graphOptimizationLevel:"all"});
    report.loadMs = performance.now()-start;
    report.inputNames = session.inputNames; report.outputNames = session.outputNames;
    report.afterLoadHeap = heap();
    await globalThis.reportLightDomProgress?.({...report, stage:"loaded"});
    for (const batch of jobs.batches) {
      const row = {id:batch.id, pairIds:batch.pairIds||null, inputShapes:Object.fromEntries(Object.entries(batch.inputs).map(([name,v])=>[name,v.dims])), iterations:[], gpuQueueSubmissions:0};
      const beforeSubmit = gpu.counters.queueSubmissions;
      try {
        const feeds = Object.fromEntries(session.inputNames.map(name => {
          if (!batch.inputs[name]) throw new Error(`Missing input ${name}`);
          return [name,makeTensor(batch.inputs[name])];
        }));
        try {
          const count = batch.repeats ?? 3;
          if (!Number.isInteger(count)||count<1||count>20) throw new Error("Repeats must be 1..20");
          for(let index=0;index<count;index++) {
            const began=performance.now(), result=await session.run(feeds), forwardMs=performance.now()-began;
            try {
              const name=jobs.model.outputName||session.outputNames[0];
              if(!result[name])throw new Error(`Missing output ${name}`);
              const reduced=reduceOutput(result[name],batch.inputs,jobs.model.pooling||"logits");
              const elapsedMs=performance.now()-began;
              if(index===0) { row.output=reduced;row.outputName=name; }
              else row.repeatMaxAbsError=Math.max(row.repeatMaxAbsError||0,...reduced.data.map((v,i)=>Math.abs(v-row.output.data[i])));
              row.iterations.push({index,forwardMs,elapsedMs});
            } finally {Object.values(result).forEach(t=>t.dispose());}
          }
          row.firstMs=row.iterations[0]?.elapsedMs??null;row.warm=summarizeTimes(row.iterations.slice(1).map(x=>x.elapsedMs));
        } finally {Object.values(feeds).forEach(t=>t.dispose());}
      } catch(error) {row.error=String(error);}
      row.gpuQueueSubmissions=gpu.counters.queueSubmissions-beforeSubmit; row.heap=heap();report.rows.push(row);
      await globalThis.reportLightDomProgress?.({...report,stage:"inference"});
    }
    report.first=summarizeTimes(report.rows.map(row=>row.firstMs));
    report.warm=summarizeTimes(report.rows.flatMap(row=>row.iterations.slice(1).map(x=>x.elapsedMs)));
  } catch(error) {report.error=String(error);}
  finally {
    await session?.release();report.afterReleaseHeap=heap();gpu.restore();
  }
  report.gpuObserved=report.gpu.queueSubmissions>0;
  report.notes=["Pretokenized inputs: tokenization time and tokenizer download excluded.","Model load uses local loopback serving, not internet download timing.","GPU submissions establish some GPU work, not full graph residency; unsupported operators may run CPU.","JS heap is not total process memory. GPU buffer counters are logical explicitly created buffers, not driver-reported VRAM; GC-only release is not observed.","Warm iterations repeat the identical batch and do not represent cold page latency."];
  return report;
};

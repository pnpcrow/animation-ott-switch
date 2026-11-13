import {
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  deleteModelAllInfoInCache,
} from "@mlc-ai/web-llm";
export { prebuiltAppConfig, deleteModelAllInfoInCache };
export async function loadModel(modelId, progress) {
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  try {
    const engine = await CreateWebWorkerMLCEngine(
      worker,
      modelId,
      { initProgressCallback: progress },
      { context_window_size: 4096 },
    );
    return { engine, worker };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

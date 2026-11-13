import { runInference } from "./inference.mjs";
let sequence = 0;
const waiting = new Map();
self.onmessage = async ({ data }) => {
  if (data.type === "ack") { waiting.get(data.sequence)?.(); waiting.delete(data.sequence); return; }
  if (data.type !== "start") return;
  const progress = value => new Promise(resolve => {
    const id = ++sequence;
    waiting.set(id, resolve);
    self.postMessage({ type: "progress", sequence: id, value });
  });
  try { self.postMessage({ type: "done", value: await runInference(data.options, progress) }); }
  catch (error) { self.postMessage({ type: "failed", error: String(error) }); }
};

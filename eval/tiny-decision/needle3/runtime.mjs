// Official Cactus 4.1.0 WASM C ABI. This is CPU WebAssembly, not WebGPU.
let module, modelBuffer;
const encoder = new TextEncoder();
function alloc(text) {
  const bytes = encoder.encode(text + "\0");
  const ptr = module._malloc(bytes.length);
  module.HEAPU8.set(bytes, ptr);
  return ptr;
}
export async function load() {
  if (module) return;
  const begin = performance.now();
  module = await globalThis.createCactus();
  // The official WASM build has no pthread/shared-memory support. Pin one CPU
  // thread; do not present the exported native threads setter as WASM parallelism.
  module._cactus_set_threads(1);
  const bytes = new Uint8Array(
    await (await fetch("/assets/needle3.cact")).arrayBuffer(),
  );
  modelBuffer = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, modelBuffer);
  const result = module._cactus_load(modelBuffer, BigInt(bytes.byteLength));
  if (result < 0)
    throw new Error(module.UTF8ToString(module._cactus_last_error()));
  return {
    loadMs: performance.now() - begin,
    modelBytes: bytes.byteLength,
    engine: "Cactus 4.1.0 official WASM CPU",
    threads: 1,
  };
}
export function complete({ tools, input, maxTokens = 96 }) {
  if (!module) throw new Error("Model not loaded");
  const system = alloc("locale: en-US; device: browser"),
    schemas = alloc(JSON.stringify(tools)),
    query = alloc(input);
  const out = module._malloc(65536);
  const begin = performance.now();
  try {
    const initialized = module._cactus_init(system, schemas, 0);
    if (initialized < 0)
      throw new Error(module.UTF8ToString(module._cactus_last_error()));
    // Match Cactus(stateless=True): independent cases must not share turns.
    module._cactus_reset();
    // Only inspect a proposed tool call; never execute a tool or a page action.
    const code = module._cactus_complete(query, 0, 0, maxTokens, out, 65536);
    const raw = module.UTF8ToString(out);
    return {
      code,
      raw,
      result: JSON.parse(raw),
      elapsedMs: performance.now() - begin,
    };
  } finally {
    for (const ptr of [system, schemas, query, out]) module._free(ptr);
  }
}

export function readTensor(tensor) {
  if (tensor.type !== "float16") return Array.from(tensor.data, Number);
  return Array.from(tensor.data, bits => {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 31, fraction = bits & 1023;
    return exponent === 31 ? fraction ? NaN : sign * Infinity : exponent === 0 ? sign * 2 ** -14 * fraction / 1024 : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  });
}

export function reduceOutput(tensor, inputs, pooling = "logits") {
  const data = readTensor(tensor);
  if (data.some(v => !Number.isFinite(v))) throw new Error("Non-finite model output");
  if (pooling === "logits") return { dims: [...tensor.dims], data };
  if (!["mean", "cls"].includes(pooling)) throw new Error(`Unknown pooling ${pooling}`);
  const dims = tensor.dims;
  if (dims.length !== 3) throw new Error("Embedding pooling requires [batch, sequence, hidden]");
  const [batch, sequence, hidden] = dims;
  const mask = inputs.attention_mask?.data;
  if (pooling === "mean" && (!mask || mask.length !== batch * sequence)) throw new Error("Mean pooling requires matching attention_mask");
  const result = [];
  for (let b = 0; b < batch; b++) {
    const vector = new Array(hidden).fill(0);
    let count = 0;
    for (let s = 0; s < sequence; s++) {
      if (pooling === "cls" ? s !== 0 : !Number(mask[b * sequence + s])) continue;
      count++;
      for (let h = 0; h < hidden; h++) vector[h] += data[(b * sequence + s) * hidden + h];
    }
    if (!count) throw new Error("No attended tokens for pooling");
    for (let h = 0; h < hidden; h++) vector[h] /= count;
    const norm = Math.hypot(...vector);
    if (!norm) throw new Error("Zero embedding norm");
    result.push(...vector.map(v => v / norm));
  }
  return { dims: [batch, hidden], data: result };
}

export function summarizeTimes(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const percentile = q => sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
  return { count: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), minimumMs: sorted[0] ?? null, maximumMs: sorted.at(-1) ?? null };
}

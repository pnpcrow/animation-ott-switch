// Regenerate browser input tensors and require exact Python tokenizer parity.
export function tokenizeBatch(tokenizer, batch, specification) {
  if (!specification || specification.batchId !== batch.id || specification.pairs.length !== batch.candidateIds.length) throw new Error("Missing tokenization contract");
  const width = specification.paddingLength;
  const inputs = Object.fromEntries(["input_ids", "attention_mask", "token_type_ids"].map(name => [name, { type: "int64", dims: [batch.candidateIds.length, width], data: [] }]));
  let encodeMs = 0;
  for (const [index, pair] of specification.pairs.entries()) {
    if (pair.candidateId !== batch.candidateIds[index]) throw new Error("Tokenizer pair identity mismatch");
    const started = performance.now();
    const encoded = tokenizer.encode(pair.query, { text_pair: pair.passage, return_token_type_ids: true });
    encodeMs += performance.now() - started;
    if (encoded.ids.length > width) throw new Error("Browser token count exceeds frozen shape");
    const padding = Array(width - encoded.ids.length).fill(0);
    inputs.input_ids.data.push(...encoded.ids, ...padding);
    inputs.attention_mask.data.push(...encoded.attention_mask, ...padding);
    inputs.token_type_ids.data.push(...encoded.token_type_ids, ...padding);
  }
  for (const name of Object.keys(inputs)) {
    if (JSON.stringify(inputs[name]) !== JSON.stringify(batch.inputs[name])) throw new Error(`Browser/Python tokenizer mismatch: ${batch.id} ${name}`);
  }
  return { inputs, encodeMs, pairs: specification.pairs.length };
}

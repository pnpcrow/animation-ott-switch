const require = (condition, message) => { if (!condition) throw new Error(message); };
const unique = values => new Set(values).size === values.length;

export function validatePlan(plan) {
  require(plan.schemaVersion === 2 && Array.isArray(plan.cases) && Array.isArray(plan.batches), "Expected scale plan v2");
  require(plan.cases.length > 0 && unique(plan.cases.map(x => x.id)), "Nonempty unique cases required");
  require(unique(plan.batches.map(x => x.id)), "Duplicate batch");
  const batches = new Map(plan.batches.map(x => [x.id, x]));
  const automatic = new Map((plan.autoCases || []).map(x => [x.id, x]));
  require(automatic.size === (plan.autoCases || []).length, "Duplicate automatic case");
  const used = new Set();
  for (const item of plan.cases) {
    require(unique(item.candidateIds) && item.candidateIds.includes("__none__"), "Invalid candidate list");
    require(unique(item.batchIds), "Duplicate case batch");
    if (item.error) { require(!item.batchIds.length && !automatic.has(item.id), "Failed case has inference"); continue; }
    if (automatic.has(item.id)) {
      require(item.candidateIds.length === 1 && !item.batchIds.length && automatic.get(item.id).selected === "__none__", "Automatic NONE needs empty concrete pool");
      continue;
    }
    const observed = [];
    for (const batchId of item.batchIds) {
      const batch = batches.get(batchId);
      require(batch && batch.caseId === item.id && !used.has(batchId), "Missing/shared/orphan batch");
      used.add(batchId);
      require(JSON.stringify(batch.pairIds) === JSON.stringify(batch.candidateIds.map(id => `${item.id}::${id}`)), "Pair identity mismatch");
      const count = batch.candidateIds.length;
      require(count > 0, "Empty batch");
      let shape;
      for (const name of ["input_ids", "attention_mask", "token_type_ids"]) {
        const input = batch.inputs[name];
        require(input?.type === "int64" && input.dims.length === 2 && input.dims[0] === count && input.dims.every(n => Number.isSafeInteger(n) && n > 0), "Invalid tensor shape");
        require(input.data.length === input.dims[0] * input.dims[1] && input.data.every(Number.isSafeInteger), "Invalid tensor payload");
        require(!shape || shape === input.dims.join(","), "Input shapes disagree");
        shape = input.dims.join(",");
      }
      observed.push(...batch.candidateIds);
    }
    require(JSON.stringify(observed) === JSON.stringify(item.candidateIds), "Candidate omitted, duplicated or reordered");
  }
  require(used.size === batches.size, "Unreferenced batch");
  require([...automatic.keys()].every(id => plan.cases.some(item => item.id === id)), "Unreferenced automatic case");
  return plan;
}

export function assembleCases(plan, outputs) {
  validatePlan(plan);
  require(unique(outputs.map(row => row.id)), "Duplicate output batch");
  const byId = new Map(outputs.map(row => [row.id, row]));
  require(byId.size === plan.batches.length && plan.batches.every(b => byId.has(b.id)), "Every planned batch needs output, including errors");
  const auto = new Set((plan.autoCases || []).map(x => x.id));
  return plan.cases.map(item => {
    const base = { id: item.id, field: item.field, candidateIds: item.candidateIds };
    if (item.error) return { ...base, valid: false, error: item.error };
    if (auto.has(item.id)) return { ...base, valid: true, selected: "__none__", automaticNone: true, scores: [0], inferenceMs: 0 };
    const rows = item.batchIds.map(id => byId.get(id));
    const invalid = rows.find(row => row.error || !Array.isArray(row.scores) || row.scores.some(value => !Number.isFinite(value)) || row.scores.length !== plan.batches.find(b => b.id === row.id).candidateIds.length);
    if (invalid) return { ...base, valid: false, error: invalid.error || "Invalid candidate output" };
    const scores = rows.flatMap(row => row.scores);
    const order = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const tied = order.length > 1 && order[0].score === order[1].score;
    return { ...base, valid: true, scores, selected: tied ? "__none__" : item.candidateIds[order[0].index], inferenceMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0), batches: rows.length };
  });
}

export function timeSummary(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : null, p95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : null };
}

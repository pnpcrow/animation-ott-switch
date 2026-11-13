import { featurePack } from "../tiny-decision/v2/features.mjs";

const fields = ["title", "image", "description"];
const normalized = s => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const yes = value => Number(Boolean(value));
const log = (n, cap) => Math.min(1, Math.log1p(Math.max(0, n)) / Math.log1p(cap));

// Explicit observed structure and generic lexical shapes. No host, CSS class,
// evaluation IDs, candidate order, work dictionary or annotation enters features.
export function candidateFacts(row, candidate) {
  const pack = featurePack(row, { textLimit: 96 });
  const c = pack.candidates.find(item => item.id === candidate.id);
  if (!c) throw new Error("Candidate was not observed");
  const p = pack.page;
  const v = c.none ? "" : c.value;
  const context = `${p.title} ${p.headings.join(" ")}`;
  const parents = c.parents || [];
  const meta = c.tag === "meta" || c.tag === "title";
  const real = !c.none;
  const pageSignals = {
    pageSearchRoute: /(?:^|\/)(?:search|browse)(?:\/|\?|$)/i.test(p.url),
    pageLoginRoute: /(?:^|\/)(?:login|signin|auth)(?:\/|\?|$)/i.test(p.url),
    pageHelpRoute: /(?:^|\/)(?:help|support|faq|node)(?:\/|\?|$)/i.test(p.url),
    pageSearchText: /search results|검색 결과|검색결과|검색하기/i.test(context),
    pageLoginText: /sign in|log in|로그인|인증|보안 확인|security check|access denied/i.test(context),
    pageHelpText: /고객센터|고객 센터|도움말|help center|help centre|support center|자주 묻는/i.test(context),
    pageDialogs: Number(p.dialogs || 0) > 0,
    pageDialogUnknown: p.dialogs === null,
  };
  return {
    real: yes(real), none: yes(c.none),
    ...Object.fromEntries(Object.entries(pageSignals).map(([k, v]) => [k, yes(real && v)])),
    h1: yes(c.tag === "h1"), h2: yes(c.tag === "h2"), h3: yes(c.tag === "h3"),
    paragraph: yes(c.tag === "p"), image: yes(c.tag === "img"), video: yes(c.tag === "video"),
    metadata: yes(meta), browserTitle: yes(c.tag === "title"),
    altSource: yes(c.source === "alt"), ariaSource: yes(c.source === "aria-label"),
    ogSource: yes(c.source?.startsWith("og:")), twitterSource: yes(c.source?.startsWith("twitter:")),
    descriptionSource: yes(c.source === "description"), posterSource: yes(c.source === "poster"),
    textSource: yes(c.source === "text"), srcSource: yes(c.source === "src"),
    visibleBody: yes(real && !meta && !c.hidden), hiddenBody: yes(real && !meta && c.hidden),
    navigation: yes(c.navigation), inert: yes(c.inert), inertUnknown: yes(real && c.inert === null),
    dialog: yes(c.dialog), parentH1: yes(parents.some(p => /^h1(?:\[|$)/.test(p))),
    parentLink: yes(parents.some(p => /^a(?:\[|$)/.test(p))),
    parentList: yes(parents.some(p => /^(?:li|ul|ol)(?:\[|$)/.test(p))),
    parentMain: yes(parents.some(p => /^(?:main|article)(?:\[|$)/.test(p))),
    headingEqual: yes(real && p.headings.some(h => normalized(h) && normalized(h) === normalized(v))),
    nearHeadingEqual: yes(real && c.nearHeading && normalized(c.nearHeading) === normalized(v)),
    altHeadingEqual: yes(c.alt && p.headings.some(h => normalized(h) === normalized(c.alt))),
    textLength: log(v.length, 100), words: Math.min(1, v.split(/\s+/).filter(Boolean).length / 20),
    sentenceMarks: Math.min(1, (v.match(/[.!?。]/g) || []).length / 4),
    episodeText: yes(/(?:episode|season|시즌)\s*\d|\d+\s*(?:화|회)|^\d+\./i.test(v)),
    episodeNeighbor: yes(/(?:episode|season|시즌)\s*\d|\d+\s*(?:화|회|분)|^\d+\./i.test(`${c.previous || ""} ${c.next || ""} ${c.nearHeading || ""}`)),
    marketing: yes(/구독|무제한|합법적으로|지금 가입|subscribe|sign up|unlimited|shop online/i.test(v)),
    legal: yes(/copyright|all rights reserved|이용약관|개인정보|고객센터|도움말/i.test(v)),
    decorated: yes(/^(?:watch|stream)\s|[|｜]|[:：]/i.test(v)),
    placeholder: yes(/^\{[^}]+\}$|아직 준비되지|coming soon/i.test(v)),
    logoHint: yes(/logo|favicon|icon|title[_-]?(?:image|art|treatment)/i.test(`${v} ${c.alt || ""}`)),
    posterHint: yes(/poster|backdrop|keyart|cover|background/i.test(`${v} ${c.alt || ""}`)),
    altObserved: yes(c.alt), headingObserved: yes(c.nearHeading),
    dimensionsObserved: yes(c.width && c.height),
    width: log(c.width || 0, 2000), height: log(c.height || 0, 2000),
    landscape: yes(c.width && c.height && c.width > c.height * 1.2),
    portrait: yes(c.width && c.height && c.height > c.width * 1.2),
    tinyImage: yes(c.width && c.height && Math.max(c.width, c.height) < 160),
  };
}

export function vectorize(row, option, names) {
  const facts = candidateFacts(row, option);
  return Float64Array.from(names, key => {
    const [field, feature] = key.split("/");
    return field === row.field ? facts[feature] || 0 : 0;
  });
}

export function featureNames(row) {
  const keys = Object.keys(candidateFacts(row, row.options[0])).sort();
  return fields.flatMap(field => keys.map(key => `${field}/${key}`));
}

export function encodeDataset(inputs, labels, names = featureNames(inputs[0])) {
  const byLabel = new Map(labels.map(l => [l.id, l]));
  if (byLabel.size !== labels.length || new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error("Duplicate data ID");
  if (byLabel.size !== inputs.length || inputs.some(row => !byLabel.has(row.id))) throw new Error("Every input requires exactly one label");
  return inputs.map(row => {
    const label = byLabel.get(row.id);
    if (!label) throw new Error("Missing label");
    const acceptedIds = label.acceptedIds || [label.expectedId];
    if (!Array.isArray(acceptedIds) || !acceptedIds.length || new Set(acceptedIds).size !== acceptedIds.length || !acceptedIds.includes(label.expectedId)) throw new Error("Training labels require nonempty consistent accepted IDs");
    if (!row.options.length || new Set(row.options.map(o => o.id)).size !== row.options.length || !row.options.some(o => o.id === "__none__")) throw new Error("Every input requires unique observed choices including none");
    if (!acceptedIds.every(id => row.options.some(o => o.id === id))) throw new Error("Unobserved gold");
    return {
      id: row.id, field: row.field, split: row.split,
      group: label.provenance?.work || label.provenance?.pageId,
      expectedId: label.expectedId, acceptedIds,
      candidates: row.options.map(o => ({ id: o.id, x: vectorize(row, o, names), accepted: acceptedIds.includes(o.id) })),
    };
  });
}

const dot = (w, x) => w.reduce((sum, v, i) => sum + v * x[i], 0);
export function fit(rows, names, { lambda = 0.01, epochs = 400, rate = 0.04 } = {}) {
  if (!rows.length || rows.some(r => r.split !== "development")) throw new Error("Training is development only");
  if (rows.some(row => !row.candidates?.length || !row.candidates.some(candidate => candidate.accepted))) throw new Error("Every training case needs an accepted observed candidate");
  const n = names.length, weights = new Float64Array(n), first = new Float64Array(n), second = new Float64Array(n);
  for (let step = 1; step <= epochs; step++) {
    const gradient = new Float64Array(n);
    for (const row of rows) {
      const scores = row.candidates.map(c => dot(weights, c.x));
      const max = Math.max(...scores);
      const values = scores.map(s => Math.exp(s - max));
      const all = values.reduce((a, b) => a + b, 0);
      const accepted = values.reduce((sum, v, i) => sum + (row.candidates[i].accepted ? v : 0), 0);
      row.candidates.forEach((candidate, i) => {
        const error = values[i] / all - (candidate.accepted ? values[i] / accepted : 0);
        for (let j = 0; j < n; j++) if (candidate.x[j]) gradient[j] += error * candidate.x[j] / rows.length;
      });
    }
    for (let j = 0; j < n; j++) {
      const g = gradient[j] + lambda * weights[j];
      first[j] = 0.9 * first[j] + 0.1 * g;
      second[j] = 0.999 * second[j] + 0.001 * g * g;
      weights[j] -= rate * (first[j] / (1 - 0.9 ** step)) / (Math.sqrt(second[j] / (1 - 0.999 ** step)) + 1e-8);
    }
  }
  return { model: "dom-linear-listwise-v1", names, weights: Array.from(weights), lambda, epochs, rate, outputMeaning: "Uncalibrated linear ranking scores; no claimed probability of correctness." };
}

export function predictEncoded(model, row) {
  const started = performance.now();
  const failure = error => ({ id: row.id, field: row.field, split: row.split, valid: false, expectedId: row.expectedId, acceptedIds: row.acceptedIds, correct: false, elapsedMs: performance.now() - started, error, scores: [], trivialNoCandidate: row.candidates?.length === 1 });
  if (!row.candidates?.length || new Set(row.candidates.map(c => c.id)).size !== row.candidates.length || !row.candidates.some(c => c.id === "__none__")) return failure("Missing or duplicate observed candidates");
  if (!model.weights?.length || model.weights.some(v => !Number.isFinite(v)) || row.candidates.some(c => c.x.length !== model.weights.length || c.x.some(v => !Number.isFinite(v)))) return failure("Non-finite model weights/features or mismatched dimensions");
  const ranked = row.candidates.map(c => ({ id: c.id, score: dot(model.weights, c.x) })).sort((a, b) => b.score - a.score);
  if (ranked.some(c => !Number.isFinite(c.score))) return failure("Non-finite ranking score");
  const chosenId = ranked[1] && Math.abs(ranked[0].score - ranked[1].score) < 1e-9 ? "__none__" : ranked[0].id;
  return { id: row.id, field: row.field, split: row.split, chosenId, valid: true, expectedId: row.expectedId, acceptedIds: row.acceptedIds, correct: row.acceptedIds.includes(chosenId), elapsedMs: performance.now() - started, scores: ranked, trivialNoCandidate: row.candidates.length === 1 };
}

export function predict(model, input) {
  const row = { candidates: input.options.map(o => ({ id: o.id, x: vectorize(input, o, model.names) })), acceptedIds: [], id: input.id, field: input.field, split: input.split };
  const { chosenId, valid, scores, error } = predictEncoded(model, row);
  return { chosenId, valid, scores, ...(error ? { error } : {}) };
}

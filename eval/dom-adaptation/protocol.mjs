// Evaluation grouping only. Provider/work identities must never enter model inputs.
const providerDomains = {
  laftel: "laftel.net", aniplus: "aniplustv.com", crunchyroll: "crunchyroll.com",
  netflix: "netflix.com", prime: "primevideo.com", apple: "apple.com",
  wavve: "wavve.com", tving: "tving.com", coupang: "coupangplay.com", watcha: "watcha.com",
};

// Historical provenance grouped this explicit work search under none-search.
// This reviewed identity is used for partitioning only, never as a model feature.
export const workIdentityOverrides = {
  "new-search-laftel": {
    work: "spy-family", provider: "laftel", pathname: "/search",
    parameter: "keyword", value: "스파이 패밀리",
    reason: "Observed source URL explicitly searches for the same work as spy-family-apple.",
  },
};

export function providerFor(url) {
  const host = new URL(url).hostname.toLowerCase();
  const matches = Object.entries(providerDomains).filter(([, domain]) => host === domain || host.endsWith(`.${domain}`));
  if (matches.length !== 1) throw new Error(`Unmapped provider: ${host}`);
  return matches[0][0];
}

export function corpusRecords(inputs, labels) {
  if (new Set(inputs.map(x => x.id)).size !== inputs.length || new Set(labels.map(x => x.id)).size !== labels.length) throw new Error("Duplicate case ID");
  if (inputs.length !== labels.length) throw new Error("Input/label count differs");
  const byId = new Map(labels.map(x => [x.id, x]));
  const pages = new Map();
  return inputs.map(input => {
    const label = byId.get(input.id);
    if (!label) throw new Error(`Missing label: ${input.id}`);
    const { pageId, work, url } = label.provenance || {};
    if (!pageId || !work || !url) throw new Error(`Missing provenance: ${input.id}`);
    const accepted = label.acceptedIds?.length ? label.acceptedIds : [label.expectedId];
    const options = input.options.map(x => x.id);
    if (new Set(options).size !== options.length || !options.includes("__none__")) throw new Error("Invalid candidate IDs");
    if (!accepted.length || accepted.some(id => !options.includes(id))) throw new Error(`Accepted target outside pool: ${input.id}`);
    if (accepted.includes("__none__") && accepted.length > 1) throw new Error("Ambiguous absent target");
    if (!["title", "image", "description"].includes(input.field)) throw new Error("Unsupported field");
    const provider = providerFor(url);
    if (provider !== providerFor(input.pageEvidence.url)) throw new Error("Input/provenance provider mismatch");
    const pageIdentity = `${provider}\0${work}`;
    if (pages.has(pageId) && pages.get(pageId) !== pageIdentity) throw new Error("Inconsistent page identity");
    pages.set(pageId, pageIdentity);
    const override = workIdentityOverrides[pageId];
    if (override) {
      for (const source of [url, input.pageEvidence.url]) {
        const parsed = new URL(source);
        if (provider !== override.provider || parsed.pathname !== override.pathname || parsed.searchParams.get(override.parameter) !== override.value) throw new Error("Work identity override evidence mismatch");
      }
    }
    return {
      id: input.id, pageId, provider,
      // The historical dataset names no-work groups none-*. Named work searches
      // retain their work identity, even when their requested detail field is absent.
      work: override?.work ?? (work.startsWith("none-") ? null : work),
      field: input.field, positive: !accepted.includes("__none__"),
      concreteCandidates: options.filter(id => id !== "__none__").length,
      status: "consumed-development",
    };
  });
}

export function summarize(records) {
  return {
    cases: records.length,
    pages: new Set(records.map(x => x.pageId)).size,
    providers: [...new Set(records.map(x => x.provider))].sort(),
    namedWorkGroups: new Set(records.map(x => x.work).filter(Boolean)).size,
    positive: records.filter(x => x.positive).length,
    absent: records.filter(x => !x.positive).length,
    emptyConcretePools: records.filter(x => !x.concreteCandidates).length,
  };
}

export function assertDisjoint(train, test) {
  for (const key of ["id", "pageId", "provider", "work"]) {
    const seen = new Set(train.map(x => x[key]).filter(Boolean));
    if (test.some(x => x[key] && seen.has(x[key]))) throw new Error(`Split leakage: ${key}`);
  }
}

export function providerHeldoutFolds(records) {
  return [...new Set(records.map(x => x.provider))].sort().map(provider => {
    const test = records.filter(x => x.provider === provider);
    const testWorks = new Set(test.map(x => x.work).filter(Boolean));
    const remaining = records.filter(x => x.provider !== provider);
    const excluded = remaining.filter(x => x.work && testWorks.has(x.work));
    const train = remaining.filter(x => !x.work || !testWorks.has(x.work));
    assertDisjoint(train, test);
    const testSummary = summarize(test);
    return {
      provider, train: summarize(train), test: testSummary,
      trainIds: train.map(x => x.id), testIds: test.map(x => x.id),
      excludedSameWorkIds: excluded.map(x => x.id),
      missingPositiveFields: ["title", "image", "description"].filter(field => !test.some(x => x.field === field && x.positive)),
      canMeasureBothPositiveAndAbsent: testSummary.positive > 0 && testSummary.absent > 0,
      executed: false,
    };
  });
}

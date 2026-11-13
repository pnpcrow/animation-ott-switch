import { featurePack, compactCandidate } from "../tiny-decision/v2/features.mjs";

export const templates = ["en-role", "ko-role"];
export const textTiers = [96, 64, 32];
export const maxTokens = 384;
const tasks = {
  "en-role": {
    title: { query: "The clean name of the series or movie currently open in this detail view.", hypothesis: "This element gives the clean title of the series or movie currently open." },
    image: { query: "The representative poster or backdrop artwork of the series or movie currently open in this detail view.", hypothesis: "This element supplies the representative poster or backdrop of the series or movie currently open." },
    description: { query: "The story synopsis of the series or movie currently open in this detail view.", hypothesis: "This element describes the story of the series or movie currently open." },
  },
  "ko-role": {
    title: { query: "현재 상세 화면에 열려 있는 영화 또는 시리즈의 정확한 작품 제목", hypothesis: "이 요소는 현재 열려 있는 영화 또는 시리즈의 작품 제목이다." },
    image: { query: "현재 상세 화면에 열려 있는 영화 또는 시리즈의 대표 포스터 또는 배경 이미지", hypothesis: "이 요소는 현재 열려 있는 영화 또는 시리즈의 대표 포스터 또는 배경 이미지이다." },
    description: { query: "현재 상세 화면에 열려 있는 영화 또는 시리즈의 전체 이야기와 줄거리를 설명하는 작품 소개", hypothesis: "이 요소는 현재 열려 있는 영화 또는 시리즈의 전체 줄거리와 이야기를 설명한다." },
  },
};

export function pairsFor(row, template) {
  if (!templates.includes(template)) throw new Error("Unknown template");
  if (!tasks[template][row.field]) throw new Error("Unsupported field");
  const packs = textTiers.map(textLimit => ({ textLimit, facts: featurePack(row, { textLimit }) }));
  return packs[0].facts.candidates.filter(c => !c.none).map(candidate => {
    const variants = packs.map(({ textLimit, facts }) => {
      const node = facts.candidates.find(c => c.id === candidate.id);
      // Page/DOM observations are data, not instructions or annotated roles.
      const passage = `Observed page: ${JSON.stringify(facts.page)}\nObserved element: ${JSON.stringify(compactCandidate(node))}`;
      return { textLimit, passage, premise: passage, ...tasks[template][row.field] };
    });
    return {
      id: `${row.id}::${template}::${candidate.id}`, caseId: row.id,
      field: row.field, template, candidateId: candidate.id,
      ...variants[0], variants,
    };
  });
}

export function preparePairs(inputs, selected = templates) {
  if (new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error("Duplicate input case");
  return {
    schemaVersion: 1, maxTokens, textTiers, templates: selected,
    cases: selected.flatMap(template => inputs.map(row => ({
      id: row.id, field: row.field, split: row.split, template,
      optionIds: row.options.map(o => o.id),
      pairIds: pairsFor(row, template).map(p => p.id),
    }))),
    pairs: selected.flatMap(template => inputs.flatMap(row => pairsFor(row, template))),
  };
}

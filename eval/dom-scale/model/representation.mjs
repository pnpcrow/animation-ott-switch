import { featurePack } from "../../tiny-decision/v2/features.mjs";
import { naturalPassage } from "../../dom-adaptation/templates.mjs";

export const recipes = {
  "full-natural": { layers: [0,1,2,3,4,5,6,7,8,9,10,11], representation: "natural", maximumTokens: 384 },
  "full-compact": { layers: [0,1,2,3,4,5,6,7,8,9,10,11], representation: "compact", maximumTokens: 160 },
  "small-compact": { layers: [2,5,8,11], representation: "compact", maximumTokens: 160 },
};
const queries = { title: "현재 작품의 영화 또는 시리즈 제목", image: "현재 작품의 대표 포스터 또는 배경 그림", description: "현재 작품의 전체 줄거리와 소개" };
const clip = (value, limit) => [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, limit).join("");
const q = JSON.stringify;
const known = value => typeof value === "boolean" ? value ? "참" : "거짓" : "미확인";

function scope(row, option) {
  const nodes = option.evidence?.nodes || [];
  const n = nodes.find(node => node.hidden === false && node.navigation === false) || nodes[0];
  return {
    hidden: n?.hidden, navigation: n?.navigation, inert: n?.inert, inDialog: n?.inDialog,
  };
}

function mediaFacts(row) {
  const media = row.pageEvidence?.media;
  const count = value => Number.isInteger(value) && value >= 0 ? value : "?";
  return `동영상=${count(media?.videoCount)} 재생=${count(media?.playingCount)} 전체화면=${known(media?.fullscreen)}`;
}

export function compactPassage(row, pack, candidate, option, textLimit) {
  const page = pack.page, observed = scope(row, option);
  // Values are observations. No gold, provider label, work ID or inferred page class.
  const pageText = `문서=${q(clip(page.title, Math.min(textLimit, 48)))} 제목=${q(page.headings.map(h => clip(h, Math.min(textLimit, 32))).join("|"))} 모달수=${page.dialogs ?? "?"} ${mediaFacts(row)}`;
  if (candidate.none) return `${pageText} 결과=현재 작품의 요청 정보에 해당하는 후보 없음`;
  const c = candidate;
  const nodeText = [
    `${c.tag}/${c.source}`, `값=${q(clip(c.value, textLimit))}`,
    `숨김=${known(observed.hidden)}`, `메뉴=${known(observed.navigation)}`,
    `비활성=${known(observed.inert)}`, `모달=${known(observed.inDialog)}`,
    c.parents.length ? `조상=${c.parents.slice(0, 3).join("<")}` : "",
    c.role ? `역할=${c.role}` : "",
    c.alt ? `alt=${q(clip(c.alt, Math.min(textLimit, 32)))}` : "",
    c.width || c.height ? `크기=${Math.round(c.width ?? 0) || "?"}x${Math.round(c.height ?? 0) || "?"}` : "",
    c.nearHeading ? `주변=${q(clip(c.nearHeading, Math.min(textLimit, 24)))}` : "",
  ].filter(Boolean).join(" ");
  return `${pageText} ${nodeText}`;
}

export function prepare(inputs, recipeName) {
  const recipe = recipes[recipeName];
  if (!recipe) throw new Error("Unknown recipe");
  if (new Set(inputs.map(row => row.id)).size !== inputs.length) throw new Error("Duplicate case IDs");
  return {
    schemaVersion: 1, recipe: recipeName, ...recipe,
    cases: inputs.map(row => {
      if (!queries[row.field]) throw new Error("Unsupported field");
      const ids = row.options.map(option => option.id);
      if (new Set(ids).size !== ids.length || ids.filter(id => id === "__none__").length !== 1) throw new Error("Candidate IDs must be unique and include none exactly once");
      return {
        id: row.id, field: row.field,
        candidates: row.options.map(option => ({
          id: option.id,
          variants: [96,64,32,16,8].map(textLimit => {
            const pack = featurePack(row, { textLimit });
            const candidate = pack.candidates.find(c => c.id === option.id);
            let passage;
            if (recipe.representation === "compact") passage = compactPassage(row, pack, candidate, option, textLimit);
            else passage = candidate.none
              ? `문서 제목은 ${q(pack.page.title)}이다. 경로는 ${q(pack.page.url)}이다. 보이는 제목 요소는 ${q(pack.page.headings)}이다. 보이는 대화상자 수는 ${pack.page.dialogs ?? "미확인"}이다. 선택 결과: 관측된 후보 중 현재 작품에 해당하는 요청 정보가 없다.`
              : naturalPassage(pack.page, candidate, "ko");
            if (recipe.representation === "natural") passage += ` ${mediaFacts(row)}`;
            return { textLimit, query: queries[row.field], passage };
          }),
        })),
      };
    }),
  };
}

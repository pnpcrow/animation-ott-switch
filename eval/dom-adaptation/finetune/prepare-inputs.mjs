import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { featurePack } from "../../tiny-decision/v2/features.mjs";
import { naturalPassage } from "../templates.mjs";

const queries = {
  title: "현재 상세 화면에 열린 영화 또는 시리즈의 작품 제목을 선택한다.",
  image: "현재 상세 화면에 열린 영화 또는 시리즈의 대표 포스터 또는 배경 이미지를 선택한다.",
  description: "현재 상세 화면에 열린 영화 또는 시리즈의 전체 줄거리와 이야기를 설명하는 소개를 선택한다.",
};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const directory = ".tmp/dom-adaptation/finetune";
mkdirSync(directory, { recursive: true });
for (const split of ["development", "holdout"]) {
  const inputPath = `eval/light-dom/data/${split}-inputs.json`;
  const bytes = readFileSync(inputPath);
  const rows = JSON.parse(bytes);
  const cases = rows.map(row => ({
    id: row.id, field: row.field,
    candidates: row.options.map(option => ({
      id: option.id,
      variants: [96, 64, 32, 16].map(textLimit => {
        const pack = featurePack(row, { textLimit });
        const node = pack.candidates.find(candidate => candidate.id === option.id);
        // NONE is an explicit outcome description, never a fabricated observed node.
        const passage = node.none
          ? `문서 제목은 ${JSON.stringify(pack.page.title)}이다. 경로는 ${JSON.stringify(pack.page.url)}이다. 보이는 제목 요소는 ${JSON.stringify(pack.page.headings)}이다. 보이는 대화상자 수는 ${pack.page.dialogs ?? "미확인"}이다. 선택 결과: 관측된 후보 중 현재 작품에 해당하는 요청 정보가 없다.`
          : naturalPassage(pack.page, node, "ko");
        return { textLimit, query: queries[row.field], passage };
      }),
    })),
  }));
  writeFileSync(`${directory}/${split}-inputs.json`, JSON.stringify({
    schemaVersion: 1, maximumTokens: 384, role: split === "development" ? "training" : "retrospective validation, already observed", inputPath, inputsSha256: sha(bytes),
    representation: "Korean natural observed DOM facts; explicit NONE outcome; no labels, case IDs, hosts or CSS classes in model text",
    cases,
  }, null, 2) + "\n");
}

import { safeProviderUrl } from "../../src/providers/identity.ts";
import { templates } from "./templates.mjs";

export const runtimeVersion = "0.2.88";
export const modelIds = [
  "Qwen3-0.6B-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
];
const limits = { cases: 100, evidence: 24, candidates: 20, text: 1200 };
const fields = [
  "titleId",
  "imageId",
  "descriptionId",
  "candidateId",
  "status",
  "confidence",
];
const statuses = ["match", "ambiguous", "not_found", "unknown"];
const short = (value, max = limits.text) =>
  typeof value === "string" ? value.slice(0, max) : "";
const isId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const https = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export function validateDataset(raw) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.cases) ||
    !raw.cases.length ||
    raw.cases.length > limits.cases
  )
    throw new Error("schemaVersion=1, 1~100개 cases가 필요합니다.");
  const seen = new Set();
  const cases = raw.cases.map((item) => {
    if (
      !isId(item.id) ||
      seen.has(item.id) ||
      !["calibration", "holdout"].includes(item.split)
    )
      throw new Error("사례 ID가 중복되거나 split이 올바르지 않습니다.");
    seen.add(item.id);
    if (
      !item.input ||
      !Array.isArray(item.input.evidence) ||
      !Array.isArray(item.input.candidates)
    )
      throw new Error(`${item.id}: evidence와 candidates 배열이 필요합니다.`);
    if (
      item.input.evidence.length > limits.evidence ||
      item.input.candidates.length > limits.candidates
    )
      throw new Error(`${item.id}: 관측 자료 개수 제한을 초과했습니다.`);
    const ids = new Set();
    const checkId = (id) => {
      if (!isId(id) || ids.has(id))
        throw new Error(`${item.id}: 중복된 근거 ID`);
      ids.add(id);
    };
    const evidence = item.input.evidence.map((row) => {
      checkId(row.id);
      if (
        !["title", "image", "description"].includes(row.kind) ||
        typeof row.value !== "string" ||
        row.value.length > limits.text
      )
        throw new Error(`${item.id}: 근거 형식 또는 길이가 올바르지 않습니다.`);
      if (row.kind === "image" && !https(row.value))
        throw new Error(`${item.id}: 이미지 URL은 HTTPS여야 합니다.`);
      return {
        id: row.id,
        kind: row.kind,
        value: row.value,
        role: short(row.role, 100),
        scope: short(row.scope, 100),
      };
    });
    const candidates = item.input.candidates.map((row) => {
      checkId(row.id);
      if (
        !safeProviderUrl(item.input.provider, row.url) ||
        typeof row.title !== "string" ||
        row.title.length > 300
      )
        throw new Error(
          `${item.id}: 공식 작품 URL 또는 제목이 올바르지 않습니다.`,
        );
      return {
        id: row.id,
        title: row.title,
        url: row.url,
        aliases: Array.isArray(row.aliases)
          ? row.aliases.slice(0, 6).map((a) => short(a, 300))
          : [],
        kind: short(row.kind, 80),
        version: short(row.version, 100),
        year: Number.isInteger(row.year) ? row.year : null,
      };
    });
    const input = {
      provider: item.input.provider,
      query: {
        title: short(item.input.query?.title, 300),
        aliases: Array.isArray(item.input.query?.aliases)
          ? item.input.query.aliases.slice(0, 6).map((a) => short(a, 300))
          : [],
        kind: short(item.input.query?.kind, 80),
        version: short(item.input.query?.version, 100),
        year: Number.isInteger(item.input.query?.year)
          ? item.input.query.year
          : null,
      },
      complete: item.input.complete === true,
      evidence,
      candidates,
    };
    if (new TextEncoder().encode(JSON.stringify(input)).length > 7000)
      throw new Error(
        `${item.id}: 모델 입력은 UTF-8 7000바이트 이하여야 합니다. 관련 근거만 남겨 주세요.`,
      );
    const expected = item.expected;
    if (
      !expected ||
      fields.slice(0, 5).some((key) => typeof expected[key] !== "string")
    )
      throw new Error(`${item.id}: 정답 ID와 status가 필요합니다.`);
    const expectedValidation = validateAnswer(
      { ...expected, confidence: 1 },
      input,
    );
    if (!expectedValidation.ok)
      throw new Error(
        `${item.id}: 정답 검증 실패: ${expectedValidation.errors.join(", ")}`,
      );
    return {
      id: item.id,
      split: item.split,
      provenance: short(item.provenance, 1000),
      input,
      expected: Object.fromEntries(
        fields.slice(0, 5).map((key) => [key, expected[key]]),
      ),
    };
  });
  return { schemaVersion: 1, name: short(raw.name, 200), cases };
}

export function responseSchema(input) {
  const idField = (kind) => ({
    type: "string",
    enum: [
      "",
      ...input.evidence.filter((e) => e.kind === kind).map((e) => e.id),
    ],
  });
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      titleId: idField("title"),
      imageId: idField("image"),
      descriptionId: idField("description"),
      candidateId: {
        type: "string",
        enum: ["", ...input.candidates.map((c) => c.id)],
      },
      status: { type: "string", enum: statuses },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: fields,
  };
}

export function requestFor(item, templateId, modelId = "") {
  const template = templates.find((t) => t.id === templateId);
  if (!template) throw new Error("알 수 없는 템플릿입니다.");
  // IDs, provenance, split and expected answers are deliberately excluded.
  return {
    messages: [
      { role: "system", content: template.system },
      { role: "user", content: JSON.stringify(item.input) },
    ],
    temperature: 0,
    seed: 7,
    max_tokens: 240,
    stream: false,
    response_format: {
      type: "json_object",
      schema: JSON.stringify(responseSchema(item.input)),
    },
    ...(modelId.startsWith("Qwen3-")
      ? { extra_body: { enable_thinking: false } }
      : {}),
  };
}

export function validateAnswer(answer, input) {
  const errors = [];
  if (!answer || typeof answer !== "object" || Array.isArray(answer))
    return { ok: false, errors: ["JSON 객체가 아닙니다."] };
  if (
    Object.keys(answer).some((key) => !fields.includes(key)) ||
    fields.some((key) => !(key in answer))
  )
    errors.push("출력 필드 불일치");
  for (const [key, kind] of [
    ["titleId", "title"],
    ["imageId", "image"],
    ["descriptionId", "description"],
  ]) {
    if (
      answer[key] !== "" &&
      !input.evidence.some((e) => e.id === answer[key] && e.kind === kind)
    )
      errors.push(`${key}: 관측되지 않은 ID`);
  }
  if (
    answer.candidateId !== "" &&
    !input.candidates.some((c) => c.id === answer.candidateId)
  )
    errors.push("candidateId: 관측되지 않은 ID");
  if (!statuses.includes(answer.status)) errors.push("status 값 오류");
  if (answer.status === "match" && !answer.candidateId)
    errors.push("match에 후보 없음");
  if (answer.status !== "match" && answer.candidateId !== "")
    errors.push("보류 상태에 후보 지정");
  if (answer.status === "not_found" && !input.complete)
    errors.push("미완료 검색으로 부재 판정");
  if (
    !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 ||
    answer.confidence > 1
  )
    errors.push("confidence 범위 오류");
  return { ok: !errors.length, errors };
}

export function scoreAnswer(item, raw) {
  let answer;
  // WebLLM 0.2.88 documents this empty Qwen thinking preamble even when
  // extra_body.enable_thinking=false. Remove only that empty wrapper; never
  // extract JSON from arbitrary prose or conceal a non-empty reasoning block.
  const json =
    typeof raw === "string" ? raw.replace(/^<think>\s*<\/think>\s*/, "") : raw;
  try {
    answer = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return {
      valid: false,
      exact: false,
      unsafeMatch: false,
      errors: ["JSON 파싱 실패"],
    };
  }
  const validation = validateAnswer(answer, item.input);
  const comparison = Object.fromEntries(
    fields
      .slice(0, 5)
      .map((key) => [key, answer?.[key] === item.expected[key]]),
  );
  return {
    valid: validation.ok,
    exact: validation.ok && Object.values(comparison).every(Boolean),
    unsafeMatch:
      answer?.status === "match" &&
      (item.expected.status !== "match" ||
        answer.candidateId !== item.expected.candidateId),
    comparison,
    errors: validation.errors,
    answer,
  };
}

export function summarize(rows) {
  return {
    cases: rows.length,
    valid: rows.filter((r) => r.score?.valid).length,
    exact: rows.filter((r) => r.score?.exact).length,
    unsafeMatches: rows.filter((r) => r.score?.unsafeMatch).length,
    errors: rows.filter((r) => r.error).length,
    fields: Object.fromEntries(
      fields
        .slice(0, 5)
        .map((field) => [
          field,
          rows.filter((row) => row.score?.comparison?.[field]).length,
        ]),
    ),
    totalMs: rows.reduce((sum, r) => sum + (r.elapsedMs || 0), 0),
  };
}

// A development-screening threshold, never authorization to auto-navigate.
export function selectCalibration(reports) {
  const eligible = (report) =>
    report.summary.cases > 0 &&
    report.summary.valid === report.summary.cases &&
    report.summary.unsafeMatches === 0 &&
    report.summary.errors === 0 &&
    report.summary.exact / report.summary.cases >= 0.75;
  const candidates = reports.filter((report) => report.split === "calibration");
  const qualified = candidates.filter(eligible);
  const selected = [...(qualified.length ? qualified : candidates)].sort(
    (a, b) =>
      a.summary.unsafeMatches - b.summary.unsafeMatches ||
      b.summary.exact - a.summary.exact ||
      b.summary.valid - a.summary.valid ||
      a.summary.errors - b.summary.errors ||
      b.template.localeCompare(a.template),
  )[0];
  if (!selected) throw new Error("조정용 평가 결과가 없습니다.");
  return {
    template: selected.template,
    calibrationEligible: eligible(selected),
    recommendation: eligible(selected)
      ? "independent-evaluation-only"
      : "reject-model-decision-use-existing-rules",
    automaticSwitchingEnabled: false,
  };
}

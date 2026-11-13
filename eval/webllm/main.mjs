import { templates } from "./templates.mjs";
import { starterDataset } from "./fixtures.mjs";
import {
  modelIds,
  runtimeVersion,
  validateDataset,
  requestFor,
  scoreAnswer,
  summarize,
} from "./core.mjs";
const $ = (id) => document.getElementById(id);
const state = {
  dataset: validateDataset(starterDataset),
  loaded: null,
  runtime: null,
  running: false,
  evaluating: false,
  stopped: false,
  reports: [],
  gpu: null,
};
const message = (text) => {
  $("runtime-status").textContent = text;
};
const fail = (error) =>
  message(
    `실행하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
  );
function option(select, value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  select.append(node);
}
for (const id of modelIds) option($("model"), id, id);
for (const template of templates)
  option($("template"), template.id, template.label);
$("template").value = "evidence-v2";
const download = (name, data) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
};
const fingerprint = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
function preview() {
  const split = $("split").value;
  $("dataset-name").textContent =
    `${state.dataset.name} · ${state.dataset.cases.length}개 사례`;
  $("preview").textContent = JSON.stringify(
    {
      template: templates.find((t) => t.id === $("template").value),
      modelInputs: state.dataset.cases
        .filter((item) => item.split === split)
        .map((item) => ({ caseId: item.id, input: item.input })),
    },
    null,
    2,
  );
}
function buttons() {
  const busy = state.running;
  for (const id of [
    "load",
    "delete-model",
    "model",
    "import",
    "template",
    "split",
  ])
    $(id).disabled = busy;
  $("unload").disabled = busy || !state.loaded;
  $("run").disabled = busy || !state.loaded;
  $("stop").disabled = !state.evaluating;
  $("export").disabled = !state.reports.length;
}
async function checkGPU() {
  if (!navigator.gpu)
    throw new Error("이 브라우저에서는 WebGPU를 사용할 수 없습니다.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter)
    throw new Error(
      "WebGPU 어댑터를 찾지 못했습니다. GPU 가속과 드라이버를 확인하세요.",
    );
  state.gpu = {
    vendor: adapter.info?.vendor || "",
    architecture: adapter.info?.architecture || "",
    device: adapter.info?.device || "",
    description: adapter.info?.description || "",
    shaderF16: adapter.features.has("shader-f16"),
    maxBufferSize: adapter.limits.maxBufferSize,
  };
  $("gpu").textContent =
    `WebGPU 사용 가능 · ${state.gpu.description || state.gpu.vendor || "GPU"} · shader-f16 ${state.gpu.shaderF16 ? "지원" : "미지원 (f32 모델 선택)"}`;
  return state.gpu;
}
async function unload() {
  if (state.loaded) {
    try {
      await state.loaded.engine.unload();
    } finally {
      state.loaded.worker.terminate();
      state.loaded = null;
    }
  }
  buttons();
}
async function load() {
  if (!$("consent").checked)
    throw new Error("모델 다운로드·실행 선택을 먼저 확인하세요.");
  await checkGPU();
  const model = $("model").value;
  if (model.includes("f16") && !state.gpu.shaderF16)
    throw new Error(
      "선택한 모델에 shader-f16 기능이 필요합니다. f32 모델을 선택하세요.",
    );
  state.running = true;
  buttons();
  try {
    await unload();
    state.runtime ||= await import("./runtime.mjs");
    const record = state.runtime.prebuiltAppConfig.model_list.find(
      (row) => row.model_id === model,
    );
    $("model-info").textContent =
      `공식 카탈로그 예상 GPU 메모리: ${record?.vram_required_MB ?? "알 수 없음"} MB. 실제 사용량은 환경에 따라 다릅니다.`;
    message("모델을 불러오고 있습니다…");
    state.loaded = {
      ...(await state.runtime.loadModel(model, (report) => {
        $("progress").value = report.progress;
        message(report.text);
      })),
      model,
    };
    message(`${model} 준비 완료. 평가 자료를 선택하세요.`);
  } finally {
    state.running = false;
    buttons();
  }
}
async function evaluate() {
  if (!state.loaded || state.running)
    throw new Error("모델을 먼저 불러오세요.");
  state.running = true;
  state.evaluating = true;
  state.stopped = false;
  buttons();
  const report = {
    schemaVersion: 1,
    runtime: `@mlc-ai/web-llm@${runtimeVersion}`,
    model: state.loaded.model,
    template: $("template").value,
    split: $("split").value,
    dataset: state.dataset.name,
    datasetSha256: await fingerprint(state.dataset),
    templateSha256: await fingerprint(
      templates.find((t) => t.id === $("template").value),
    ),
    startedAt: new Date().toISOString(),
    gpu: state.gpu,
    rows: [],
    interrupted: false,
  };
  $("rows").replaceChildren();
  try {
    const cases = state.dataset.cases.filter(
      (item) => item.split === report.split,
    );
    for (const item of cases) {
      if (state.stopped) {
        report.interrupted = true;
        break;
      }
      $("summary").textContent =
        `${report.rows.length + 1}/${cases.length} · ${item.id} 평가 중…`;
      const start = performance.now();
      const row = {
        caseId: item.id,
        provenance: item.provenance,
        expected: item.expected,
      };
      try {
        await state.loaded.engine.resetChat();
        const reply = await state.loaded.engine.chat.completions.create(
          requestFor(item, report.template, state.loaded.model),
        );
        row.raw = reply.choices[0]?.message?.content || "";
        row.usage = reply.usage;
        row.finishReason = reply.choices[0]?.finish_reason;
        row.score = scoreAnswer(item, row.raw);
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      row.elapsedMs = Math.round(performance.now() - start);
      report.rows.push(row);
      const tr = document.createElement("tr");
      for (const value of [
        row.caseId,
        row.score?.exact ? "일치" : "불일치",
        row.score?.unsafeMatch ? "발생" : "없음",
        `${(row.elapsedMs / 1000).toFixed(1)}s`,
        row.error || row.score?.answer?.status || "형식 오류",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      tr.className = row.score?.exact ? "pass" : "fail";
      $("rows").append(tr);
      $("details").textContent = JSON.stringify(report, null, 2);
    }
  } finally {
    report.interrupted ||= state.stopped;
    report.summary = summarize(report.rows);
    report.finishedAt = new Date().toISOString();
    state.reports.push(report);
    state.running = false;
    state.evaluating = false;
    buttons();
    $("summary").textContent =
      `${report.split}: ${report.summary.cases}개 중 ${report.summary.exact}개 정답 일치 · 검증 거부 ${report.summary.cases - report.summary.valid}개 · 근거 부족 일치 ${report.summary.unsafeMatches}개 · 오류 ${report.summary.errors}개${report.interrupted ? " · 중단됨" : ""}`;
    $("details").textContent = JSON.stringify(report, null, 2);
  }
  return report;
}
$("load").onclick = () => load().catch(fail);
$("unload").onclick = () =>
  unload()
    .then(() => message("GPU 메모리를 해제했습니다. 모델 캐시는 유지됩니다."))
    .catch(fail);
$("delete-model").onclick = async () => {
  state.running = true;
  buttons();
  try {
    await unload();
    state.runtime ||= await import("./runtime.mjs");
    await state.runtime.deleteModelAllInfoInCache($("model").value);
    message("선택 모델의 WebLLM 캐시를 삭제했습니다.");
  } catch (error) {
    fail(error);
  } finally {
    state.running = false;
    buttons();
  }
};
$("run").onclick = () => evaluate().catch(fail);
$("stop").onclick = () => {
  state.stopped = true;
  state.loaded?.engine.interruptGenerate();
};
$("export").onclick = () =>
  download("ott-webllm-evaluation.json", {
    schemaVersion: 1,
    reports: state.reports,
  });
$("sample").onclick = () => download("ott-webllm-dataset.json", state.dataset);
$("import").onchange = async (event) => {
  try {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000)
      throw new Error("자료 파일은 1 MB 이하여야 합니다.");
    state.dataset = validateDataset(JSON.parse(await file.text()));
    preview();
    message("평가 자료를 불러왔습니다.");
  } catch (error) {
    fail(error);
  }
};
$("template").onchange = preview;
$("split").onchange = preview;
preview();
checkGPU().catch((error) => {
  $("gpu").textContent = error.message;
});
// Automation surface exists only on this standalone localhost evaluation page.
globalThis.ottEvaluation = {
  load,
  evaluate,
  unload,
  state,
  importDataset: (raw) => {
    state.dataset = validateDataset(raw);
    preview();
  },
};

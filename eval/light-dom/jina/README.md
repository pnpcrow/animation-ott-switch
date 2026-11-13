# Jina tiny q8 실행 기록

`jinaai/jina-reranker-v1-tiny-en`의 제작자 배포 q8 ONNX를 고정 revision으로 내려받았다. 33,046,273 parameters, 4층 JinaBERT/ALiBi cross-encoder이며 Apache-2.0이다. [공식 모델 카드](https://huggingface.co/jinaai/jina-reranker-v1-tiny-en)는 영어 모델과 영어 검색 평가를 제공한다. 한국어 OTT DOM에 적용한 결과는 별도로 측정해야 한다.

모델 33,424,854 B, tokenizer와 설정 포함 35,458,327 B로 이번 신경망 후보 중 실제 다운로드가 가장 작다. 파일별 SHA-256과 revision은 `model.json`에 기록했다. remote Python model code를 실행하지 않고 ONNX와 stock tokenizer 파일만 사용한다.

```powershell
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/jina/prepare.py --download
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/jina/test_contract.py
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/jina/run.py --jobs=.tmp/light-dom-development-jobs.json --output=eval/light-dom/jina/development.json --browser-jobs=.tmp/light-dom-jina/development-browser-jobs.json
```

이 명령은 기존 개발 출력을 덮어쓰므로 재현 실행은 별도 출력 경로를 사용한다. Python dependency 버전은 `../nli/requirements.txt`와 같다. 가중치는 `.tmp`에만 저장한다.

공통 field query를 첫 문장, candidate passage를 두 번째 문장으로 입력한다. raw relevance logit을 선택 점수로 사용하고 sigmoid도 보존하지만 정확도 확률로 해석하지 않는다. NLI와 동일한 384-token 예산 및 96/64/32자 명시적 tier를 사용하고 자동 잘림은 허용하지 않는다. tokenizer가 생성한 token type ID와 attention mask를 그대로 전달하고 pad ID 0을 사용한다.

개발 822개 pair는 오류 없이 실행됐다. 최대 320 tokens, 전부 96자 tier이며 `[UNK]`는 없었다. 미등록 token이 없다는 사실이 한국어 이해력을 보장하지는 않는다. native CPU field batch 중앙값은 약 100 ms, p95 약 176 ms였다. 모델 검증·tokenizer·session 로딩 합계는 약 250 ms였다. native Python working set은 시작 71 MB, 로딩 뒤 131 MB, 추론 뒤 298 MB였다. 동시 실행 작업이 있어 독립적인 속도 벤치마크로 부르지 않는다. 크기, native 시간, browser 시간, 정확도는 서로 분리해 비교한다.

global freeze 이후 `en-role`/threshold 0.40763306617736816을 유지해 새 평가 18개를 실행했다. `holdout.json`의 128개 native pair, `browser-webgpu-holdout.json`의 17개 nonempty batch 모두 오류가 없다. 후보가 없는 한 문제는 모델을 실행하지 않는다. GPU queue 1,216회가 관측됐고 일부 연산의 CPU 배정 경고도 있었다. native/browser logit 차이는 최대 0.04845이므로 브라우저 정확도를 별도 계산한다. 새 평가 browser field 첫회 p50/p95는 799/1,002 ms, 모델 로딩은 964 ms였다.

`browser-webgpu-diagnostic.json`은 개발 자료에서 첫 positive/none batch를 필드별로 골라 6개를 각각 3회 반복한 결과다. 생성 스크립트는 `scripts/light-dom-nli-probe.mjs`이며 모델 선택이나 정확도에 따라 case를 고르지 않는다. warm field batch p50/p95는 623/878 ms, 모델 로딩은 1,010 ms였고 반복 logit 차이는 0이었다.

브라우저는 Python에서 미리 토큰화한 tensor를 받는다. 브라우저 숫자에는 tokenizer 다운로드·초기화·토큰화 비용이 없으며, 시간에 DOM 후보 수집도 포함하지 않는다. 새 평가에서 격리 Chromium 전체 working set은 시작 411 MB에서 마지막 추론 시 1,116 MB가 됐다. 이는 전체 Chrome 프로세스 메모리로 모델 전용 RAM이나 물리 GPU VRAM을 뜻하지 않는다. 35 MB 다운로드만으로 실행 메모리가 가볍다고 판단할 수 없다.

WebGPU의 큰 실행 메모리를 확인한 뒤 **추가 성능 대조군**으로 WASM도 동일한 개발 6개 batch×3회와 새 평가 17개 nonempty batch×1회 실행했다. 모델, template, threshold, 입력 tensor를 바꾸지 않았으며 정확도가 좋은 provider를 사후 선택하기 위한 시험이 아니다. 결과는 `browser-wasm-diagnostic.json`, `browser-wasm-holdout.json`에 별도로 보존했다. 모두 오류 없이 완료됐고 GPU 동작은 관측되지 않았다. KURE의 혼합 WebGPU/CPU 평가와 동시에 실행했으므로 시간 수치는 CPU 경쟁 영향을 받을 수 있다. process memory는 각 격리 Chromium 인스턴스의 프로세스 합계다.

동일 개발 진단에서 WASM warm p50/p95는 828/1,317 ms, 모델 로딩은 921 ms였다. Chrome 전체 working set은 시작 410 MB, 마지막 추론 643 MB로, WebGPU 진단의 시작 409 MB/마지막 1,041 MB보다 작았다. 새 평가 WASM 첫 field p50/p95는 888/1,124 ms, 로딩 840 ms, 전체 Chrome working set은 시작 408 MB/마지막 추론 643 MB였다. native와 WASM logits 최대 차이는 새 평가에서 0.04109이므로 WASM 정답률 역시 별도 산출한다. 이 관측에서는 WASM이 실행 메모리를 줄이는 선택이지만, 측정한 머신과 tensor workload 밖으로 일반화하지 않는다.

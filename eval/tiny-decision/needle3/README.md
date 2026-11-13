# Needle 3 DOM 선택 평가

공식 `Cactus-Compute/needle3` 가중치를 공식 Cactus 4.1.0 WebAssembly 엔진에서 실행합니다. **Chromium 안의 CPU/WASM 실행이며 WebGPU나 WebLLM 실행이 아닙니다.** 기존 확장과 별도 도구이고 사용자의 브라우저 계정이나 페이지 조작을 사용하지 않습니다.

이번 설정의 독립 검증은 **4/18 정답(22.2%)이며 모두 올바른 보류**였습니다. 실제 작품 요소를 선택한 9건은 전부 틀렸습니다. 따라서 이 설정을 자동 DOM 선택에 적용할 근거는 얻지 못했습니다. 이는 아래 입력 직렬화·공식 엔진·가중치 조합의 결과이며 Needle 제품군 전체의 한계라고 일반화하지 않습니다.

## 실측 결과

[전체 원시 결과](reports/dom-selection.json)와 [날씨 도구 양성 대조군](reports/positive-control.json)에 응답, 신뢰도, 실행 시간, 고정 revision과 체크섬을 남겼습니다. 2026-11-13 Windows 11/AMD Ryzen 7 8840U/Chromium 158.0.8127.18에서 실행했습니다. 다른 모델 평가도 같은 PC에서 병행했으므로 독점 하드웨어 성능 측정은 아닙니다.

아래 네 템플릿은 같은 조정 사례 6개씩 총 24회 실행했습니다. 조정 정확도 순으로 `tool-routing`을 **10:28:15 UTC에 고정**한 뒤 작품이 겹치지 않는 독립 검증 18개를 한 번 실행했습니다.

| 조정 템플릿         | 정답 | 유효 출력 | 틀린 실제 요소 선택 |    p50 |
| ------------------- | ---: | --------: | ------------------: | -----: |
| enum-direct         |  0/6 |         0 |                   0 | 25.4초 |
| enum-structural     |  0/6 |         1 |                   1 | 33.5초 |
| tool-routing        |  1/6 |         6 |                   5 | 52.9초 |
| enum-evidence-first |  0/6 |         0 |                   0 | 27.8초 |

독립 검증의 유효 출력은 14/18입니다. 실제 요소 선택 9건은 모두 오답, 명시적 보류 5건 중 4건은 정답, 나머지 4건은 억제되거나 단일 유효 선택이 아니었습니다. 작품 요소가 있는 양성 사례는 **0/12 정답**, 보류가 필요한 사례는 **4/6 정답**입니다. 필드별 전체 정답은 제목 1/6, 이미지 1/6, 소개 2/6이며 이 정답도 모두 보류입니다.

독립 검증의 p50은 **46.5초**, p95는 **115.7초**, 최대는 **123.6초**였습니다. 로컬에 받은 파일에서 모델을 읽고 초기화하는 데 253.5ms가 들었고, 모델·JS·WASM 합계는 36,639,438 bytes입니다. 실행 오류는 0건, 브라우저의 외부 요청도 0건입니다. 차단 전 단일 제안까지 포함한 진단 정답은 5/18이지만 최종 정답 4/18과 섞지 않습니다.

조정 단계에서는 웨이브 검색결과 문서 제목을 작품 제목으로 선택하거나, 현재 작품 대신 다른 작품의 포스터 alt와 숨겨진 프로모션 이미지를 고르는 오류가 있었습니다. 올바른 소개 선택의 엔진 신뢰도는 0.2395였고 몇몇 오답은 0.25–0.39여서 이 신뢰도를 DOM 정답 확률로 사용할 수 없었습니다.

## 확인한 배포본

- 모델: `Cactus-Compute/needle3`, revision `c95d25b4efa1e9601e785d92438e4ade0dbddbf8`.
- 공식 config: `NeedleForToolCalling`, 20층, `total_parameters=121021910`, custom GQA·Hadamard MLP·engram 구조.
- 기본 배포 가중치: `needle3.cact`, **35,335,380 bytes**, SHA-256 `c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38`.
- 엔진: `Cactus-Compute/cactus`, revision `4e822c9036be2eb0e47ef556df32a818bb1572ef`, `releases/4.1.0/wasm`. WASM 1,241,811 bytes와 JS 62,247 bytes. SHA-256은 실행 스크립트에 고정합니다.
- 라이선스: [모델](https://huggingface.co/Cactus-Compute/needle3/blob/c95d25b4efa1e9601e785d92438e4ade0dbddbf8/LICENSE)·[공식 런타임](https://huggingface.co/Cactus-Compute/cactus/blob/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/LICENSE) 모두 Apache 2.0. 이 저장소는 가중치나 공식 실행 바이너리를 포함하지 않고 다운로드 주소와 체크섬만 기록합니다.

[공식 모델 소개](https://www.cactuscompute.com/needle)의 29–121M 범위는 가변 깊이 제품군을 뜻합니다. 이번 실험은 실제 배포된 위의 121M 파일 하나이며, 더 작은 깊이의 결과라고 주장하지 않습니다. 고정 revision의 파일 목록에는 Cactus 전용 `.cact`와 학습 체크포인트가 있고 ONNX·MLC 가중치는 없습니다. 이 실행에서 ONNX 변환이나 WebLLM 호환성을 확인한 것은 아닙니다.

## 실행

저장소 루트에서 실행합니다. 루트 npm 의존성과 Playwright Chromium이 필요합니다(`npm ci`, `npx playwright install chromium`). 첫 명령은 `--download-model`을 명시했을 때만 모델·엔진을 다운로드하며 고정 SHA-256을 검증합니다. 이후 파일은 `.tmp/needle3-runtime410`에 남습니다.

```powershell
node scripts/needle3-eval.mjs --download-model
node scripts/needle3-eval.mjs --positive-control --output=artifacts/needle3-positive-control.json
node --test eval/tiny-decision/needle3/templates.test.mjs
node scripts/needle3-eval.mjs --dataset=eval/tiny-decision/data/dom-selection.json --calibrate-holdout --output=artifacts/needle3-dom-evaluation.json

# CPU/WASM 시간이 제한된 재현: 필드별 양성 1개 + 명시적 보류 1개, 총 6개 조정 사례
node scripts/needle3-eval.mjs --dataset=eval/tiny-decision/data/dom-selection.json --balanced-calibration=6 --calibrate-holdout --output=artifacts/needle3-dom-evaluation.json
```

각 질문은 하나의 관측 옵션 ID를 반환하는 도구 호출로 표현합니다. `enum-direct`, `enum-structural`, `tool-routing`, `enum-evidence-first` 네 템플릿은 DOM 관계, 경쟁 요소, 불확실성에 대한 설명을 달리합니다. 작품별 정답·질문 ID·구분은 프롬프트에 넣지 않습니다. 선택한 도구 호출은 평가용 JSON으로 읽기만 하며 함수나 DOM 동작을 실행하지 않습니다.

매 질문에 `cactus_init()` 뒤 `cactus_reset()`을 호출해 이전 질문의 대화 기록이 남지 않도록 합니다. 4.1 C ABI는 스레드 수 설정을 제공하지만 공식 WASM 래퍼는 pthread·공유 메모리를 사용하지 않습니다. 실험은 한 CPU 스레드로 명시하며 이 setter를 병렬 처리나 GPU 지원으로 해석하지 않습니다.

전체 조정용 자료로 템플릿을 비교하고 공통 평가 정책으로 하나를 고정한 뒤, 그 템플릿만 독립 검증 자료에서 한 번 실행합니다. `--template=... --split=...`는 명시적으로 한 실험을 재현하는 용도입니다. 독립 검증 결과를 보고 템플릿을 수정하면 같은 자료를 새 독립 검증이라고 사용할 수 없습니다.

`--balanced-calibration=6`은 속도 예비 실행 후 사전 결정한 축소 절차입니다. 고정 자료 순서에서 각 필드의 첫 양성과 첫 명시적 보류 사례를 선택하고, 제외한 사례·선정 정책·고정 시각을 결과에 남깁니다. 예측을 보고 사례를 고르지 않습니다. 독립 검증 18개는 전부 유지하며, 이 축소 방식과 전체 30개 조정 방식의 템플릿 선택 안정성은 같다고 볼 수 없습니다.

## 해석

공식 엔진은 신경망의 생성뿐 아니라 문법 제약, 인자 근거 확인, 결정적인 인자 보정, 신뢰도 차단을 포함합니다. 따라서 이번 수치는 **공식 엔진과 모델 조합**의 결과입니다. 순수 모델의 클래스별 로짓이나 DOM 과제에 맞춰 보정한 확률은 제공하지 않습니다.

공통 자료의 문자 수는 엔진이 구성하는 전체 프롬프트의 토큰 수와 다릅니다. 특히 `tool-routing`은 질문을 각 도구 설명에 반복하고 도구 JSON 구조가 추가됩니다. 현재 WASM 응답과 C ABI는 입력 토큰 수, 사용 문맥 길이, 내부 절단 여부를 반환하지 않습니다. 공식 설정에는 `max_position_embeddings=8192`, `sliding_window=1024`, `kv_window=256`이 있지만 이 실행에서 모든 후보가 절단 없이 모델에 도달했는지는 확인할 수 없습니다. 따라서 결과를 모델의 DOM 이해 능력만의 측정으로 해석할 수 없으며, 이 직렬화·모델·엔진 조합의 실측값으로 봐야 합니다. 생성 한도는 모든 사례에서 `max_new_tokens=96`으로 고정했습니다.

`function_calls`의 단일 유효 옵션만 최종 선택으로 셉니다. 낮은 신뢰도로 `suppressed_calls`에 들어간 제안은 별도 진단으로 기록하며 정답 선택으로 바꾸지 않습니다. `rawProposalCorrect`는 그 차단 전 제안까지 포함한 별도 수치입니다. 이름에 `raw`가 있지만 신경망 원시 토큰·로짓은 아니며 엔진의 보정이 적용됐을 수 있습니다. C ABI는 인자별 보정 여부를 반환하지 않습니다. 정답을 맞히지 못한 일반적인 거부를 자동으로 정답인 `__none__` 선택으로 치환하지 않습니다.

첫 실제 브라우저 smoke에서는 로드 약 195ms, 작은 영문 DOM 질문 추론 약 4.77초가 관측됐습니다. 브랜드 요소 제안은 신뢰도 0.0109로 억제됐습니다. 이는 본 평가의 정확도나 일반 지연 수치를 대표하지 않습니다. 런타임이 출력한 `peak_ram_mb`에 음수가 관측돼 메모리 실측 지표로 사용하지 않습니다.

위 첫 smoke는 공식 README가 안내한 4.0.0 엔진으로 수행했습니다. 이후 공식 저장소의 4.1.0을 확인하고 독립 검증 전에 최종 엔진을 교체했습니다. 4.1 smoke는 같은 제안·신뢰도와 약 4.54초를 보였습니다. 버전별 부분 예비 실행은 최종 정확도 집계에 합치지 않습니다. 새로운 엔진, 명시적인 질의별 reset, 고정된 여섯 조정 사례로 최종 실험을 처음부터 실행합니다.

공식 예제와 같은 날씨 도구 양성 대조군은 `get_weather(city="Lagos")`를 억제되지 않은 호출로 반환했습니다(신뢰도 0.9742, 약 2.20초). 이 결과는 로딩·토큰화·도구 읽기가 작동한다는 확인이며 DOM 선택 정확도로 집계하지 않습니다. 날씨 서비스나 도구 함수도 실행하지 않았습니다.

공식 근거: [모델](https://huggingface.co/Cactus-Compute/needle3), [고정 모델 설정](https://huggingface.co/Cactus-Compute/needle3/blob/c95d25b4efa1e9601e785d92438e4ade0dbddbf8/config.json), [공식 런타임 플랫폼](https://huggingface.co/Cactus-Compute/cactus), [4.1 C ABI](https://huggingface.co/Cactus-Compute/cactus/blob/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.h), [공식 API·보정 동작](https://github.com/cactus-compute/cactus/blob/main/llms.txt), [독립 질의 reset 정책](https://github.com/cactus-compute/cactus/blob/main/cactus/agent/text.py).

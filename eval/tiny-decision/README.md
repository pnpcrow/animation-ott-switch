# 초경량 의사결정 모델 DOM 평가

LLM-as-Jev, Needle 3, Slayer-149M-Decision을 실제 가중치로 실행해 관측한 DOM 후보 중 작품 제목·대표 이미지·소개 요소를 선택하는 실험입니다. 확장 런타임과 분리되어 있으며, 기본 확장을 설치하거나 실행해도 모델은 다운로드되지 않습니다. 평가 중 선택된 도구나 링크를 실제로 실행하지 않습니다.

실제 DOM 수집·정답·분할·한계는 [DATASET.md](DATASET.md)에, 실측 결과는 [REPORT.md](REPORT.md)에 기록합니다. 기존 [WebLLM 평가](../webllm/README.md)와 별도 실험입니다. 기존의 후보 하나짜리 메타데이터 자료를 다중 후보 선택 정확도로 재사용하지 않습니다.

## 평가 대상

| 이름       | 이번에 실행한 정확한 배포본                                 | 실행 경로                                    |
| ---------- | ----------------------------------------------------------- | -------------------------------------------- |
| LLM-as-Jev | `Athekunal/llm-jev-qwen3-0.6b`, 596,049,920 parameters      | PyTorch CPU, float32, 4 threads              |
| Needle 3   | `Cactus-Compute/needle3`, 공식 `.cact`                      | 공식 Cactus 엔진, Chromium WASM CPU          |
| Slayer     | `SlayerLab/Slayer-149M-Decision-v1`, 149,333,081 parameters | PyTorch CPU 및 별도 ONNX Runtime WebGPU 실험 |

LLM-as-Jev는 특정 하나의 작은 모델 이름만을 뜻하지 않으므로 논문 저자가 공개한 Qwen3 0.6B 병합 가중치를 선정했습니다. 소스·가중치·런타임 revision과 SHA-256을 고정합니다. 모델의 학습 점수나 모델 카드 수치를 이 DOM 평가의 결과로 가져오지 않습니다.

Jev와 Slayer는 답변을 자유 생성하거나 첫 숫자 토큰만 비교하지 않습니다. `Best answer: [` 뒤의 각 완전한 숫자·닫는 괄호 suffix의 로그 확률 합을 비교합니다. 공유 prefix 캐시를 사용하는 최적화는 전체 시퀀스를 다시 계산하는 참조 구현과 검증합니다. 선택지 내부 softmax는 정답일 확률로 보정된 신뢰도가 아닙니다.

Needle는 자체 도구 호출 문법·인자 검증·낮은 신뢰도 차단까지 포함하는 공식 엔진으로 평가합니다. 억제된 제안은 최종 선택과 별도로 기록하고, 억제를 정답 `none`으로 바꾸지 않습니다. [Needle 실행 문서](needle3/README.md), [Slayer 실행 문서](slayer/README.md)를 참고하세요.

## 비교 절차

1. 실제 16페이지·8작품에서 후보를 수집하고 별도로 정답을 고정합니다. 태그·조상·형제·가시성·메타데이터와 후보 값을 입력합니다.
2. 같은 작품의 다른 OTT 페이지와 필드는 같은 분할에 둡니다. 조정용 4작품 30문제, 독립 검증용 4작품 18문제입니다.
3. 공통 5가지 템플릿은 최소 지시, DOM 계층, 한국어 지시, 필드별 대비, 일반적인 반례입니다. Needle는 도구 호출 형식에 맞는 4가지 템플릿을 별도로 사용합니다.
4. 조정용 점수로 템플릿 하나를 고정하고, 독립 검증 자료에서는 그 하나만 실행합니다. 모델 오류·문맥 길이 초과·잘못된 출력도 분모에 포함합니다.
5. 후보 순서 변경, CSS 클래스 변경, DOM 문맥 제거는 원본의 종속 변형으로 따로 평가합니다. 표본 수를 늘린 새로운 실제 페이지라고 세지 않습니다.
6. 모델 없는 일반 DOM 규칙을 대조합니다. 원본 관측 전체를 쓰는 기준과 모델에 전달한 압축 입력만 쓰는 기준을 분리합니다.

작은 자료의 정확도 하나로 자동 이동 허용 여부나 미래 사이트 변경 대응을 결론 내리지 않습니다. 실제 접근 차단/검색 화면의 `none` 사례가 포함되며, 공개 페이지에서 성공한 추출도 로그인 후 모달·재생 화면 전체를 보장하지 않습니다. 이 도구는 원래 확장의 검색·스위치·캐시 동작을 변경하지 않습니다.

## Jev 재현

저장소 루트에서 별도 환경을 만듭니다. `--download`는 약 1.19 GB의 가중치와 토크나이저를 명시적으로 받는 옵션입니다. 이후 실행은 로컬 파일만 읽으며 원격 모델 코드 실행을 허용하지 않습니다.

```powershell
python -m venv .tmp/tiny-decision-venv
.tmp/tiny-decision-venv/Scripts/python.exe -m pip install -r eval/tiny-decision/jev/requirements.txt
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/jev/prepare.py --download

node scripts/prepare-tiny-decisions.mjs --dataset=eval/tiny-decision/data/dom-selection.json --output=.tmp/tiny-calibration.json --split=calibration
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/jev/run.py --jobs .tmp/tiny-calibration.json --output=artifacts/jev-calibration.json
node scripts/summarize-tiny-decisions.mjs --report=artifacts/jev-calibration.json --output=artifacts/jev-selection.json --select=calibration
```

`jev-selection.json`의 `selection.template`을 아래 `TEMPLATE_ID` 대신 넣습니다. 독립 검증 점수로 다시 고르지 않습니다. `--verify-reference`는 첫 문제의 느린 전체 계산 참조 검사를 추가하며, 검사 시간은 추론 지연에서 제외합니다.

```powershell
node scripts/prepare-tiny-decisions.mjs --dataset=eval/tiny-decision/data/dom-selection.json --output=.tmp/jev-holdout.json --split=holdout --template=TEMPLATE_ID
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/jev/run.py --jobs .tmp/jev-holdout.json --output=artifacts/jev-holdout.json
node scripts/summarize-tiny-decisions.mjs --report=artifacts/jev-holdout.json --output=artifacts/jev-holdout-summary.json

node --test eval/tiny-decision/dataset.test.mjs eval/tiny-decision/metrics.test.mjs eval/tiny-decision/needle3/templates.test.mjs
```

완료된 조정 보고서에서 선택을 고정하고 독립 검증·DOM 제거·순서/클래스 변경·압축·가상 상황·저자 입력 형식 검사를 한 번에 재현하려면 `node scripts/jev-followup.mjs --calibration=artifacts/jev-calibration.json --output=artifacts/jev-followup`을 사용합니다. 저자 형식은 선택 경쟁에 넣지 않는 고정 제어 실험입니다. 보고서 디렉터리에 기존 선택 기록이 있으면 동일한 원본의 고정 시점을 보존합니다. 모델을 받지 않는 계약 검사는 `npm run test:decision-eval`로 실행할 수 있습니다.

## 근거

- [LLM-as-Jev 논문](https://arxiv.org/abs/2610.02076), [저자 코드](https://github.com/Athe-kunal/llm-as-jev), [저자 체크포인트](https://huggingface.co/Athekunal/llm-jev-qwen3-0.6b)
- [Needle 3 공식 모델](https://huggingface.co/Cactus-Compute/needle3), [Cactus 공식 런타임](https://huggingface.co/Cactus-Compute/cactus)
- [Slayer 공식 모델·아키텍처](https://huggingface.co/SlayerLab/Slayer-149M-Decision-v1)

평가 데이터의 작품 문구·이미지 주소는 각 출처의 자료이며 저장소 코드 라이선스가 해당 자료의 이용 권리를 새로 부여하지 않습니다. 가중치, 미디어 바이너리, 브라우저 프로필, 원본 HTML, Python 환경은 Git에 포함하지 않습니다.

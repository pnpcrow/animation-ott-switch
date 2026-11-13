# Chrome용 경량 DOM 모델 평가

목표는 관측한 DOM 후보에서 현재 열린 작품의 제목·대표 이미지·작품 소개를 고르는 것입니다. 이번에는 긴 응답을 생성하는 모델 대신 **후보별 점수를 계산하는 encoder 모델 3개와, DOM 특징에 학습한 아주 작은 선형 모델**을 실제 실행합니다. 확장 프로그램의 기본 실행 경로와 의존성은 바꾸지 않습니다.

[조사 근거](RESEARCH.md), [최종 결과](RESULTS.md), [데이터 수집과 주석](DATASET.md)을 구분합니다. 원본 모델·토크나이저·중간 ONNX 가중치는 `.tmp`에만 두고 Git에 올리지 않습니다. 직접 학습한 174개 계수의 구조 모델은 6,540바이트여서 [structural-model.json](structural-model.json)에 보관합니다.

## 실측 대상

| 모델 | 역할 | 실제 준비한 파일 |
| --- | --- | --- |
| KURE-Reranker-nano | 한국어/영어 query–candidate 관련도 | 공식 가중치에서 MatMul·Gather를 q8로 변환한 ONNX 151,093,062 B |
| multilingual MiniLMv2-L6 NLI | 후보 관측과 필드 역할 가설의 entailment/contradiction 점수 | ONNX q8 107,415,176 B; tokenizer·설정 포함 124,501,247 B |
| Jina reranker v1 tiny en | 영어 query–candidate 관련도, 50 MB 미만 대조 | ONNX q8 33,424,854 B; tokenizer·설정 포함 35,458,327 B |
| DOM 선형 ranker | 명시적 DOM/문자열 형태 특징의 학습 가중치 | 가중치·특징명·메타데이터 6,540 B, 표준 JavaScript 실행 |

파일 200 MB 이하를 초기 탐색 기준으로 삼았지만, 이 기준이 실행 RAM이나 지연을 보장하지 않습니다. 신경망의 입력은 전체 HTML tree가 아니라 관측된 후보와 주변 문맥입니다. 세 공개 모델은 OTT DOM 역할 분류로 학습된 모델이 아니므로, 관련도·NLI 능력을 그대로 DOM 정확도로 간주하지 않습니다. 영어 Jina 모델의 tokenizer가 한국어 문자를 처리해도 한국어 의미 이해가 검증되는 것은 아닙니다.

## 입력과 설정 선택

`templates.mjs`는 v2의 관측 feature pack을 재사용합니다. 페이지 제목·경로·heading·dialog와 후보의 태그·속성·부모·가시성·alt·크기·주변 텍스트를 제공합니다. 평가용 ID·정답·provenance는 모델 문장에 들어가지 않습니다. 후보 ID는 입력/출력 연결용 별도 메타데이터입니다. 페이지 호스트와 쿼리 값, CSS 클래스는 관측 표현에서 제외합니다.

영문·한국어 역할 정의 두 가지를 개발 자료에서 비교합니다. KURE/Jina는 `query, passage`, NLI는 `premise, hypothesis` 순서를 지킵니다. tokenizer가 실제 계산한 전체 길이가 **384토큰 이하**인 첫 96/64/32자 텍스트 tier를 사용하고, 모두 초과하면 명시적으로 실패합니다. 후보를 없애거나 조용히 tokenizer truncation을 적용하지 않습니다.

후보별 raw logit을 계산한 뒤 개발 자료에서 고른 단일 threshold보다 가장 높은 후보 점수가 낮으면 `none`으로 보류합니다. NLI는 entailment logit minus contradiction logit을 사용합니다. 동일 최고점도 보류하며 후보 하나라도 추론에 실패하면 그 문제를 실패로 남깁니다. 점수를 보정된 정답 확률이라고 부르지 않습니다.

기존에 이미 확인한 66문제는 모두 개발 자료입니다. 모델마다 두 template와 threshold를 개발 정확도 → 잘못된 선택 수 → 양성 정답 수 → 고정된 tie break로 고릅니다. 개발 자료의 최선 점수는 신규 성능이 아닙니다. 모델 개발·설정 선택 담당은 [freeze.json](freeze.json)을 기록한 **2026-11-13 13:14:48 UTC** 이후에만 새 작품의 후보·정답·결과를 열었습니다. 별도 수집·주석 담당은 그 전에 실제 자료를 검수했습니다. 6페이지의 새 18문제 중 후보가 없는 이미지 1개는 자동 `none`이므로 전체18과 비자명17을 나눠 보고합니다.

## 6.5 KB 구조 모델

`structural.mjs`는 태그/속성/부모/가시성/메타데이터, 페이지 종류를 시사하는 경로·문구, 제목과 heading의 동등성, 이미지 크기·방향, 문장 길이·홍보/회차/로고 등 일반적인 형태 신호를 사용합니다. 작품명 사전, 호스트, CSS 선택자, 후보 순서, 주석된 정답 역할은 특징으로 넣지 않습니다. 특징 자체는 사람이 설계했으므로 완전히 자율적인 DOM 이해 모델이라고 표현하지 않습니다.

필드별 가중치를 학습하는 총 174개 특징의 listwise 선형 ranker입니다. 정답이 여러 개면 허용 정답 집합의 확률 합을 최대화합니다. 학습은 별도 오프라인 단계이며 브라우저에서는 특징 계산·내적·정렬만 실행합니다. `none`도 후보로 학습하고 동점이면 보류합니다.

정규화 강도는 개발 자료의 **작품/비작품 그룹 14개**를 5개 fold로 나눠 선택합니다. 같은 작품의 필드는 같은 fold에 유지합니다. 실제 작품은 12개이고 비작품 그룹이 2개입니다. 선택용 교차검증은 51/66, 전체 개발 자료에 다시 학습한 후 같은 자료의 점수는 65/66입니다. 후자는 재학습 자료 점수이므로 일반화 정확도로 쓰지 않습니다. 신규 자료를 본 뒤 특징·계수·threshold를 조정하지 않았습니다.

## 재현

모델이 필요 없는 계약 검사:

```powershell
npm run test:light-dom
node scripts/prepare-light-dom.mjs --output=.tmp/light-dom-development-jobs.json
node scripts/train-light-dom.mjs
```

위 학습 명령은 모델 메타데이터 시각을 다시 쓰므로 저장된 잠금과 다른 파일이 됩니다. 기존 실험을 검증할 때는 체크인된 가중치를 사용하고, 새 학습을 시작할 때만 별도 작업 사본에서 실행합니다. 입력 생성은 정답 파일을 읽지 않습니다. 모델별 설치·다운로드·추론 명령은 [NLI](nli/README.md), [Jina](jina/README.md), [KURE/브라우저 런타임](runtime/README.md)에 있습니다. 다운로드는 명시적인 준비 명령으로만 수행합니다.

완료된 native 개발 보고서의 설정을 선택할 때:

```powershell
node scripts/select-light-dom.mjs --report=eval/light-dom/nli/development.json --output=artifacts/nli-selection.json
```

`scripts/freeze-light-dom.mjs`는 세 신경망 선택과 구조 모델·입력·특징 소스를 잠그고, 기존 잠금을 덮어쓰지 않습니다. 신규 native/browser 입력 원본은 [plans](plans/)에 보관합니다. 고정 template의 새 입력을 준비하고 해당 모델 runner를 실행한 뒤 `node scripts/report-light-dom.mjs`로 원시 출력에서 다시 채점할 수 있습니다. 평가 JSON은 `.gitattributes`에서 자동 줄바꿈 변환을 끄고 바이트 해시를 유지합니다.

구조 모델의 브라우저 측정:

```powershell
node scripts/light-dom-structural-browser.mjs --inputs=eval/light-dom/data/holdout-inputs.json --output=artifacts/structural-browser.json
```

이 측정은 관측 객체에서 feature pack을 만드는 시간부터 선택까지 포함하며, 실제 사이트 DOM 수집·이미지 로딩은 제외합니다. 신경망 브라우저 측정은 사전 tokenized tensor를 받으므로 tokenizer의 시간과 메모리가 제외됩니다. 두 수치를 전체 OTT 기능 지연으로 직접 비교하지 않습니다.

## 브라우저 비용의 해석

ONNX Runtime Web 1.31.1을 별도 평가 의존성으로 사용합니다. 실제 GPU queue와 compute pipeline을 계측하고, CPU와 GPU가 섞이는 경로를 순수 GPU 실행처럼 표현하지 않습니다. native q8와 browser q8도 logits가 달라질 수 있어 **브라우저의 실제 출력에 동일 threshold를 적용해 별도 채점**합니다.

기록한 메모리는 격리된 Chromium 프로세스 집합의 RSS/working set, private bytes, JS heap, 명시적으로 생성한 GPU 버퍼 크기입니다. 서로 같은 개념이 아니며 합산하지 않습니다. GPU 누적 할당량은 peak가 아니고, 논리적 버퍼 크기는 물리 VRAM 측정이 아닙니다. 한 대의 개발 노트북에서 다른 작업이 병행된 관측값으로 저사양 장치나 확장 offscreen worker의 메모리를 보장하지 않습니다. 브라우저 자체의 시작 메모리와 증가량을 함께 읽어야 합니다.

현재 평가 범위는 작품 화면의 요소 선택입니다. 검색 결과에서 같은 작품을 찾는 작업, 시즌/리메이크 구분, 실제 이동 성공률, 로그인·재생·모달 전환 전체 흐름은 별도 검증이 필요합니다.

# 확대 DOM 자료의 학습·경량화 실험

이번 학습은 새로 수집한 자료만 사용합니다. 과거 84문제와 과거 DOM 파인튜닝 가중치를 재사용하지 않고, 고정 revision의 원본 KoELECTRA-Small-v3에서 다시 시작합니다. Netflix와 Apple TV는 파인튜닝 자료에 넣지 않습니다. 독립 수집 담당이 예약한 작품/family 키 16개의 SHA256도 검사하며, 그 작품의 검색·로그인·차단 관측도 학습에 섞이지 않도록 합니다.

## 사전 고정한 세 조건

| 이름 | Encoder | 관측 표현 | 최대 토큰 |
| --- | --- | --- | ---: |
| `full-natural` | 원본 12층, 14,056,449계수 | 기존 한국어 자연어 DOM 표현 + 실제 media 관측 | 384 |
| `full-compact` | 같은 12층·같은 최초 head | 짧은 필드 질의 + 구조화한 DOM 관측 | 160 |
| `small-compact` | 원본 0-based 층 `[2,5,8,11]`을 가져온 4층, 7,738,369계수 | `full-compact`와 동일 | 160 |

`full-natural`과 `full-compact`는 문자열 표현·정보 압축·토큰 예산이 함께 달라집니다. 길이만의 단일 변수 실험은 아닙니다. `full-compact`와 `small-compact`는 같은 입력, 최초 head, optimizer와 학습 횟수로 깊이를 비교합니다. 4층은 원본 일부 층으로 초기화한 뒤 전체 계수를 학습하는 방식이며, 별도 교사 손실을 사용한 증류는 아닙니다.

각 조건은 동일한 고정 seed `20261114`, 3 epoch, AdamW, encoder learning rate `2e-5`, head learning rate `1e-3`, weight decay `0.01`, gradient clip `1.0`을 사용합니다. 한 optimizer step에서 한 필드의 전체 후보를 함께 넣어 허용 정답 집합의 확률 합을 높입니다. `none`도 명시적인 결과 선택지로 학습합니다. 후보가 `none` 하나뿐인 문제는 학습 gradient가 없음을 기록하고 건너뜁니다.

## 입력 계약

모델 입력에는 관측한 제목·heading·대화상자 수, 후보 태그/속성/텍스트, 조상 태그/역할, 가시성·inert·dialog, 이미지 alt/크기/주변 제목과 실제 관측한 동영상 수·재생 수·fullscreen을 넣습니다. 페이지 종류 주석, 작품/provider ID, 정답, CSS 클래스, 후보 순서는 모델 문장에 들어가지 않습니다. `compact`는 관측하지 않은 boolean을 거짓/보임으로 바꾸지 않고 `미확인`으로 보존합니다. 동영상이 재생된다는 사실만으로 전체 재생 화면이라고 미리 분류하지 않습니다.

한국어 tokenizer가 직접 계산한 길이에 따라 96/64/32/16/8자 tier 중 처음 맞는 표현을 사용합니다. 토큰 제한 때문에 후보를 삭제하거나 tokenizer의 자동 truncation을 사용하지 않습니다. 모든 tier가 초과하면 평가에서는 해당 문제를 오류로 유지합니다. 이 입력은 전체 DOM tree가 아니며 공통 조상 ID·형제 관계를 없는 관측에서 만들어내지 않습니다.

## 자료와 개발 분할

`assemble-data.mjs`는 60페이지/180문제의 초기 코호트와 추가 20페이지/60문제를 원래 ID 그대로 합칩니다. [data/manifest.json](data/manifest.json)에 네 입력/정답 원본의 hash를 보관합니다. 모델의 입력 생성은 정답 파일을 읽지 않습니다.

최종 원본은 **80페이지·240문제**입니다. 수집 담당이 표시한 중복·누락과, 같은 서비스에서 세 필드 전체의 모델 관측 표현이 동일한 비작품 페이지를 학습에서 제외합니다. 전체 비작품 페이지 중복은 canonical 페이지 하나만 유지하고 원본 시도/정답은 삭제하지 않습니다. 한 필드만 generic하게 같은 검색 페이지는 유지하고 중복 진단에만 표시합니다. 이는 원본 HTML이 완전히 같다는 주장과 다릅니다.

30문제를 명시적으로 제외한 **210문제**를 작품/family 그룹 기준으로 학습153·개발검증57로 나눴습니다. 실제 작품 필드는 각각65·24개입니다. 같은 작품의 상세·모달·검색·재생/접근 제한 관측과 세 필드는 같은 분할에 남습니다. 명시적 작품 대상이 없는 `none-*` 그룹은 페이지 단위로 묶습니다. SHA256 순서에서 매 다섯 번째 그룹을 검증에 쓰며 예측 결과로 분할을 바꾸지 않습니다. 이 검증 점수는 설정 선택용 개발 점수이며 새 holdout 성능이 아닙니다.

정답이 후보 수집/첫12개 pool 밖에 있으면 `none`을 정답으로 바꾸지 않습니다. 학습에서는 이유와 원 정답 ID를 남기고 제외합니다. 여러 허용 정답 중 일부가 pool 안에 있으면 그 교집합으로 학습합니다. 독립 holdout의 후보 누락은 어떤 모델 선택도 정답이 될 수 없는 end-to-end 실패로 분모에 남깁니다.

## 선택과 잠금

최종 epoch의 개발검증 정답 수가 큰 순서, 오선택이 적은 순서, 모델 계수가 적은 순서, recipe ID 순서로 한 조건을 선택합니다. 세 조건 모두 holdout에 보고해 정확도 우선 후보와 경량 후보의 tradeoff를 확인합니다. holdout을 본 뒤 템플릿·학습 횟수·모델·threshold를 다시 고르지 않습니다. `design.json`은 학습 전에 소스·자료·분할·선택 규칙을 고정하고, `model-freeze.json`은 학습 결과와 세 checkpoint hash를 고정합니다.

## 실행과 재현

```powershell
node eval/dom-scale/model/assemble-data.mjs
node eval/dom-scale/model/prepare-inputs.mjs --inputs=eval/dom-scale/model/data/inputs.json --output=.tmp/dom-scale/model/plans
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/model/test_contract.py
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/model/train.py --inputs eval/dom-scale/model/data/inputs.json --labels eval/dom-scale/model/data/labels.json --plans .tmp/dom-scale/model/plans --reserved-work-hashes eval/dom-scale/holdout/reserved-work-hashes.json
.tmp/slayer-venv/Scripts/python.exe eval/dom-scale/model/export.py --plans .tmp/dom-scale/model/plans --labels eval/dom-scale/model/data/labels.json
```

완료된 `training.json`이 있으면 재학습 명령은 덮어쓰기를 거부합니다. 새 학습은 별도 작업 사본에서 수행합니다. 가중치는 `.tmp`에만 저장하며 확장 프로그램의 기본 실행 경로를 변경하지 않습니다. 이전 평가 환경의 고정 의존성은 [기존 requirements](../../dom-adaptation/finetune/requirements.txt)를 사용합니다.

ONNX export는 fp32와 PyTorch를 batch1/2/13과 여러 동적 길이에서 비교합니다. MatMul/Gather를 q8로 양자화한 후 개발검증의 실제 출력을 재채점합니다. 전체 후보 batch와 microbatch2도 각각 점수를 기록합니다. microbatch는 오른쪽 padding만 제거하며 실제 관측 내용을 자르지 않습니다. 동적 양자화는 batch에 따라 logits가 달라질 수 있으므로 같은 선택인지 직접 검사합니다.

브라우저 계획에는 case/candidate ID 연결, batch tensor, 원시 native reference, 실제 사용한 query/passage와 padding 없는 token/attention/type ID를 함께 넣습니다. `none`만 있는 문제는 `autoCases`로 분리하며 모델 추론 능력처럼 세지 않습니다. root의 브라우저 runner는 실제 tokenizer 결과와 tensor parity, worker 실행, 자원 비용을 별도로 측정합니다. Python native 타이밍을 Chrome 성능으로 보고하지 않습니다.

`predict.py`는 독립 평가 담당이 모델 잠금 및 root runtime 잠금 이후 실행합니다. 관측 입력만 읽고 정답은 읽지 않으며, 세 조건의 full/micro2 원시 점수와 브라우저 계획을 내보냅니다. 평가 담당이 별도의 정답 파일로 채점합니다.

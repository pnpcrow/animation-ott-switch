# DOM 의사결정 템플릿 2차 평가

이 실험은 앞선 결과가 모델의 한계인지, DOM 표현과 질문 설계의 한계인지 구분하기 위해 진행합니다. 모델 가중치를 바꾸거나 미세조정하지 않고 관측 정보·직렬화·필드별 기준·대비 예시·선택지 편향을 검토합니다. 확장 프로그램의 기본 실행 경로에는 모델이나 다운로드 기능을 추가하지 않습니다.

최종 결과는 [REPORT.md](REPORT.md), 자료 수집·정답 기준은 [DATASET.md](DATASET.md), 모델별 세부 기록은 [Needle](needle/README.md)와 [Slayer](slayer/README.md)에 있습니다. 모델 revision·실행 환경은 원시 JSON 보고서에 포함합니다.

## 입력 설계

`features.mjs`는 정답, 작품 ID, CSS 클래스, 사이트별 정답 규칙을 전달하지 않습니다. 관측된 후보 값·태그·속성, 부모 역할, 앞뒤 텍스트, 주변 제목, 숨김·내비게이션·inert 상태, 이미지 alt·크기, 다이얼로그 위치를 압축합니다. 페이지에는 제목·경로·보이는 heading·다이얼로그 개수를 제공합니다. URL 쿼리 값과 호스트는 페이지 요약에서 제외합니다.

정보가 없는 크기는 `null`로 유지합니다. 기존 HTML에서 후보를 다시 찾을 때 경로·태그·속성·값의 일치가 유일한 경우에만 정보를 보강합니다. DOM 순서상 마지막으로 보이는 다이얼로그는 실제 포커스나 최상위 z-index를 뜻하지 않습니다. DOM을 완벽하게 이해했다고 가정하지 않습니다.

여섯 기본 템플릿은 같은 feature pack에서 출발하되 **표현과 보존하는 정보가 다릅니다**. JSON은 false 값과 후보 자체의 role을 보존하고, 간결한 문장·fact 행은 일부 속성을 생략합니다. 따라서 순수한 지시문 문구만 비교하는 실험은 아닙니다.

| 템플릿 | 설계 |
| --- | --- |
| `legacy-enriched` | 이전 DOM 계층 지시문에 보강된 관측을 간결한 행으로 제공 |
| `field-rubric` | 제목·대표 이미지·작품 소개를 각각 정의하고 제외 기준 명시 |
| `contrast-example` | 가상 작품의 정답/오답 대비 예시 추가 |
| `json-evidence` | 속성 관계와 알려진 false 값을 JSON으로 전달 |
| `natural-evidence` | 태그·위치·이미지 속성을 짧은 문장으로 표현 |
| `scope-first` | 작품 화면 여부 → 영역 범위 → 필드 판별 순서 제시 |
| `scope-contrast` | 개발 오류를 반영해 검색 카드와 열린 작품의 차이를 예시로 설명 |
| `field-worked` | 위 예시와 함께 제목 장식·로고/표지·한국어 홍보/줄거리/회차 설명의 대비 추가 |

마지막 두 개는 Jev 개발 실험 2차에서 추가했습니다. Slayer는 처음 여섯 개를 비교하며, Needle는 공식 도구 호출 형식에 맞춘 네 가지 스키마를 비교합니다. 모든 모델이 같은 수의 설계를 탐색한 모델 순위표로 해석하지 않습니다.

## 선택과 검증

1. 이미 결과를 확인한 기존 48문제는 전부 **개발 자료**로 재분류합니다. 과거 holdout을 새 독립 검증으로 재사용하지 않습니다.
2. 제목·이미지·소개 × 실제 후보 존재/없음마다 2개씩, 총 12문제를 예측값과 무관하게 추립니다. 두 번째 자료는 다른 서비스·작품을 우선합니다.
3. Jev는 기본 6개와 개발 오류로 설계한 2개를 선별하고, 상위 2개를 전체 48문제에 적용합니다. Slayer도 기본 6개에서 상위 2개를 전체 48문제에 적용합니다. 완전히 동일한 프롬프트의 기존 추론은 재사용하며 별도 호출 수와 구분합니다.
4. Slayer는 후보별 적합/부적합 질문과 답 순서를 반대로 한 질문의 점수 평균도 개발 12문제에서 시험합니다. 단일 threshold는 개발 자료에서만 정하고, 사전에 정한 양성 정답 조건과 always-none 기준을 넘어야 신규 검증으로 진행합니다.
5. 모델별 선택과 pointwise 진행 여부를 모두 고정한 뒤 `global-freeze.json`을 기록합니다. 이후에만 새 4작품·6페이지·18문제의 내용과 예측 결과를 엽니다. 새 정답은 별도 에이전트가 모델 실행 전에 주석을 작성했습니다.
6. Jev와 Slayer는 같은 신규 18문제에서 기존 v1 방식, `legacy-enriched`, 선택된 새 템플릿을 실행합니다. Needle는 신규 18문제와 기존 방식의 고정된 균형 부분집합 6문제를 실행해 같은 6개끼리 비교합니다.
7. 후보 순서 변경은 원본의 종속 진단입니다. 새 페이지 수로 세지 않고 원래 후보 ID의 선택 유지율을 봅니다. 오류·예산 초과·엔진 억제도 전체 문제 수에서 빼지 않습니다.

Jev/Slayer 선택은 정확도 → 잘못된 후보 선택 수 → 유효 출력 수 → 템플릿 ID 순으로 정합니다. 동시 실행과 결과 재사용 때문에 지연시간을 선택 기준으로 사용하지 않습니다. Needle는 기존 선택기의 지연시간 동률 기준을 유지했으며 이번 승자는 정확도에서 단독 1위였습니다.

`legacy-enriched`는 입력 보강의 유용성을 살펴보는 비교 조건이지 완전한 단일 변수 실험은 아닙니다. Jev v2에서는 저자 형식처럼 사용자 턴 말미의 개행을 정리합니다. Slayer의 v1 승자는 한국어·1-based이고 `legacy-enriched`는 영문·0-based이므로 관측·지시·번호 체계도 함께 달라집니다. 실제 v1 대조군은 이전 runner와 프롬프트를 그대로 사용합니다.

## 재현

가중치와 별도 환경 설치는 [v1 README](../README.md)를 따릅니다. 아래 계약 검사는 모델을 받거나 외부 사이트를 호출하지 않습니다.

```powershell
npm run test:decision-eval-v2
node scripts/prepare-v2-jobs.mjs --sample=screen --output=.tmp/v2-screen.json
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/v2/run_jev.py --jobs .tmp/v2-screen.json --output=artifacts/jev-v2-screen.json
node scripts/prepare-v2-jobs.mjs --sample=screen --templates=scope-contrast,field-worked --output=.tmp/v2-refined-screen.json
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/v2/run_jev.py --jobs .tmp/v2-refined-screen.json --output=artifacts/jev-v2-refined-screen.json
node scripts/select-v2-templates.mjs --reports=artifacts/jev-v2-screen.json,artifacts/jev-v2-refined-screen.json --output=artifacts/jev-v2-screen-selection.json --count=2
```

상위 두 템플릿을 `--templates=`로 지정해 48개 전체 jobs를 만든 뒤 같은 runner의 `--reuse=`에 완료된 선별 보고서를 지정할 수 있습니다. 최종 선택 시 `--expected=`에 계획 jobs를 넘겨 모든 예정 문제의 출력을 요구합니다. 잠긴 선택은 다른 결과로 덮어쓸 수 없습니다. `scripts/freeze-v2.mjs`는 저장된 세 모델 선택과 원본의 해시를 모아 전체 잠금을 생성하며 기존 잠금을 덮어쓰지 않습니다.

고정된 선택을 재현하는 신규 검증 명령은 다음과 같습니다. 재현 점수로 템플릿을 다시 고르지 않습니다.

```powershell
node scripts/prepare-v2-jev-validation.mjs --output=.tmp/jev-v2-validation.json
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/v2/run_jev.py --jobs .tmp/jev-v2-validation.json --output=artifacts/jev-v2-validation.json
node scripts/prepare-v2-legacy.mjs --model=jev --output=.tmp/jev-v1-fresh.json
.tmp/tiny-decision-venv/Scripts/python.exe eval/tiny-decision/jev/run.py --jobs .tmp/jev-v1-fresh.json --output=artifacts/jev-v1-fresh.json
```

토큰 예산은 후보를 삭제하는 방식으로 맞추지 않습니다. Jev는 4096, Slayer는 2048 토큰 안에 들어오는 첫 96/72/48/32자 tier를 사용하며 마지막 tier도 초과하면 실패로 셉니다. Needle는 공식 런타임의 내부 토큰 수가 노출되지 않아 ABI에 전달하는 문자열 길이와 UTF-8 바이트를 별도로 기록합니다.

이 실험은 작품 화면의 **요소 선택**을 평가합니다. 검색 결과의 동일 작품 판정·시즌/리메이크 구분·실제 자동 이동 성공률은 측정하지 않습니다. 모델 softmax나 엔진 점수도 보정된 정답 확률로 취급하지 않습니다. 지연시간은 CPU를 공유한 개발 세션의 관측값이며, WebGPU 성능 비교나 모바일 배터리 측정이 아닙니다.

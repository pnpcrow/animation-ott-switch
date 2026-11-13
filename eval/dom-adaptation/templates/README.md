# NLI 입력 표현·역할 가설 비교

이 실험은 **같은 모델과 DOM 관측 자료에서 입력 표현을 바꾸면 어떤 오류가 달라지는지** 확인합니다. NLI는 chat instruction을 수행하는 모델이 아니므로 긴 지시문이나 few-shot 대화를 붙이는 대신, 관측을 담은 premise와 검증할 선언형 hypothesis를 나눴습니다. 모델은 기존의 고정된 multilingual MiniLMv2-L6 NLI q8 ONNX를 그대로 사용합니다. 기존 `eval/light-dom`의 잠긴 실험 파일은 수정하지 않았습니다.

## 바꾼 것과 고정한 것

| 템플릿 | premise | hypothesis |
| --- | --- | --- |
| `en-natural` | DOM 관측을 영어 자연문장으로 표현 | 기존 영문 단문 역할 가설 유지 |
| `en-anchored` | 같은 영어 관측 | 관측된 후보 값을 포함해 현재 작품의 역할인지 주장 |
| `en-contrast` | 같은 영어 관측 | 작품 전체와 회차·추천·서비스·법률 문구의 구분을 선언형 가설에 포함 |
| `ko-natural` | 같은 관측을 한국어 자연문장으로 표현 | 한국어 역할 가설 |

태그 `h1`을 “level 1 heading”으로 읽는 것처럼 표준 HTML 의미를 풀어 썼지만, 관측을 정답 역할로 미리 분류하지는 않습니다. 작품명 사전, 서비스별 CSS, 정답·provenance, 후보 번호는 모델 입력에 넣지 않습니다. `none`은 이전 실험과 동일하게 후보 최고점과 global threshold로 결정하며 NLI 입력 후보로 추가하지 않습니다. 모델 추론 점수는 entailment logit minus contradiction logit이고, 정답 확률이 아닙니다.

기존 feature pack의 페이지 제목·경로·가시 heading·dialog 수와 후보의 태그·속성·조상·alt·크기·주변 텍스트를 유지합니다. 총 입력 384토큰, 후보 텍스트 96/64/32자 tier 중 tokenizer가 계산한 첫 적합 tier를 사용합니다. 후보 삭제나 조용한 tokenizer truncation은 없습니다. 4개 템플릿 전체가 동일한 후보 집합을 봅니다.

`featurePack`은 전체 DOM tree를 보존하지 않습니다. 페이지 제목 120자, visible heading 최대 2개, 조상 최대 3개, 주변 텍스트 제한이 있고 일부 미관측 boolean은 false와 합쳐집니다. 후보 점수화는 다른 후보와의 직접 비교도 하지 않습니다. 이번 입력 표현 비교는 이러한 제약까지 해결한 실험이 아닙니다.

## 결과

이전 66문제에서 각 템플릿의 global threshold를 선택하고, 기존과 같은 정확도→오선택 수→양성 정답 수 기준으로 템플릿을 선택했습니다. 이전에 이미 결과를 본 18문제는 **회고 비교**로만 사용합니다. 84개 모두 이미 소비된 관측이므로 신규 일반화 검증으로 주장하지 않습니다. 18개는 6페이지의 3필드이고, 그중 후보 없는 이미지 1개는 자동 `none`입니다.

| 조건 | 개발 정답 /66 | 회고 정답 /18 | 비자명 회고 /17 | 회고 작품 정답 /12 | 회고 없음 정답 /6 | 회고 오선택 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 기존 JSON `ko-role` | 21 | 7 | 6 | 1 | 6 | 1 |
| **개발로 선택된 `en-natural`** | **27** | **6** | **5** | **5** | **1** | **11** |
| `en-anchored` | 22 | 6 | 5 | 1 | 5 | 4 |
| `en-contrast` | 25 | 7 | 6 | 4 | 3 | 8 |
| `ko-natural` | 22 | 5 | 4 | 2 | 3 | 10 |

개발에서 `en-natural`을 선택한 threshold는 `1.371482402086258`입니다. 개발 자료의 작품 정답은 18/47, 없음 정답은 9/19입니다. 회고 결과를 본 뒤 `en-contrast`로 다시 선택하지 않았습니다. 각 템플릿의 threshold도 개발 자료에서만 정했습니다.

새로 선택된 설정에서는 실제 작품 필드 선택이 늘었지만, 비작품 화면의 잘못된 선택도 크게 늘었습니다. 기존 선택과는 입력 표현뿐 아니라 언어·가설·threshold도 달라, 이 차이를 표현 하나의 효과로 분리할 수 없습니다. **판단 양상의 변화는 확인했으나, 이번 설정에서 전체 정확도가 개선됐다고 결론내릴 수 없습니다.** 입력 문장만으로 NLI의 언어 추론 과제를 DOM 역할 학습으로 대체하기는 부족했습니다. 다만 이 4가지 표현이 가능한 모든 템플릿을 대표하거나 파인튜닝의 효과를 보여주는 것은 아닙니다.

최종 실행은 개발 264개 case·1,644개 후보와 회고 72개 case·512개 후보를 모두 완료했고 추론/토큰 예산 오류는 0입니다. native ONNX Runtime CPU 2 thread로 실행했으며 이번 변형을 Chrome에서 재측정하지는 않았습니다. `comparison.json`의 실행 시간은 후보별 배치 분담 시간을 합산한 native 측정이고, 기존 브라우저 실측과 혼동하지 않습니다.

## 관측 문구 수정 이력

초기 실행 뒤 검토에서 비이미지 요소의 렌더 크기까지 “이미지 크기”라고 표현하는 오류를 발견했습니다. `img`만 이미지, 나머지는 요소 크기로 영어·한국어 문구를 바로잡고 모든 개발·회고 추론을 다시 실행했습니다. 그때 초기 개발 선택 `en-natural`, 27/66이 이미 한 번 출력된 상태였고, 초기 18문제 실행은 완료됐지만 채점 전이었습니다. 수정 이유는 관측의 정확성이며 템플릿 종류나 hyperparameter를 추가 탐색하지 않았습니다.

수정 전 소스·입력·원시 출력·선택은 `.tmp/dom-adaptation/templates/pre-dimensions-fix`에 보관했고, [revision-history.json](revision-history.json)에 그 바이트 해시와 이력을 기록했습니다. 현재 표와 체크인된 보고서는 모두 수정 후 실행입니다. 모델 학습용으로 공유한 `naturalPassage`도 수정 후 버전을 고정했습니다.

## 파일과 재현

- [templates.mjs](../templates.mjs): 모델이 보는 관측 표현과 가설.
- [plans](plans/): 이번 실행에 실제 사용한 두 원본 jobs JSON. `preparedAt`을 포함해 바이트 그대로 보관합니다.
- [development.json](development.json), [retrospective.json](retrospective.json): 모델/입력/소스 해시와 후보 단위 raw logits, tokenizer tier, timing.
- [selection.json](selection.json): 개발에서 정한 템플릿·threshold, 소스와 입력/출력 해시.
- [comparison.json](comparison.json): 고정 설정으로 채점한 모든 선택과 요약.

모델 없는 검사와 저장된 결과 재채점:

```powershell
node --test eval/dom-adaptation/templates.test.mjs
node eval/dom-adaptation/templates/run.mjs report
```

고정 입력의 실제 추론을 별도 출력으로 재실행하려면 기존 평가용 Python 환경과 [NLI 모델 준비 절차](../../light-dom/nli/README.md)를 사용합니다. 모델 다운로드나 remote model code 실행은 자동으로 하지 않습니다.

```powershell
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/nli/run.py --jobs eval/dom-adaptation/templates/plans/development-jobs.json --output .tmp/dom-adaptation/templates/replay-development.json --threads 2
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/nli/run.py --jobs eval/dom-adaptation/templates/plans/retrospective-jobs.json --output .tmp/dom-adaptation/templates/replay-retrospective.json --threads 2
```

새 실험을 시작하는 경우에만 `run.mjs prepare-development` → native 개발 실행 → `run.mjs select` → `run.mjs prepare-retrospective`를 사용합니다. 새 계획은 `.tmp/dom-adaptation/templates`에 생성되며 timestamp/hash가 바뀝니다. 새 결과를 고정할 때는 해당 실행의 exact jobs를 `plans`에도 보존해야 합니다. 체크인된 선택이나 소스를 자동 포맷해 해시를 변경하면 기존 실행 검증이 의도적으로 실패합니다.

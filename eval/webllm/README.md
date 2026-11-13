# 선택형 WebLLM 평가 도구

확장 프로그램과 분리된 개발용 평가실입니다. 확장 설치·일반 빌드·기본 검색은 이 패키지를 설치하거나 모델을 내려받지 않습니다. 평가 화면도 사용자가 모델 다운로드를 선택하기 전에는 외부 요청을 보내지 않습니다.

저장소 루트에서 실행합니다. Node 24 이상을 권장합니다. 먼저 루트의 `npm ci`로 기존 개발 도구를 설치해야 합니다.

```powershell
npm --prefix eval/webllm ci --ignore-scripts
node scripts/eval-webllm.mjs
```

`http://127.0.0.1:4174`를 WebGPU를 지원하는 Chrome에서 열고 모델을 선택합니다. 체크박스를 선택한 뒤 **모델 다운로드·불러오기**를 누르면 공식 WebLLM 카탈로그의 모델 파일을 받아 이 기기의 GPU에서 실행합니다. 최초 다운로드에는 수백 MB 이상의 디스크 공간과 데이터 전송이 필요합니다. 모델 파일은 브라우저에 캐시되고, 페이지 자료를 추론 서버로 보내지는 않습니다. **메모리 해제**는 GPU를 비우고 **선택 모델 캐시 삭제**는 다운로드 파일도 지웁니다. 확장 검색 결과 초기화와 별개의 저장소입니다.

런타임은 `@mlc-ai/web-llm@0.2.88`에 고정했습니다. Qwen3 0.6B, Qwen2.5 1.5B·3B, f16을 지원하지 않는 GPU용 Qwen2.5 0.5B f32를 제공합니다. 모델 크기나 자체 신뢰도 숫자로 정확도를 판단하지 말고 실제 자료의 점수를 비교합니다.

## 자료와 정답

기본 8개 사례는 **직접 작성한 회귀 자료**입니다. 서비스 제공 여부를 증명하는 실측 자료가 아니며, URL은 형식 검증용 가상 ID입니다. 실제 관측한 검색 결과와 작품 메타데이터를 가져오려면 화면에서 현재 자료를 JSON으로 내보내고 그 형식을 사용합니다. 각 사례의 `provenance`에 관측 시각, 공식 출처, 관측 방식과 수동으로 정답을 정한 근거를 남깁니다.

- `input.query`: 검색할 작품 제목, 관측된 별칭, 작품 종류·버전·연도.
- `input.evidence`: 화면에서 수집한 제목·이미지 URL·소개 후보. `id`, `kind`, `value`, `role`, `scope`를 사용합니다.
- `input.candidates`: 공식 작품 URL이 있는 검색 후보. 모델은 URL을 생성하지 않고 관측된 후보 ID만 선택합니다.
- `input.complete`: 검색이 실제 완료됐을 때만 `true`. 로그인·차단·타임아웃은 `false`입니다.
- `expected`: 별도로 검토한 `titleId`, `imageId`, `descriptionId`, `candidateId`, `status`.
- `split`: `calibration`은 프롬프트 조정용, `holdout`은 독립 검증용입니다. 작품을 두 구분에 나눠 담지 않고 작품 단위로 분리합니다.

사례 ID·출처 설명·정답·구분은 모델에 전달하지 않습니다. 데이터는 파일 1 MB, 100개 사례, 사례당 근거 24개·후보 20개·입력 UTF-8 7000바이트로 제한합니다. 상세 화면을 다시 확인하지 않은 검색 결과를 모델의 답만으로 실제 이동에 쓰지 않습니다.

## 템플릿 비교

`templates.mjs`의 템플릿을 같은 모델·같은 자료로 비교합니다. v1은 기본 지시, v2는 작품 종류·버전 충돌과 불완전 검색의 보류를 강조한 지시, v3는 필드별 의미와 대상 작품과 무관한 예시를 추가한 지시입니다. v3는 작성된 조정용 사례에서 사이트 제목 선택·일치 상태의 모순을 관측한 뒤 만들었습니다. 조정용 결과로 수정한 뒤 검증용 점수를 따로 기록합니다. 검증용 답을 보고 수정했다면 새 독립 자료를 준비해야 합니다.

JSON schema로 선택 가능한 ID를 제한하고, 응답을 다시 검증합니다. 정답 전체 일치율, 출력 형식 유효성, **근거 부족·판본 혼동 일치 수**, 처리 시간을 기록합니다. `unsafeMatches`는 정답이 보류·중복 또는 다른 후보인데 모델이 단일 일치를 주장한 횟수이며, 모두 실제로 다른 작품이라는 뜻은 아닙니다. 관측한 별칭이 없어 보류한 사례도 포함합니다. `confidence`는 모델의 검증되지 않은 추정치이며 실제 확률이나 이동 허용 임계값으로 취급하지 않습니다. 내보낸 결과에는 런타임·모델·템플릿·자료 SHA-256·구분·원본 응답·오류가 포함됩니다.

재현 명령은 다음과 같습니다. 서버를 별도 터미널에서 켠 상태로 실행합니다.

```powershell
node --test eval/webllm/core.test.mjs
node scripts/eval-webllm-smoke.mjs
# 아래 명령은 모델을 실제로 내려받아 GPU 평가를 실행합니다.
node scripts/eval-webllm-smoke.mjs --download-model --evaluate
node scripts/eval-webllm-smoke.mjs --download-model --evaluate --model=Qwen2.5-1.5B-Instruct-q4f16_1-MLC --dataset=artifacts/reviewed-live-dataset.json --output=artifacts/webllm-live-evaluation.json
```

자동화는 `.tmp/webllm-eval-profile`의 독립 Chromium 프로필을 사용합니다. 기본 smoke는 외부 요청이 없는지, WebGPU가 있는지만 확인하고 모델을 내려받지 않습니다. `--evaluate`는 모든 템플릿의 조정용 결과를 비교합니다. 개발 단계의 최소 선별 조건은 출력 전부 유효·잘못된 일치 0개·오류 0개·정답 일치 75% 이상입니다. 조건을 충족한 템플릿을 우선하며 잘못된 일치가 적은 것, 정답 일치가 많은 것, 유효한 출력이 많은 것, 오류가 적은 것 순으로 하나를 고릅니다. 동점이면 버전이 높은 템플릿을 선택합니다. 선택을 고정한 뒤 그 템플릿에만 검증용 자료를 한 번 실행합니다. 조건을 충족한 것이 없으면 검증용 실행은 원인 분석만을 위한 것이고 `recommendation`은 기존 규칙으로 복귀하도록 기록합니다. 이 작은 개발 선별 조건을 통과해도 자동 이동을 허용하지 않습니다. 결과·화면 캡처는 `artifacts/`에 저장됩니다. 테스트의 성공과 실제 모델 품질 평가는 별개입니다.

일반 HTML의 제목·메타데이터·주요 이미지·문단·공식 상세 링크를 수집하는 명령도 제공합니다. 로그인하지 않은 독립 브라우저를 사용하며, URL 없는 카드를 클릭하거나 검색 완료 여부를 추측하지 않습니다. 수집 결과에 수동 정답을 붙인 후 평가 자료로 사용합니다.

```powershell
node scripts/eval-webllm-capture.mjs --url=https://laftel.net/item/42783 --query="어느 마녀가 죽을 때까지" --output=artifacts/webllm-observation.json
```

## 확장 기능에 넣기 전

이 도구는 평가용이며 아직 확장에 연결되지 않았습니다. 사용자 선택, 다운로드 취소·삭제, GPU/메모리 오류 시 기본 추출로 복귀, 페이지 데이터 최소화, 프롬프트 주입 방어, 관측 ID 검증, 독립 평가 기준을 먼저 확보합니다. Manifest V3에 통합할 때 런타임·Worker·WASM을 포함한 실행 코드를 패키지에 넣고 Chrome 정책과 CSP를 별도로 검증해야 합니다. 현재 localhost 도구의 원격 모델 라이브러리 다운로드 방식을 확장에 그대로 복사하면 안 됩니다.

공식 근거: [WebLLM 기본 사용법](https://webllm.mlc.ai/docs/user/basic_usage.html), [Worker·확장 사용법](https://webllm.mlc.ai/docs/user/advanced_usage.html), [JSON mode 예제](https://github.com/mlc-ai/web-llm/tree/main/examples/json-mode), [공식 모델 카탈로그](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts), [Chrome 원격 실행 코드 정책](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy).

# NLI q8 실행 기록

`MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli`의 고정된 community ONNX 변환본을 사용한다. 원저자 checkpoint, 변환 revision, 파일 바이트와 SHA-256은 `model.json`에 있다. 원저자의 MIT 조건을 따른다. 한국어는 XNLI의 15개 미세조정·보고 언어에 포함되지 않으므로 다국어 사전학습의 전이 가능성을 시험하는 후보이다. DOM 전용 학습 모델이 아니다.

```powershell
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/nli/prepare.py --download
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/nli/test_contract.py
.tmp/slayer-venv/Scripts/python.exe eval/light-dom/nli/run.py --jobs=.tmp/light-dom-development-jobs.json --output=eval/light-dom/nli/development.json --browser-jobs=.tmp/light-dom-nli/development-browser-jobs.json
```

이 명령은 기존 `development.json`을 덮어쓴다. 재현 실행은 별도 출력 경로를 지정한다. 모델 가중치는 `.tmp`에만 저장하며 확장 프로그램이나 Git 배포 파일에 포함하지 않는다. 필요한 Python 버전은 `requirements.txt`에 기록했다.

후보의 관측 문장을 premise로, 필드에 대한 주장을 hypothesis로 입력한다. 출력 class 순서는 entailment, neutral, contradiction이며 선택 점수는 entailment logit에서 contradiction logit을 뺀 값이다. 이는 정확도나 신뢰도의 확률이 아니다. 후보별로 공통 작업 계획에 선언된 96/64/32 문자 tier를 차례로 검사해 384 token 이내 첫 표현을 사용한다. 모두 넘으면 명시적으로 실패하고 tokenizer의 자동 잘림은 끈다. 필드별 후보들을 한 batch에 padding하고 실제 batch 시간을 후보 수로 나눈 `elapsedMs`를 저장한다. 토큰화 시간은 별도로 기록한다.

개발 추론 822개는 모두 성공했고 최대 322 tokens, 전부 96자 tier였다. 모델 107,415,176 B, tokenizer와 설정까지 124,501,247 B다. 130개의 비어 있지 않은 개발 batch의 native CPU 추론 중앙값은 약 219 ms, p95 약 355 ms다. 이 값은 동시에 수행한 다른 실험의 영향을 받으므로 하드웨어의 독립 성능 한계로 해석하지 않는다. Windows native Python working set은 시작 70 MB, 모델 준비 후 456 MB, 추론 뒤 667 MB였다. privateBytes는 commit 메모리이며 물리 RAM이나 GPU VRAM으로 부르지 않는다.

`browser-*-probe.json`은 개발 계획의 첫 3개 field batch를 그대로 사용한 호환성 진단이다. 각 batch는 후보 8개, 길이 191/212/252 tokens, 3회 반복이다. ONNX Runtime Web 1.31.1에서 WASM과 실제 GPU queue 제출이 관측된 WebGPU 경로가 모두 실행됐다. warm batch 중앙값은 각각 1,578/1,030 ms였다. native와 browser logits 사이 최대 절대 차이가 약 0.109이므로 동일 결과를 가정하지 않고 최종 browser 출력으로 선택 결과를 다시 계산해야 한다. 이 probe는 정확도 평가가 아니다.

브라우저의 입력은 Python에서 미리 토큰화한 tensor다. 따라서 browser 시간·메모리·전송량에는 17 MB tokenizer의 다운로드, 초기화, 토큰화 비용이 없다. 격리 Chromium의 전체 working set은 시작 약 421/412 MB에서 추론 중 약 965/1,412 MB로 증가했다. 이는 Chrome의 모든 프로세스를 합한 값이며 모델 전용 RAM이나 물리 VRAM이 아니다. 더 작은 가중치 파일이 작은 실제 실행 메모리를 보장하지 않는다.

첫 개발 실행은 출력 파일 교체 중 Windows 파일 잠금 오류로 중단됐다. 저장을 제한된 재시도가 있는 atomic replace로 바꾸고 전체 822개를 다시 실행한 완료본만 `development.json`으로 보존했다. 이후 runner 변경은 상위 작업의 `inputsSha256`, `templateSha256`을 결과에 복사하는 provenance metadata 추가뿐이며 개발 logits 파일은 수정하지 않았다. 새 평가 결과의 `implementationSha256`이 실제 사용한 runner를 식별한다.

global freeze 이후 `ko-role`/threshold 1.988156259059906을 유지한 새 평가 18개 문제의 native 추론을 `holdout.json`에 보존했다. 한 문제는 관측 후보가 없어서 추론하지 않으며 나머지 17개 batch/128개 pair는 오류가 없다. `browser-webgpu-holdout.json`은 같은 token tensor를 브라우저에서 1회씩 실행한 별도 결과다. GPU queue 1,765회가 실제 관측됐으며 일부 연산이 CPU에 배정됐다는 ORT 경고도 있었다. native/browser logit 차이는 최대 0.2140이었다. 정답률은 브라우저 logits에서 고정 threshold로 별도 산출해야 한다.

최종 `browser-webgpu-diagnostic.json`은 개발 자료에서 필드별 첫 positive/none batch를 고정 순서로 골라 6개를 각각 3회 실행했다. 입력 생성은 `scripts/light-dom-nli-probe.mjs`로 재현한다. warm field batch p50/p95는 885/1,134 ms, 모델 로딩은 1,313 ms였다. 반복 실행끼리의 logit 차이는 0이었다. 새 평가 전체 실행의 첫 field batch p50/p95는 1,407/1,908 ms였고 전체 Chromium working set은 시작 409 MB, 마지막 추론에서 1,484 MB였다. 이전 3개 probe와 입력 구성·template이 다르므로 같은 workload처럼 평균 내지 않는다. 브라우저 tokenizer가 제외됐다는 제한은 모든 기록에 적용된다.

# KoELECTRA DOM 역할 적응 파일럿

사람이 만든 DOM 특징의 선형 결합과 다른 경로를 시험한다. 한국어로 사전학습한 표준 `ElectraModel`이 **관측된 DOM 사실의 문장**을 읽고 후보 표현을 만들며, 작은 ranking head와 encoder를 이 과제로 학습한다. 전체 HTML/XPath를 사전학습한 DOM 전용 모델이라는 뜻은 아니다.

원본은 [KoELECTRA-small-v3-discriminator](https://huggingface.co/monologg/koelectra-small-v3-discriminator), 고정 revision `7488f8db0f208beff4a1f3f9bb3ed04650a89ed7`이다. 원본 `.bin`은 56,577,499 bytes이고 pinned SHA-256을 검사한 뒤 stock Transformers로 로드한다. 원래 token discriminator head는 버리고 scalar ranking head를 추가한다. 새로운 head의 무작위 출력을 zero-shot 성능으로 부르지 않는다. 원 프로젝트 라이선스/언어/구조 근거는 [상위 연구 문서](../RESEARCH.md)에 있다.

## 사전 고정한 비교

* **Frozen encoder + trained head:** encoder를 고정하고 CLS 표현을 cache한다. 257개 head 계수만 full-batch AdamW 200회, learning rate 0.01로 학습한다.
* **Full encoder + trained head:** 위와 동일한 최초 encoder/head에서 시작해 14,056,449개 계수를 3 epoch 학습한다. encoder learning rate 0.00002, head 0.001, weight decay 0.01, gradient clip 1이다. 한 번에 한 문제의 전체 후보를 넣는다.

두 조건은 학습 비용과 최적화 방법이 다르다. 같은 step 수로 encoder 해동 효과 하나만 분리한 ablation은 아니며, 두 실용적 학습 방법을 비교한 파일럿이다. seed 20261113, CPU fp32, 4 threads, eager attention을 고정한다. dropout은 cached frozen encoder에서는 끄고 full training에서는 원 설정대로 켠다.

학습 손실은 허용 정답 후보들의 확률 합을 최대화하는 listwise loss다. 복수 정답을 하나로 강제하지 않는다. `__none__`도 페이지 문맥과 “후보 중 해당 정보가 없음”이라는 **결과 선택지**로 별도 인코딩하며, 존재하지 않는 DOM 노드로 꾸미지 않는다. 후보 ID/순서/정답/provenance/CSS 클래스/호스트는 모델 문장에 포함하지 않는다. 한국어 자연어 관측 문장과 필드 질의는 모델 결과를 보고 바꾸지 않았다.

입력은 이미 결과가 공개된 66문제 학습/18문제 **회고 검증**이다. 18문제가 새 holdout이라는 주장은 하지 않는다. 텍스트 tier 96/64/32/16자 중 tokenizer가 실제 384 tokens 이하로 만든 첫 것을 사용한다. 자동 truncation이나 예산 때문에 후보 삭제를 하지 않는다. 최초 학습 전에 `design.json`에 소스/계획/데이터 hash와 recipe를 기록한다. 검증 label 파일은 바이트 hash를 먼저 기록하고, 두 고정 recipe가 끝난 뒤 정답 내용을 파싱해 채점한다.

추가로 상위 [corpus-audit.json](../corpus-audit.json)의 **Netflix 및 동일 작품을 학습에서 제외한 단일 fold**를 고정했다. 63개 학습/15개 평가이고, Netflix 작품과 같은 작품의 타 서비스 문제 6개는 학습에서도 제외한다. 15개는 3작품의 9필드와 비작품 6필드다. 이 fold에서도 원본 checkpoint부터 같은 두 recipe를 학습한다. 이미 관찰한 자료의 개발 진단이므로 모든 신규 서비스나 개편 레이아웃에 대한 일반화 증명은 아니다.

## 재현

모델은 `.tmp`에만 저장하며 확장 프로그램 의존성/기본 동작에 추가하지 않는다.

```powershell
.tmp/slayer-venv/Scripts/python.exe eval/dom-adaptation/finetune/prepare.py
node eval/dom-adaptation/finetune/prepare-inputs.mjs
.tmp/slayer-venv/Scripts/python.exe eval/dom-adaptation/finetune/test_contract.py
.tmp/slayer-venv/Scripts/python.exe eval/dom-adaptation/finetune/train.py
.tmp/slayer-venv/Scripts/python.exe eval/dom-adaptation/finetune/provider-fold.py
.tmp/slayer-venv/Scripts/python.exe eval/dom-adaptation/finetune/export.py
```

완료된 학습 report가 있으면 두 학습 명령은 덮어쓰기를 거부한다. 재학습은 별도 작업 사본에서 진행한다. exact 의존성은 `requirements.txt`에 있다. 입력 생성은 label 파일을 읽지 않는다. 실제 token별 입력 audit와 후보별 logits, epoch별 loss/order, checkpoint SHA를 보관한다. full encoder와 provider fold 훈련 일부가 CPU에서 병행돼 소요 시간은 독립 성능 벤치마크가 아니다.

실제 실행했던 입력 원본은 [plans](plans/)에 바이트 그대로 보존했다. `design.json`/`report.json`의 `.tmp/dom-adaptation/finetune/development-inputs.json`, `holdout-inputs.json` 경로는 각각 같은 이름의 `plans/` 파일에 대응한다. 브라우저 tensor 계획도 `plans/browser-jobs.json`이며, [manifest.json](plans/manifest.json)에 원 경로·보관 경로·바이트 수·SHA-256 매핑이 있다. 새로운 입력을 생성한 뒤 당시 실행을 재현하려면 hash가 이 보관본과 같은지 확인한다.

Export는 학습 checkpoint 및 입력/label hash와 고정 모델 파일을 검증한다. legacy ONNX export의 fp32 출력과 PyTorch를 실제 18문제 및 17/129/257/384 길이의 동적 입력에서 비교한다. MatMul/Gather weight q8 결과는 원래 argmax 기준 그대로 재채점하고, quantization 뒤 성능이 좋도록 threshold를 새로 고르지 않는다. `browser-jobs.json`은 이전 실제 Chrome 측정 runner와 동일한 pretokenized tensor 규격으로 생성한다. 이때 tokenizer/DOM 수집 비용은 브라우저 추론 시간에 포함되지 않는다.

```powershell
node scripts/light-dom-browser.mjs --jobs=.tmp/dom-adaptation/finetune/browser-jobs.json --model=.tmp/dom-adaptation/finetune/full-ranker-q8.onnx --provider=wasm --output=eval/dom-adaptation/finetune/browser-wasm.json
```

## 해석 경계

학습 자료가 매우 작고 양성/비작품 비율이 서비스마다 다르다. 기존 bounded candidate pool 밖의 정답을 찾는 능력, 이미지 픽셀 이해, 제목 정규화, 작품 동일성/시즌 구분, 실제 이동 성공률은 여기서 검증하지 않는다. 단순한 가중치 크기만으로 Chrome 실행 메모리/속도가 가볍다고 결론 내리지 않는다. 학습 자료 점수와 회고 검증, provider-disjoint 진단, 브라우저 측정은 별개로 읽어야 한다.

## 최초 고정 recipe 결과

66문제의 학습 자료에서 frozen encoder+head는 50/66, full encoder+head는 46/66이었다. 이미 알려진 18문제의 회고 검증에서는 각각 6/18, 11/18이다. full encoder는 실제 작품 필드 7/12, 없는 필드 4/6을 맞혔고 잘못된 실제 후보 선택은 6건이었다. head만 학습한 조건은 작품 3/12, 없는 필드 3/6, 오선택 10건이었다. 훈련 정확도와 회고 점수의 순서가 다르므로 훈련 점수만으로 모델을 고르지 않는다. 이 18문제에서 더 잘 나온 recipe를 새로운 검증 성능처럼 발표하지 않는다.

full 학습 자체는 약269초였다. 실제 최대 입력은 295 tokens였고 모든 후보가 첫 96자 tier에서 예산을 충족했다. q8 ONNX는 **14,700,237 bytes**, tokenizer vocab/config와 모델 config까지 더하면 **14,964,082 bytes**이다. runtime JS/WASM 자산은 이 합계에 포함하지 않는다. 학습 가중치 safetensors는 56,249,508 bytes, fp32 ONNX는 56,428,847 bytes다.

q8도 11/18이며 fp32와 18개 선택이 모두 같았다. logits 최대 차이는 약0.419였으므로 수치 동등하다고 말하지 않는다. fp32 ONNX는 실제 입력 및 동적 길이 검증에서 PyTorch와 최대 차이 0.0001 미만이었다. legacy exporter의 tracing 경고가 있었으므로 지원하는 입력의 동적 길이·batch 출력 검증을 별도로 수행했다.

Netflix와 동일 작품을 학습에서 분리한 15문제에서는 **두 recipe 모두 8/15**였다. 실제 작품 필드 6/9, 없는 필드 2/6이며 잘못된 실제 후보 선택은 7건이다. 전체 수치는 같지만 세 문제의 선택은 서로 달랐다. 이 진단에서는 encoder 전체를 학습한 정확도 이득이 나타나지 않았다. 따라서 회고18의 6→11만으로 서비스 변경에 더 강하다고 결론 내릴 수 없다. provider fold full 학습은 약284초였다. 전체 원시 선택과 점수는 `provider-fold.json`에 보관한다.

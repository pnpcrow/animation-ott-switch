# DOM 의미 이해와 소형 모델 적응 학습 조사

조사일: 2026-11-13. 이 문서는 기존 [경량 모델 실측](../light-dom/RESULTS.md)을 보완합니다. 아래 새 모델들은 자료와 배포 파일을 조사했으며, 이 문서 자체가 Chrome 추론이나 OTT 정확도 실측 결과를 뜻하지 않습니다.

## 방향 판단

사용자가 지적한 일반화 문제가 핵심입니다. 6.5 KB 모델은 사람이 정한 DOM·문자열 특징의 가중치를 학습했으므로, 특정 표본의 높은 정확도로 다양한 사이트의 의미 이해를 입증할 수 없습니다. 반대로 앞선 NLI/reranker의 낮은 점수도 소형 신경망의 가능성을 기각하지 않습니다. 그 실험은 DOM 과제 학습 없이 관측 JSON과 짧은 역할 정의를 준 전이 실험이었습니다.

가장 실용적인 후속 방향은 **표준 소형 한국어 encoder에 관측 DOM 문맥을 입력하고, 작품 범위·필드 역할·보류를 실제 예제로 학습하는 것**입니다. 템플릿 개선은 이 학습에 필요한 입력 규격을 정하는 단계이고, DOM 특화 대형 모델은 별도의 비교 또는 오프라인 교사 후보입니다. 모델을 fine-tune한다고 일반화가 자동으로 생기지는 않으므로 사이트·작품·레이아웃을 분리한 검증이 필요합니다.

## 추가로 확인한 DOM/HTML 특화 접근

| 후보 | 실제로 학습한 과제와 제공물 | 이번 환경의 판단 |
| --- | --- | --- |
| AXE / AXEtract | Qwen3-0.6B에 pruning·schema·QA용 LoRA를 학습. 정리한 HTML에서 관련 부분을 추리고 결과를 원본 XPath에 연결 | 구조를 보존한 입력과 출처 연결을 참고할 가치가 높음. 어댑터가 작아도 기본 모델의 메모리·추론 비용은 필요하며 Chrome 경량 경로는 미검증 |
| Dripper / MinerU-HTML | HTML 블록을 main/other로 분류하고 제한된 출력 형식을 사용. 현재 기본 배포본은 Qwen3.5-0.8B 기반 | 본문 선택은 유사하지만 작품 제목·대표 이미지·설명 각각의 역할 분류와 다름. 현재 배포 파일이 약1.71 GB로 경량 기본 경로에는 부적합 |
| Reader-LM-0.5B / ReaderLM-v2 | HTML을 Markdown 또는 구조화한 내용으로 변환하도록 학습 | HTML 사전학습의 비교 후보. 0.5B조차 공식 BF16 가중치 약988 MB. 출력 문자열 재생성이 요소 ID 선택보다 비용이 클 수 있으며, 이미지 픽셀 이해를 제공하는 것은 아님 |
| MarkupLM++ | MarkupLM을 상품 리뷰 페이지에 적응 학습하고 내부 DOM 노드까지 예측 범위를 확장한 연구 | 내부 노드와 다양한 학습 사이트가 중요하다는 근거. 확인한 논문에서 바로 쓸 수 있는 소형 한국어 checkpoint·Chrome 배포본은 찾지 못함 |

AXE 논문은 DOM 정리와 질의에 맞춘 가지치기, 학습된 추출기, 원본 노드 확인을 별도 단계로 둡니다. 이는 “긴 DOM을 그대로 읽게 하는 것”보다 과제에 맞춘 구조와 학습이 필요하다는 설계 근거입니다. 논문의 SWDE/WebSRC 수치를 한국어 OTT 성능으로 가져오지 않습니다. [저자 논문](https://arxiv.org/html/2602.01838v2), [저자 코드](https://github.com/abdo-Mansour/axetract).

Dripper 논문에 등장하는 0.6B 모델과 최신 MinerU-HTML 기본 checkpoint는 구별해야 합니다. 공식 저장소는 2026-11-05에 Qwen3.5-0.8B 버전을 발표했고, 이전 Hunyuan0.5B 버전은 유지보수 종료로 표시합니다. 파이프라인은 노드에 ID를 붙여 main/other를 고르고 원본 HTML에서 내용을 꺼냅니다. 이는 제한된 후보 선택의 참고 사례이며 한국어 OTT 메타데이터 정답률을 뜻하지 않습니다. [논문](https://arxiv.org/abs/2511.23119), [공식 저장소](https://github.com/opendatalab/MinerU-HTML).

Reader-LM-0.5B는 HTML→Markdown 학습 모델이고, ReaderLM-v2는 1.5B 규모입니다. 공식 카드의 라이선스는 CC-BY-NC-4.0입니다. v2에 ONNX가 있지만 가장 작은 공개 ONNX인 q4f16도 약1.34 GB입니다. 파일 존재만으로 확장 프로그램 실행 적합성을 인정하지 않습니다. [0.5B 공식 카드](https://huggingface.co/jinaai/reader-lm-0.5b), [v2 공식 카드](https://huggingface.co/jinaai/ReaderLM-v2).

MarkupLM++ 논문은 학습 자료의 크기·다양성을 늘렸을 때 개선을 관측했고 내부 노드는 일부 속성에 유리했지만 전체 성능이 약간 감소한 경우도 보고합니다. 구조 정보를 더 넣으면 항상 좋아진다는 주장은 피해야 합니다. [저자 논문](https://arxiv.org/abs/2509.20940).

## Needle 3에서는 템플릿의 뜻부터 달라진다

Needle 제작자 문서는 tool description과 system 내용을 일반 챗봇의 지시문이 아니라 사실로 취급한다고 설명합니다. 그러므로 길고 정교한 명령문을 추가하는 방식만으로 성능 향상을 기대하기 어렵습니다. 좁고 명확한 도구, 실제 입력에서 찾을 수 있는 인자, enum·범위 같은 schema 제약이 우선입니다. 도구가5개를 넘으면 retrieval이5개로 줄이므로, DOM 후보8개를 도구8개에 일대일 대응하면 정답 후보가 모델 문맥에서 빠질 수 있습니다. [제작자의 도구 설계 문서](https://cactuscompute.com/blog/designing-tools-for-needle).

구조화 추출은 하나의 도구를 record schema로 정의하고 입력 텍스트에서 값을 고르는 계약입니다. 선택 필드의 근거가 없으면 생략하고, 필수 필드의 근거가 없으면 전체 호출을 보류합니다. 이 계약을 DOM에 적용하려면 노드 ID와 필드 값이 관측 입력에 실제 있어야 합니다. schema를 지킨 JSON이라는 사실과 올바른 작품 요소를 골랐다는 사실은 별도로 채점해야 합니다. [제작자의 추출 문서](https://cactuscompute.com/blog/structured-extraction-with-needle).

공식 로컬 fine-tuning은 기본 모델을 고정하고20층 attention에 rank16 LoRA를 학습한 뒤 병합하는 방식입니다.2~20층으로 내보낼 수 있지만 로컬 결과는4bit이고, 기존 배포본의2bit 후처리와 confidence head 재학습은 hosted 경로와 구별됩니다. 로컬 학습 결과의 confidence는 `None`이므로 기존 threshold를 그대로 재사용하지 않습니다. DOM 역할 학습 자료를 만들어 이 경로를 별도 비교할 수 있으나, Chrome runtime과 한국어 토큰 비용은 여전히 실측해야 합니다. [제작자의 fine-tuning 문서](https://cactuscompute.com/blog/finetuning-needle).

이는 Needle이 DOM을 이해하지 못한다는 결론이 아니라, **모델이 학습한 입력·출력 계약을 먼저 맞추고 그 계약 안에서 적응 학습해야 한다**는 뜻입니다. 로컬 학생 모델 학습과 원격 hosted 학습을 같은 실험이나 같은 배포 크기로 보고하지 않습니다.

## 더 작은 표준 encoder 후보: KoELECTRA-Small-v3

`monologg/koelectra-small-v3-discriminator`는 한국어 사전학습 모델이며 표준 Transformers ELECTRA 구조입니다. 공식 설정은 12층, hidden 256, embedding 128, 어휘35,000개입니다. 공식 PyTorch 가중치는 **56,577,499 B**, 약14M 파라미터 규모입니다. 한국어·DOM 문맥을 함께 학습할 작은 시작점으로 검토할 만합니다. 공식 프로젝트는 Apache-2.0이고 Hub 카드의 license 필드는 비어 있습니다. [공식 프로젝트](https://github.com/monologg/KoELECTRA), [공식 배포본](https://huggingface.co/monologg/koelectra-small-v3-discriminator), [표준 ELECTRA 문서](https://huggingface.co/docs/transformers/model_doc/electra).

이 모델은 instruction 모델이나 완성된 DOM 분류기가 아닙니다. 사전학습 head의 점수를 그대로 제목 적합성으로 읽을 수 없고, 관측 문맥과 필드별 역할을 이용한 분류/순위 head 및 적응 학습이 필요합니다. q8 후 크기·ONNX 수치 일치·Chrome RSS/지연은 직접 측정해야 합니다. 영어 Jina33M에 비해 한국어 사전학습과 작은 원본 파일이라는 장점이 있지만, 여기서는 DOM 정확도 우위를 주장하지 않습니다. 영어·일본어 제목 전이도 별도 평가 대상입니다.

## 템플릿과 학습 규격에서 바꿀 것

1. **관측을 보존하는 입력**: 제목과 본문만 주지 않고 현재 열린 dialog 범위, 노드의 조상·인접 텍스트·속성·가시성·메타데이터 출처를 일관되게 표현합니다. 원본 수집에 없는 공통 조상 ID나 형제 관계를 추정해 사실처럼 넣지 않습니다. 기존 `featurePack`은 조상3개와 heading2개 등으로 제한하므로, 템플릿만 늘려도 사라진 관계가 복원되지는 않습니다.
2. **모델별 출력 과제 구분**: instruction 모델에는 짧은 단계별 기준과 대조 예시, NLI에는 후보에 대한 검증 가능한 가설, 학습용 encoder에는 고정된 필드 질의와 관측 문맥을 줍니다. NLI/reranker가 긴 지시문을 명령처럼 수행한다고 가정하지 않습니다.
3. **페이지 범위와 필드 역할 분리**: 검색 카드·홈 배너·닫힌 모달·회차 소개를 현재 작품 상세와 구분하는 예제를 넣습니다. 제목·대표 이미지·전체 줄거리의 정답이 서로 다른 작품에 속하면 허용하지 않습니다. 보류가 필요한 음성 사례도 학습합니다.
4. **같은 페이지의 어려운 오답 학습**: 서비스 슬로건과 작품명, 타이틀 로고와 포스터, 회차 줄거리와 작품 줄거리, 배경 추천 카드와 열린 모달을 함께 보여 줍니다. 여러 공식 표현이 모두 맞으면 허용 정답 집합을 사용하고 하나만 억지로 정답으로 만들지 않습니다.
5. **후보 선택에 제한**: 출력은 실제 관측 후보 ID 또는 `none`으로 제한하고, 선택 뒤 원본 노드에서 문자열·URL을 읽습니다. 생성된 URL이나 제목을 곧바로 이동에 사용하지 않습니다. 확률처럼 보이는 raw logit을 검증 없이 신뢰도로 표시하지 않습니다.
6. **현실적인 일반화 평가**: 같은 작품의 필드와 같은 페이지 변형은 한 그룹에 두고, 학습하지 않은 서비스와 실제 레이아웃 개편 자료를 따로 평가합니다. class 변경·중립 wrapper 추가·후보 순서 변화는 합성 강건성 검사이며, 새 사이트의 정확도 증거를 대신하지 못합니다. 이미 결과를 본84문제는 후속 개발 자료로 취급합니다.

처음에는 작은 encoder의 감독학습과 템플릿 대조 실험을 하고, 데이터가 충분해진 뒤 DOM 특화 교사가 추가로 알려 주는 의미 관계가 있는지 증류를 비교하는 순서가 적절합니다. 교사 없이 정답 ID로 학습한 실험을 증류라고 부르지 않습니다. 손으로 설계한 구조 모델은 비용과 실패 양상을 비교하는 기준으로 유지하되, 범용 의미 모델의 대체물이라는 결론은 보류합니다.

## 배포 파일 확인 기록

2026-11-13 공개 Hugging Face API의 `?blobs=true`와 공식 config를 읽었습니다. 가중치는 조사 목적으로 다운로드하지 않았습니다. 크기는 decimal bytes이며 RAM 추정치가 아닙니다. 아래 파일 외에 tokenizer·설정·런타임이 필요합니다.

| 모델 | 확인한 revision | 파일 / 실제 바이트 |
| --- | --- | ---: |
| KoELECTRA small v3 discriminator | `7488f8db0f208beff4a1f3f9bb3ed04650a89ed7` | `pytorch_model.bin` 56,577,499 |
| MinerU-HTML v1.1 Qwen3.5 0.8B compact | `65b51c740309408b70a7e55f9c4b79520c876339` | `model0_0.safetensors` 1,706,030,528 |
| MinerU-HTML v1.1 Hunyuan0.5B compact | `63dc2543cd273bf23af1e156174477cdf5888476` | `model.safetensors` 1,078,050,648 |
| Reader-LM-0.5B | `46cb69fff9d100f9c3c2a135d59f365fb99a0121` | `model.safetensors` 988,097,824 |
| ReaderLM-v2 | `1d07078459ee1e880a22d67387b5e683d50a6e4b` | `onnx/model_q4f16.onnx` 1,335,839,014 |

공식 API: [KoELECTRA](https://huggingface.co/api/models/monologg/koelectra-small-v3-discriminator?blobs=true), [MinerU Qwen](https://huggingface.co/api/models/opendatalab/MinerU-HTML-v1.1-qwen3.5-0.8B-compact?blobs=true), [MinerU Hunyuan](https://huggingface.co/api/models/opendatalab/MinerU-HTML-v1.1-hunyuan0.5B-compact?blobs=true), [Reader-LM0.5B](https://huggingface.co/api/models/jinaai/reader-lm-0.5b?blobs=true), [ReaderLM-v2](https://huggingface.co/api/models/jinaai/ReaderLM-v2?blobs=true). MinerU 코드 저장소의 Apache-2.0과 모델 가중치 라이선스를 같은 것으로 단정하지 않습니다. 새 두 checkpoint의 Hub license 메타데이터는 비어 있어 실제 배포 채택 전에 가중치 조건을 확인해야 합니다.

# 가벼운 DOM 요소 추출 모델 조사

조사일: 2026-11-13. 목표 환경은 Chrome 확장 프로그램의 선택적 로컬 추론입니다. 이번 조사에서는 모델 가중치 약 200 MB 이하를 실용적인 탐색 기준으로 삼고, 토크나이저·런타임 파일과 실제 메모리는 별도로 셉니다. 다운로드 크기와 실행 메모리는 같지 않습니다. 기존 Jev/Needle/Slayer 평가는 반복하지 않습니다.

## 이번에 실측할 후보

**한국어 reranker, 다국어 NLI 분류기, 35 MB 영어 tiny reranker**를 비교합니다. 생성 모델처럼 문자열을 새로 만드는 대신 관측된 후보마다 적합성을 계산하고, 로컬 코드가 후보 ID를 선택합니다. 다만 모두 DOM 전용으로 학습한 모델은 아니므로 실제 DOM 정확도는 이번 평가에서만 판단합니다.

| 후보 | 목적과 언어 근거 | 실제 확인된 크기 | 실행 선택 |
| --- | --- | --- | --- |
| `nlpai-lab/KURE-Reranker-nano` | 한국어·영어 질의/문서 cross-encoder; 후보 관련도 계산에 맞는 학습 목적 | 149,323,009 parameters. 공식 F32 597,306,212 B. 조사 시 커뮤니티 ONNX는 FP32 597.9 MB / FP16 299.4 MB | 로컬 q8 변환 후 크기·정확도·브라우저 실행 검증 필요 |
| `MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli` | 6층 NLI; 후보 관측과 “현재 작품의 소개이다” 같은 가설의 관계 분류 | 106,995,075 floating parameters. 준비된 ONNX q8 107,415,176 B, 토크나이저·설정 포함 **124,501,247 B** | 준비된 community ONNX q8로 CPU와 브라우저 검증 |

KURE의 공식 설명은 한국어/영어 reranking과 단일 relevance logit을 명시합니다. 이는 OTT DOM 선택 성능을 입증하지 않으며, 공개 A6000 처리량을 사용자 노트북 성능으로 가져오지 않습니다. 라이선스는 Apache-2.0입니다. [공식 모델](https://huggingface.co/nlpai-lab/KURE-Reranker-nano), [공식 프로젝트](https://github.com/nlpai-lab/KURE).

NLI 모델은 XLM-RoBERTa 계열 다국어 기반을 사용하지만, NLI 미세조정과 보고된 XNLI 평가는 한국어가 없는 15개 언어입니다. 한국어는 전이 능력에 의존하므로 한국어 품질이 검증됐다고 표현하지 않습니다. 클래스 순서는 entailment / neutral / contradiction이고 최대 입력은 특수 토큰 포함 512개입니다. 원저자 라이선스는 MIT이며, community 카드의 YAML은 잘못 렌더링돼 Hub의 license 메타데이터가 비어 있지만 본문에 원본 라이선스가 보존돼 있습니다. [원저자 모델](https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli), [ONNX 배포본](https://huggingface.co/onnx-community/multilingual-MiniLMv2-L6-mnli-xnli-ONNX).

## 다른 경량 후보와 이번 우선순위

| 후보 | 크기 / 배포 근거 | 역할과 제한 |
| --- | --- | --- |
| `ibm-granite/granite-embedding-97m-multilingual-r2` | 97,441,152 params; community q8 97,858,099 B; Apache-2.0 | 한국어가 명시된 52개 강화 지원 언어에 포함됨. 좋은 후속 의미 유사도 후보지만 embedding은 요소 역할의 정답 분류기가 아님 |
| `intfloat/multilingual-e5-small` | 약 117.65M floating params; author qint8 118,346,824 B / Xenova q8 118,308,185 B; MIT | 한국어 Mr.TyDi 결과가 공식 카드에 있고 익숙한 브라우저 경로. query:/passage: 접두와 mean pooling 필요. 검색 유사도와 DOM 역할 적합성은 다름 |
| `hotchpotch/bekko-embedding-v1-a8m` | **총 105,975,168 params**; 저자 권장 ONNX 130,099,079 B; MIT | 4층, 7.7M active parameters를 “총 8M 모델”로 오해하면 안 됨. 100+언어·브라우저 데모 제공. 역시 의미 검색용 embedding |
| `jinaai/jina-reranker-v1-tiny-en` | 33,046,273 params; 공식 q8 33,424,854 B; Apache-2.0 | 실제로 매우 작고 공식 Transformers.js 경로가 있으나 영어 모델. 50 MB 미만이라는 실행환경의 요구를 직접 시험할 세 번째 실측 후보. 한국어 미지원은 핵심 제약으로 명시 |
| `urchade/gliner_multi-v2.1` | 현재 checkpoint tensor 합 **288,949,504 params**, F32 1,155,830,112 B; Apache-2.0 | 엔티티 span 추출 과제이며 DOM 노드/이미지/현재 모달 범위를 직접 판별하는 모델이 아님. 카드 release 표의 209M보다 실제 checkpoint가 큼 |

Granite는 한국어를 포함하는 retrieval-pair 학습 언어와 ONNX/OpenVINO 배포를 명시합니다. [IBM 공식 모델](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2), [ONNX community 배포본](https://huggingface.co/onnx-community/granite-embedding-97m-multilingual-r2-ONNX).

E5는 다국어 검색 학습과 한국어 검색 benchmark를 제공하지만 길이는 512토큰으로 제한됩니다. [공식 E5-small](https://huggingface.co/intfloat/multilingual-e5-small), [Xenova 배포본](https://huggingface.co/Xenova/multilingual-e5-small).

Bekko의 소형성은 active parameter 수와 총 parameter 수를 구분해 읽어야 합니다. 저자 권장 ONNX는 어휘 embedding을 int8로 줄이는 방식이며, 더 작은 전체 int8 파일들은 현재 파일명에 `not_recommended`라고 표시돼 있습니다. [저자 모델](https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m), [저자 논문](https://arxiv.org/abs/2607.25180).

Jina의 tiny는 영어 4층 reranker이고, 모델 제작자가 직접 여러 ONNX 형식과 Transformers.js 사용 경로를 배포합니다. [공식 Jina 모델](https://huggingface.co/jinaai/jina-reranker-v1-tiny-en). GLiNER의 공개 과제는 임의 이름의 엔티티 span을 찾는 것이며, DOM 구조 분류와 같지 않습니다. [공식 GLiNER multi](https://huggingface.co/urchade/gliner_multi-v2.1).

## DOM 전용 모델을 바로 채택하지 않은 이유

**MarkupLM**은 텍스트와 XPath embedding을 함께 입력받으므로 구조를 직접 처리한다는 점에서 가장 관련이 높습니다. 그러나 `microsoft/markuplm-base`는 사전학습 checkpoint입니다. 임의로 새 분류 head를 붙인 뒤 정답률이 낮다는 결론을 내리면 안 됩니다. 실제 비교 후보는 QA로 미세조정된 `microsoft/markuplm-base-finetuned-websrc`이며, 조사한 배포본은 영어 WebSRC 기반의 538,596,465 B 파일입니다. ready-made 경량 브라우저 artifact를 확인하지 못했고, QA span과 이미지 URL 선택·비작품 페이지 보류는 과제가 다릅니다. [공식 QA 모델](https://huggingface.co/microsoft/markuplm-base-finetuned-websrc), [공식 processor 문서](https://huggingface.co/docs/transformers/model_doc/markuplm).

**NewsXLM DOM-LM**은 실제로 다국어 HTML 노드를 title/text/author/tag/date/none으로 분류하는 모델입니다. 한국어를 포함한 뉴스 자료를 사용한 연구라는 점은 중요하지만, 현재 `ispras-crawlers/newsxlm-domlm-ae`는 약 281.19M floating parameters / F32 1,124,801,408 B, 별도 DOM 전처리와 custom model code가 필요합니다. 대표 이미지 label이 없고 뉴스 도메인과 OTT 작품 도메인도 다릅니다. 이후 더 작은 학생 모델로 증류할 teacher 후보는 될 수 있으나 현재 가벼운 브라우저 기본 경로에는 맞지 않습니다. [제작자 모델](https://huggingface.co/ispras-crawlers/newsxlm-domlm-ae), [다국어 뉴스 추출 논문](https://arxiv.org/abs/2502.02167), [DOM-LM 원논문](https://arxiv.org/abs/2201.10608).

**HTML-T5** 논문의 비교 크기는 Base 220M / Large 770M / XL 3B이며, HTML 사전학습 뒤 작업별 미세조정을 사용하는 연구입니다. 일반 `t5-small`을 HTML-T5의 작은 배포본처럼 취급하지 않습니다. 이번 200 MB 안팎 실측 우선순위에는 넣지 않았습니다. [저자 논문 Appendix H.2](https://arxiv.org/html/2307.12856v2).

## 실측에서 구분할 것

- 모델의 구조적 적합성은 구매·채택 근거가 아니라 **시험할 가설**입니다. reranker/NLI가 HTML tree를 직접 이해한다고 표현하지 않습니다.
- 관측된 후보를 최대 8개로 제한하고 candidate ID 선택만 허용합니다. 후보가 빠진 문제는 모델 선택 문제와 분리합니다.
- 모델 자체 선택과 기존 규칙을 결합한 결과를 따로 기록합니다. 없는 필드를 보류한 성과와 실제 작품의 요소를 찾은 성과도 분리합니다.
- 양자화 종류, model+tokenizer 다운로드 바이트, cold load, warm field latency, 전체 후보 배치 비용, 브라우저 실행 provider, 페이지가 살아 있는 동안 추가 메모리를 각각 기록합니다.
- ONNX 파일 존재나 `webgpu` 옵션 지정만으로 WebGPU 실행을 선언하지 않습니다. 실제 provider 배치와 출력 일치, WASM fallback 여부를 확인합니다.
- 이번까지 이미 본 66개 문제는 개발용입니다. 새로운 평가 자료의 정답과 결과를 본 후 threshold나 template을 다시 고르지 않습니다.

정확한 revision, tensor 합계, 배포 파일 크기와 SHA-256은 [Hub 메타데이터 스냅샷](research-models.json)에 보존합니다. 파일 크기는 decimal MB(10^6 bytes)로 읽었으며, 메모리 사용량의 대용 값이 아닙니다. 위 모델 카드의 benchmark 점수를 이 확장 프로그램의 DOM 정확도와 섞지 않습니다.

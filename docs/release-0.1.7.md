# AniOTT Switch 0.1.7

2026-11-14 · 스토어 등록 준비용 테스트 릴리즈

표시 이름을 **AniOTT Switch**로 변경하고 A 모노그램 아이콘을 적용했습니다. 보관함·사이드바·도움말·오류 문구를 함께 바꿨습니다. 본문과 작품 목록은 16px, 보조 문구와 버튼은 최소 14px 중심으로 키우고 화면 폭에 맞춰 줄바꿈과 패널 폭을 조정했습니다.

Chrome 확장 ID는 **`cmaijknliglhgokkmijggladebokgafl`**로 유지합니다. 공개키, package name, 기존 DB 이름, 작품·카테고리 ID, 백업 형식은 바꾸지 않았습니다. 기존 스토어 항목에 `ott-switch-0.1.7.zip`을 업로드하세요. 이미 고정 ID를 사용하는 설치는 파일 교체 후 새로고침으로 업데이트합니다.

## 권한과 개인정보

실제 저장에 쓰이지 않던 `storage` 권한과 접근 설정 호출을 제거했습니다. 보관함은 기존 IndexedDB에 그대로 저장합니다. 지원 OTT의 호스트 권한은 작품 정보 추출과 동일 작품 확인에 사용합니다.

- [개인정보처리방침](https://github.com/pnpcrow/animation-ott-switch/blob/main/docs/privacy.md)
- [스토어 설명·단일 목적·권한·데이터 체크 안내](https://github.com/pnpcrow/animation-ott-switch/blob/v0.1.7/docs/store-listing.ko.md)
- [기능별 데이터 처리 근거](https://github.com/pnpcrow/animation-ott-switch/blob/v0.1.7/docs/privacy-data-map.md)

## 제출용 이미지

`aniott-switch-store-kit-0.1.7.zip`에 스토어 아이콘 128×128, 실제 확장 캡처 5장(각 1280×800), 작은 홍보 타일 440×280, 마키 타일 1400×560과 등록 문서를 담았습니다. 캡처는 격리된 브라우저에서 가상 예시 작품과 직접 만든 이미지를 사용했습니다. 실제 OTT의 작품 제공 여부를 증명하는 자료는 아닙니다.

이미지는 [스토어 자산 폴더](https://github.com/pnpcrow/animation-ott-switch/tree/v0.1.7/assets/store)에서도 확인할 수 있습니다. 저장소 공개를 위해 기존 이력과 릴리즈를 점검하고 현재 평가 데이터의 만료된 이미지 서명 URL 쿼리를 정리했습니다. [공개 점검 기록](https://github.com/pnpcrow/animation-ott-switch/blob/v0.1.7/docs/publication-audit.md)에 범위와 한계를 기록했습니다.

## 검증

- 고정 ID 검사, 타입 검사, 단위 테스트 **443개**, 브라우저 테스트 **32개** 통과.
- 보관함 390–1440px, 사이드바 320–1280px에서 가로 넘침 없이 글자 크기·버튼 배치 확인.
- 공개 데이터 정제 후 관련 평가 데이터 검사 **34개 + 49개** 통과. 과거 모델 성능 수치는 다시 측정하거나 변경하지 않았습니다.
- 설치 ZIP은 **391,375바이트·10개 파일**이며 빌드 폴더와 일치합니다. ZIP을 풀어 새 Chromium 프로필에 설치해 이름·버전·고정 ID·보관함 조회를 확인했고 페이지/콘솔 오류는 0건입니다.
- ZIP SHA-256: `5a10995a8cb661cf59ccddf5a9a0400dc8be80381890184eec4beb64673cf975`.

검증 원문은 첨부한 `package-validation-0.1.7.json`과 `SHA256SUMS-0.1.7.txt`를 참고하세요. 스토어 등록 자료를 준비한 단계이며 대시보드 입력·심사 제출은 수행하지 않았습니다.

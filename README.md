# OTT Switch

현재 작품을 다른 OTT에서 찾아 이동하고, 작품 중심으로 북마크를 관리하는 Chrome Manifest V3 확장 프로그램입니다. 기본 지역은 대한민국(KR)입니다.

## 개발 계획

1. **기반** — 비공개 GitHub 저장소, TypeScript/React, MV3 빌드, 데이터 계약.
2. **로컬 보관함** — IndexedDB, 카테고리, 작품 편집, JSON 그룹 공유/백업, 최신 수정 우선 병합.
3. **OTT 연결** — 라프텔·넷플릭스·Apple TV·Crunchyroll 작품 감지, 검색과 보수적인 동일 작품 판정, 재생 중 숨기는 오버레이.
4. **검증 및 비공개 배포** — 단위/브라우저 테스트, 설치 가능한 ZIP, CI, 제한 사항 기록.

단위별 커밋을 만들고 각 단계가 끝날 때 `main`에 푸시합니다. 안정화 전에는 비공개를 유지합니다.

## 설계 원칙

- 작품 상세 화면에서만 왼쪽 오버레이를 표시하며 검색·재생 화면은 제외합니다.
- 확인된 작품 URL로만 스위치합니다. 접속 제한, 로그인 요구, 모호한 동명 작품은 별도 상태입니다.
- 북마크의 사용자 지정 이미지/설명을 원본 페이지보다 우선합니다. 이미지는 URL만 저장하고 브라우저 캐시를 사용합니다.
- 서버 없이 로컬 데이터를 저장하며, Google Drive 계정 연결은 초기 버전에 포함하지 않습니다. 삭제 기록을 포함한 병합 구조로 이후 동기화에 대비합니다.
- 외부 데이터를 HTML로 주입하지 않고 URL과 가져오기 데이터를 검증합니다.

## 개발

Node.js 22 이상에서 `npm install`, `npm run check`를 실행합니다. 실행·설치 및 검증 결과는 구현 완료 시 이 문서에 추가합니다.

## 기술 참고

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Google Drive application data](https://developers.google.com/workspace/drive/api/guides/appdata)

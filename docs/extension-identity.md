# 확장 프로그램 식별자 고정

v0.1.5로 생성한 기존 Chrome 웹 스토어 항목을 앞으로도 계속 사용한다.

| 항목                         | 고정값                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| Chrome 확장 / 스토어 항목 ID | `cmaijknliglhgokkmijggladebokgafl`                                 |
| 기준 릴리즈                  | `v0.1.5`                                                           |
| npm package name             | `animation-ott-switch`                                             |
| 확장 이름                    | `OTT Switch · 작품 보관함`                                         |
| 공개키 DER SHA-256           | `2c089adb86b76eaac8966b0341ea605b415387225fca0f39a3e2247a4ed56a55` |

2026-11-14 열린 개발자 대시보드의 해당 항목 **패키지 → 공개 키 보기**에서 공개키를 읽었다. 공개키를 DER/SPKI로 해석하고 SHA-256의 앞 16바이트를 Chrome ID 문자로 변환한 결과가 위 항목 ID와 일치한다. 공개키는 `public/manifest.json`의 `key`에 들어 있으며 비밀키가 아니다. 새 키를 생성하거나 기존 스토어 항목을 다시 만들 필요가 없다.

## 이후 변경 규칙

`config/extension-identity.json`은 이 프로젝트의 식별 기준이다. 빌드와 패키징에서 manifest 공개키, 키 해시, 계산된 확장 ID, 제품 이름과 package name을 기준값과 대조한다. 키 삭제·변경, 잘못된 ID, 소스와 빌드의 불일치는 오류로 중단한다. `npm run check:identity`로 따로 확인할 수 있다.

버전 번호는 업데이트마다 올린다. 버전 증가와 확장 ID는 별개이며, `0.1.5`라는 버전 숫자를 계속 유지하면 스토어 업데이트에 사용할 수 없다. 새 패키지는 **기존 항목의 새 패키지 업로드**로 제출한다. 동일 제품을 새 항목으로 다시 생성하지 않는다. 이번 변경은 스토어 정보 작성이나 심사 제출을 수행하지 않는다.

고정키를 포함한 첫 패치는 `0.1.6`이다. 기존 v0.1.5 태그·ZIP·측정 결과를 덮어쓰지 않는다. 0.1.6 이후에는 설치 폴더가 달라도 고정키를 통해 같은 ID가 생성된다. 독립 Chromium에서 두 폴더와 같은 ID의 업데이트를 검증한다.

## 기존 로컬 설치 데이터

원래 v0.1.5 ZIP에는 `key`가 없었다. 따라서 압축 해제 설치의 ID는 설치 경로에 따라 스토어 ID와 다를 수 있다. 그 경로 기반 ID를 스토어 ID와 같다고 보장할 수는 없다. 기존 설치 화면의 ID가 위 값과 다르면, 고정 ID 설치로 넘어갈 때 **최초 한 번** 기존 보관함에서 전체 JSON 백업을 내보내고 새 설치에서 가져와야 한다. 기존 확장을 삭제하기 전에 백업 파일을 확보한다. 두 확장 origin 사이의 IndexedDB를 임의로 복사하거나 자동으로 읽지 않는다.

스토어 ID가 이미 같은 설치 및 이후 동일 ID 업데이트에서는 기존 저장소를 계속 사용한다. 코드의 데이터 식별자는 다음 값들을 유지하며, 호환성 테스트가 기존 v0.1.5 형태의 데이터를 직접 만들어 읽기·갱신·백업을 검증한다.

- IndexedDB: `ott-switch-library`; stores: `bookmarks`, `categories`, `settings`, `meta`.
- meta keys: `deviceId`, `clock`; settings record ID: `settings`.
- 기본 카테고리 ID: `watchlist`, `watching`, `completed`.
- 백업 형식: `ott-switch`, schema version `1`; 작품·카테고리 ID와 수정 기록 보존.

별도 설치/프로필로 백업을 가져오면 원본 작품·카테고리 ID는 보존하고 새 설치의 기기 ID는 별도로 유지한다. 향후 DB 스키마 버전을 올릴 때도 이름을 바꿔 빈 저장소를 만들지 말고 기존 데이터를 보존하는 마이그레이션을 작성한다.

공식 근거: [Chrome manifest key와 ID 유지](https://developer.chrome.com/docs/extensions/reference/manifest/key), [기존 스토어 항목 업데이트](https://developer.chrome.com/docs/webstore/using-api#upload_a_package_to_update_an_existing_store_item).

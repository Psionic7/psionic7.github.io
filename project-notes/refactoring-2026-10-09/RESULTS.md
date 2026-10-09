# 리팩토링 결과 — 2026-10-09

## 완료한 변경

| 변경 | 파일 | 결과 |
| --- | --- | --- |
| 주간 데이터 접근 분리 | src/weekly/useDistrictDatasets.js, src/WeeklyPage.jsx | manifest/로더별 캐시를 생성한다. 이전 요청이 늦게 끝나도 새 캐시와 화면을 덮어쓰지 않는다. 같은 시군구의 진행 중 요청은 공유하며 성공한 빈 배열도 재사용한다. 실패한 지역만 재시도한다. |
| 결과 표시 분리 | src/weekly/WeeklyResults.jsx | 카드, 통계, 거래표, 50건 페이지 이동을 조회 조건 화면에서 분리했다. 화면 문구와 접근성 label, CSS class를 유지했다. |
| 조회 계산 최적화 | src/weekly/query.mjs, src/weekly.mjs | 지역·기간·해제 조건을 먼저 확인하고 면적·평대·아파트 조건까지 적용한 최종 행만 정렬한다. 기존 weeklyRows 호출과 정렬 순서는 유지한다. |
| 수집 작업 수명 통합 | server/job-runner.mjs, server/index.mjs | 실거래·마스터·좌표·주소 네 작업에 연결부터 close까지 공통 처리를 적용했다. 연결 실패와 close 실패도 failed/finishedAt에 반영한다. 취소 시 완료된 진행 수를 보존하고 작업별 메시지 정책을 유지한다. |
| 검증 명령 정리 | package.json, README.md | test:node와 test:all을 추가하고 기존 domain/server 그룹에 신규 회귀 테스트를 포함했다. 구조와 작업 기록 링크를 안내했다. |
| 공개 빌드 갱신 | docs/index.html, docs/assets/* | 기존 GitHub Pages 구조에 맞춰 최신 빌드를 생성했다. 해시 변경에 따른 기존 JS 삭제/신규 JS 추가가 포함된다. |

## 최종 책임 경계

```text
WeeklyPage.jsx                  조회 조건·선택·면적 UI 조율
  ├─ useDistrictDatasets.js      요청·Promise 재사용·캐시 세대·비동기 상태
  └─ WeeklyResults.jsx           통계·표·페이지 상태
       └─ query.mjs              최종 조건 구성
            └─ weekly.mjs        지역/날짜/해제 필터와 최신순 정렬

server/index.mjs                보안·라우팅·작업별 입력/진행 정책
  └─ job-runner.mjs              DB 열기·실행·실패/취소·닫기·종료 시각
       └─ 기존 수집 모듈          API별 검증과 트랜잭션
```

## 테스트 결과

| 명령/검증 | 결과 |
| --- | --- |
| 수정 전 node --test tests/*.test.mjs | 65개 통과 |
| 수정 전 pnpm test | 55개 통과 |
| 최종 pnpm test:all | Node 72개 + React 60개 = 132개 통과 |
| pnpm admin:build | 통과 |
| pnpm build | 통과 |
| pnpm check:publish | 통과: 공개 데이터 체크섬·건수·SQLite 무결성·허용 테이블·비공개 정보 제외 검사 |
| git diff --check | 통과 |
| 실제 브라우저 검사 | HTTP 200, pageerror 0개, 조회/필터/대시보드 전환 정상 |
| 모바일 표시 | 390px 화면에서 문서 폭도 390px. 전체 페이지 가로 넘침 없음. 데스크톱/모바일 스크린샷 육안 확인 |

추가 회귀 검증은 총 12개다. 캐시 테스트 5개는 StrictMode 요청 중복, 재선택/빈 배열, manifest 갱신, 이전 응답 경합, 로더 교체, 동기 예외 및 실패 지역 재시도를 확인한다. 작업 실행기 테스트 6개는 성공/needs_review, DB 연결 실패, 실행 실패, close 실패, 원래 오류 보존, 실행 전/중 취소를 확인한다. 조회 테스트 1개 안에서 기존 계산과 54가지 조건 조합을 비교하며 원본 배열을 동결해 변경되지 않음을 검증했다. 기존 보안·원천 보존·수집 취소·지도·즐겨찾기·면적/기간 테스트도 모두 통과했다.

테스트 로그와 화면 증거는 Git 제외 폴더 local에 저장했다:

- refactor-baseline-node.log / refactor-baseline-ui.log
- refactor-final-tests.log
- refactor-admin-build.log / refactor-public-build.log / refactor-public-check.log
- refactor-browser-result.json
- refactor-weekly-desktop.png / refactor-weekly-mobile.png

## 최적화 측정

합성 거래 100,000건, 100개 아파트, 한 즐겨찾기 단지, 28일 전체 기간으로 기존 계산과 새 계산의 결과를 먼저 비교했다. 각각 3회 준비 실행 후 순서를 번갈아 9회 측정했다.

| 항목 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 정렬 대상 | 100,000건 | 1,000건 |
| 결과 | 1,000건 | 1,000건 |
| 실행 시간 중앙값 | 168.49ms | 30.67ms |

이 수치는 해당 PC의 합성 데이터 함수 측정이다. 정렬 대상은 99% 감소했지만 실제 사용자 화면 전체 속도가 같은 비율로 빨라진다는 의미는 아니다. 전체 배열 스캔은 유지되며, 필터가 없는 조건에서는 정렬 대상 수가 같다. 측정 스크립트와 원시 결과는 local/refactor-query-benchmark.mjs 및 local/refactor-query-benchmark.json에 남겼다.

## 로컬 미리보기

[주간 조회 미리보기](http://127.0.0.1:4173/?tab=weekly&dong=dong_41465101&period=month&month=2026-09)

Vite preview를 127.0.0.1:4173에 실행했고 Codex 브라우저 패널에서 열린 주소를 확인했다. 2026년 9월 풍덕천동 조회에서 47행, 20평대 필터 적용 후 8행을 확인했다. 별도 브라우저 세션에서 데스크톱/모바일 렌더링과 빈 즐겨찾기 대시보드 전환을 검사했다. 브라우저 제어 도구 초기화 오류는 설치된 Playwright를 통한 로컬 검증으로 보완했다.

## 범위와 한계

실제 수집 API 호출, 운영 DB 수정, 배포는 수행하지 않았다. public/data와 public/apartment-map 원본은 그대로이며 docs의 빌드 JS만 갱신했다. 새 패키지나 DB 스키마 변경은 없다. App은 현재 manifest를 최초 한 번 로드하므로 캐시 버전 문제는 같은 컴포넌트에 manifest/로더가 교체되는 경우에 해당한다. 이번 변경은 그 계약과 이후 갱신 확장의 안정성을 확보한다.

기존 App의 전체 상태 조율, 마스터 SQL, 지도 수명은 이번 결함 해결에 필요하지 않아 유지했다. 과도한 폴더 이동·포맷팅·프레임워크 교체는 진행하지 않았다. 커밋과 푸시는 하지 않았으며 모든 변경을 작업 트리에 남겼다.

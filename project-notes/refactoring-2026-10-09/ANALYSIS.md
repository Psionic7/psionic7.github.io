# 코드 분석 — 2026-10-09

## 범위와 기준선

대상은 psionic7.github.io이며 시작 시 Git 작업 트리는 깨끗했다. 공개 React/Vite 앱, 로컬 관리자, Node/SQLite 서버, 수집·내보내기·자동화와 기존 테스트를 조사했다. 수정 전 Node 65개, React/Vitest 55개 테스트가 모두 통과했다. 실제 작업 DB와 API 키는 수정하지 않는다.

## 구조와 책임

| 영역 | 주요 파일 | 분석 |
| --- | --- | --- |
| 앱 조율 | src/App.jsx, preferences.js | manifest, lazy 탭, URL/로컬 설정, 즐겨찾기를 조율. 전체 폴더 재배치는 불필요. |
| 거래 접근 | src/data.js | 해시 파일별 Promise 캐시와 실패 삭제가 이미 구현되어 있음. 유지. |
| 주간·대시보드 | WeeklyPage.jsx, Dashboard.jsx, weekly.mjs | Dashboard는 주간 UI 재사용. WeeklyPage에 요청 캐시, 조건, 카드, 표, 페이지 상태가 혼재. 분리 필요. |
| 아파트 상세 | ApartmentExplorer.jsx, ApartmentPage.jsx, domain.mjs | 통계와 단위 계산은 순수 함수로 분리됨. 기존 계산 계약 유지. |
| 지도 | ApartmentMapPage/Canvas/Popup.jsx, apartment-map-data.js | 로딩, Leaflet 수명, 팝업이 이미 분리됨. 대규모 재작성 불필요. |
| 지역 지도 | admin/RegionMap.jsx, src/CloudRegionMap.jsx | 클라우드가 로컬 지도 구현을 재사용. 지도 복제 모듈 불필요. |
| 로컬 관리자 | Admin.jsx, RawExplorer.jsx, RawTable.jsx | 수집 초안/명시 저장과 원천 조회 분리. 유지. |
| API 진입 | server/index.mjs | 보안, 라우팅, 읽기 SQL, 작업 수명, 정적 제공. 네 DB 수집 작업의 시작·실패·정리 반복이 개선 대상. |
| 저장/수집/공개화 | storage.mjs, collector.mjs, export.mjs | 원자적 파일 저장, 월 단위 트랜잭션, 공개 테이블 허용 목록, 해시 자료는 적절한 책임 경계. |
| 주소·좌표 | addresses.mjs, coordinates.mjs | 공식 응답 검증과 개별 저장/취소. API별 판정과 재시도 정책을 억지로 통합하지 않음. |
| 독립 마스터 | apartment-master*.mjs, building-registry.mjs, vworld-apartment-data.mjs | 스키마/대장/공간 보강/수집 조율로 분리됨. 원천 판정과 트랜잭션 변경 제외. |
| 자동화 | refresh-data.yml, scripts/automation.mjs, check-public.mjs | 암호화 DB 복원→수집→공개화→빌드/검사→보관→배포. 로컬 검증만 실행. |

## 확인한 개선 지점

### 주간 캐시의 버전 불일치

WeeklyPage 캐시는 시군구 코드만 키로 사용한다. manifest 또는 districtLoader가 변경되어 effect가 재실행되어도 saved.rows를 재사용한다. 같은 코드의 해시 파일이 변경되면 이전 데이터가 남을 수 있다. 진행 중인 옛 요청도 캐시에 쓰므로 state의 active 플래그만으로 캐시 오염을 막지 못한다. manifest/loader별 캐시 세대를 분리하고, 요청 중복 방지·실패 재시도·재선택 재사용을 보존하는 hook으로 추출한다.

### 결과 표시와 정렬 비용

DongWeek는 조건 UI와 별개인 카드·통계·표·페이지를 담당하므로 별도 컴포넌트로 분리한다. 현재 기간/동 필터 후 정렬하고 다시 아파트/면적을 거른다. 즐겨찾기 한 단지 조회에서도 다른 단지까지 정렬하므로 최종 조건 필터 후 정렬하도록 조회 함수를 분리한다. 전체 배열 스캔은 유지되며 대형 인덱스/worker는 측정 근거가 없어 추가하지 않는다.

### 수집 작업 수명 반복 및 예외 누락

실거래·마스터·좌표·주소 작업에 DB 연결, 실행, 취소 판정, close, 종료 시각, controller 해제가 반복된다. 연결이 try 밖에 있어 연결 실패가 비동기 작업 상태에 반영되지 않고 running에 남을 수 있다. close 실패는 뒤쪽 종료 정리를 건너뛴다. 연결부터 정리까지 공통 실행기에서 처리하고 업무별 진행 메시지와 오류 공개 정책은 유지한다.

## 보존/제외 판단

프레임워크 교체, TypeScript 전환, 패키지 업그레이드, 전체 이동/포맷팅, CSS 재작성은 현재 문제 해결에 필수가 아니다. DB 스키마·거래 원문·마스터 매칭·API 재시도 정책은 바꾸지 않는다. 이미 구현된 lazy loading과 해시/시군구별 로딩도 유지한다. 파일 길이가 짧아도 긴 한 줄에 여러 책임이 있으므로 단순 줄 수로 품질을 판단하지 않는다.

## 검증 한계

실제 공공 API, 운영 DB 수집, 운영 배포는 검증하지 않는다. 정렬 대상 감소는 확인하되 실제 기기 체감 속도 향상을 단정하지 않는다. 환경상 일반 명령 실행 도구 초기화가 실패하여 승인된 외부 실행 경로로 동일 프로젝트의 읽기/수정/테스트를 수행한다.

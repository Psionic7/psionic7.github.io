# 시스템 Chrome 무인 매매 수집과 GitHub Actions

## 변경 계획과 실행

1. insane-search의 `protocol_stealth_chrome` 실행 방식인 nodriver + 시스템 Chrome을 일일 매매 수집의 기본 소스로 연결한다.
2. 저장한 공개 단지 연결은 후보로 재사용하되, 매번 실제 단지 주소를 검증한다. 번호가 없으면 일반 검색 UI에서 자동으로 찾는다.
3. 매매(`APT`, `A1`) 요청과 마지막 페이지를 검증한다. 실패·미확정은 0건 성공과 구분하고 이전 매매 광고를 보존한다.
4. 실제 Python/Chrome 통합 테스트와 실제 네이버 검증 명령을 만든다.
5. GitHub Actions에서 Python 3.12, nodriver 고정 버전, 시스템 Chrome, Xvfb를 사용해 같은 스크립트를 실행한다.

## 수집 경로

`scripts/automation.mjs collect` → `collectDailyListings` → `createDailyListingSource` → `server/naver-system-chrome.mjs` → `scripts/naver-system-chrome.py` 순서다. 기존 한국 시간 매일 01:00 실거래가 수집에서 이어 실행한다.

브라우저는 사용자 프로필이나 로그인을 요구하지 않는 새 임시 세션이다. 공개 화면 탐색으로 발생한 응답 본문만 읽는다. 인증 헤더·쿠키·사용자 프로필을 추출하지 않는다. 보안 확인·접근 제한·요청 제한에서는 실패 상태를 남기고 중단한다.

범용 insane-search CLI도 확인했으나 이 로컬 샌드박스에서는 DNS 요청부터 실패했다. 실제 수집 성공 증거는 정상 시스템 Chrome 환경에서 nodriver로 실행한 결과다. 특정 사이트의 매물 스키마와 전체 페이지 검증은 프로젝트 수집기가 담당한다.

## 확인한 두 원인

**페이지 넘김:** 기존 수집기는 두 요소의 `scrollTop`만 변경해 후속 페이지가 요청되지 않았다. 실제 DOM에서는 목록의 중첩 스크롤 요소에서 `scroll` 이벤트가 전달되어야 했다. 목록과 상위 스크롤 요소를 이동시키고 스크롤 이벤트를 전달한 뒤, 실제 응답의 마지막 페이지를 확인한다. 래미안수지이스트파크에서 첫 20건 이후 16건이 이어지는 2페이지를 확인했다.

**자동 검색:** “검색 후보를 선택하면 단지 상세 URL로 이동한다”는 가정을 DOM과 요청으로 검사했다. 공개 클라이언트 코드를 확인해 후보 선택이 `click`이 아닌 `mousedown`에 연결되어 있고, 검색 결과는 지도 이동으로 표시된다는 것을 확인했다. 해당 UI 동작 후 지도 표식 `숫자COMPLEX`의 단지 번호와 단지명을 읽고 후보마다 주소를 검증한다. 기존 상세 이동 형태도 지원한다. 이름이 다르거나 주소가 다르거나 둘 이상의 후보가 같은 주소 검증을 통과하면 연결하지 않는다.

기본 소스는 `system-chrome`이다. 이전 Playwright 실행 기록 때문에 전환 당일 수집을 건너뛰지 않도록 일일 보고서에 `browserSource`를 저장한다. 같은 소스의 당일 시도는 재수집하지 않고 다음 한국 날짜에 다시 수행한다.

## 실행과 검증

```powershell
python -m venv .venv-naver
.\.venv-naver\Scripts\python.exe -m pip install -r scripts/requirements-naver-browser.txt
$env:NAVER_BROWSER_PYTHON = "$PWD/.venv-naver/Scripts/python.exe"
pnpm listings:daily --plan
pnpm listings:daily
node scripts/check-naver-live.mjs
```

`NAVER_CHROME_PATH`로 시스템 Chrome 실행 경로를 지정할 수 있다. 기본은 nodriver의 시스템 Chrome 탐색이다. `NAVER_BROWSER_DIAGNOSTICS=1`은 실패 진단을 stderr에 출력한다. 정기 실행은 일반 Chrome을 Xvfb 가상 화면에서 실행한다.

- `tests/naver-nodriver.integration.mjs`: 실제 Python 자식 프로세스와 Chrome으로 한글 입력 → 후보 선택 → 지도 표식 확인 → 주소 검증 → 중첩 스크롤 → 매매 전체 페이지 저장을 검증한다. 임대 광고 제외도 확인한다.
- `scripts/check-naver-live.mjs`: 실제 네이버에서 저장 단지 번호 경로와 번호 없는 자동 검색 경로를 각각 새 브라우저 세션으로 검증한다. 공개 스냅샷과 작업 DB는 바꾸지 않는다.
- 실제 네이버 검증 요약은 비공개 `local/data-validation/naver-live.json`에 저장한다. 전체 지역 수집 성공과 혼동하지 않는다.
- `.github/workflows/naver-listings-smoke.yml`: 관련 변경을 main에 푸시하거나 수동 실행하면 비밀 키 없이 실제 무인 수집을 검증하고 요약 JSON을 아티팩트로 보존한다.
- 기존 `refresh-data.yml`: 실거래·주소 수집 후 같은 무인 소스로 지역 전체 매매를 수집한다. 작업 DB와 마지막 성공 자료는 기존 암호화 보관 경로에 유지한다.

GitHub Ubuntu 24.04 이미지의 [Chrome·Xvfb 목록](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [nodriver의 Xvfb 안내](https://github.com/ultrafunkamsterdam/nodriver#usage), [Python 설정 안내](https://docs.github.com/en/actions/tutorials/build-and-test-code/python)를 확인했다.

로컬 실제 네이버 테스트의 성공만으로 GitHub 데이터센터에서 성공한다고 판단하지 않는다. 사용자의 별도 커밋·푸시 지시에 따라 `main`에 반영하고 원격 검증 워크플로의 결과를 따로 확인한다.

## 최종 로컬 검증

- 2026-11-07 16:07–16:08 KST에 서로 다른 새 Chrome 세션으로 단지 번호 지정과 자동 검색을 실행했다. 각각 단지 107215의 매매 36건·2페이지를 확인했으며 관찰 시각도 별개다.
- 자동 검색은 초기 단지 연결 파일이나 앞선 브라우저의 지도 위치·응답 캐시 없이 확인했다.
- 전체 Node 테스트 175개, UI 테스트 134개, 매물 테스트 62개, 필수 데이터 테스트 22개 통과.
- `pnpm build`의 빌드 전후 원본 대조 통과: 실거래 343,552건·3개 구·757개 월별 파일·939개 구·월 원천 이력.
- `pnpm check:publish` 및 `git diff --check` 통과.
- 인앱 브라우저에서 기존 수지 48개 단지·매매 광고 681건 조회가 유지됨을 확인했다. 이번 검증 명령은 공개 매물 스냅샷과 작업 DB를 변경하지 않았다.

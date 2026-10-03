# 집의 기록

서울·경기 아파트 실거래를 조회하는 **React + Vite** 웹앱입니다. 데이터 수집 관리자도 React이며, 로컬 Node.js 서버가 공공 API 요청과 SQLite 저장을 담당합니다. 실행·수집·내보내기·빌드·검사에는 Python과 Streamlit이 필요하지 않습니다.

- 공개 사이트: **https://psionic7.github.io/**
- 공개 저장소: **Psionic7/psionic7.github.io**
- 배포: GitHub Pages → `main` / **`docs`**
- 별도 로컬 관리자: **http://127.0.0.1:8623/**

## 실행

**Node.js 24.19 이상과 pnpm 11**을 사용합니다. SQLite는 Node.js 내장 `node:sqlite`로 읽고 씁니다. 패키지 버전은 잠금 파일에 고정되어 있습니다.

```powershell
pnpm install --frozen-lockfile
git config core.hooksPath .githooks
pnpm dev                 # 공개 화면 개발: 127.0.0.1:5173
pnpm admin               # 별도 React 관리자 빌드·실행: 127.0.0.1:8623
```

Windows에서는 **`run-admin.bat`**을 실행한 뒤 위 관리자 주소로 접속합니다. 이 PC에서는 PATH에 Node/pnpm이 없으면 설치된 Codex 런타임을 사용합니다. 의존성이 설치되어 있으면 `run-admin.bat -SkipInstall`도 가능합니다. 종료는 실행한 터미널에서 Ctrl+C입니다.

프로젝트 루트의 `.env`에 API 키를 설정합니다. 파일은 Git에서 제외됩니다.

```dotenv
MOLIT_SERVICE_KEY=<공공데이터포털에서 받은 실제 키>
```

실제 키는 관리자 브라우저에 전달되지 않습니다. 화면에는 설정 여부만 표시합니다. 서버는 `127.0.0.1`에만 바인딩하며 Host·Origin·CSRF를 검사하고 외부 사이트의 요청을 거부합니다. 공개 사이트에는 관리자 API, 수집 기능이나 관리자 빌드가 배포되지 않습니다.

## 구조

```text
src/                    공개 React 화면: 대시보드·원천 데이터·안내
admin/                  별도 React 관리자 소스
  assets/               서울·경기 법정동 및 시·구 경계, 출처
server/                 로컬 Node.js API·수집·SQLite·내보내기
local/                  로컬 전용 작업 폴더 (Git 제외)
  my_real_estate.sqlite3 거래·지역·수집 이력·응답 XML
  collection_regions.json 저장한 수집 지역
.env                    로컬 API 키 (Git 제외)
admin-dist/             로컬 관리자 빌드 (Git 제외)
public/data/            공개용 SQLite·JSON
docs/                   공개 Vite 빌드: GitHub Pages 배포 대상
scripts/                Node.js 검사·내보내기·GitHub Pages 도구
```

첫 관리자 실행 시, 새 작업 DB가 없고 같은 상위 폴더에 이전 `my_real_estate` 프로젝트가 있으면 기존 DB를 SQLite 백업 API로 일관되게 복사하고 `.env`·저장 지역 목록을 가져옵니다. 이미 새 파일이 있으면 덮어쓰지 않습니다. 초기화 후에는 누락된 지역 목록을 이전 폴더에서 다시 채우지 않습니다. 이전 파일은 보존하며 이후 작업은 **이 프로젝트의 `local/` 파일**에 저장됩니다. 이전 폴더가 없는 새 PC에서도 실행할 수 있고 수집 대상은 빈 목록으로 시작합니다.

## 관리자 기능

- 서울 467개·경기 745개 법정읍면동 경계를 미리 표시합니다. 시·군은 굵은 실선, 구는 점선, 동은 가는 실선으로 구분하며 지역마다 색이 다릅니다. 배경은 OpenStreetMap입니다.
- 시도 → 시·군 → 구 → 동 검색 필터, 표시 범위 전체 추가·해제, 선택 지역 목록을 제공합니다.
- 지도를 클릭하면 지역 정보 팝업이 열립니다. 오른쪽 위 별표로 수집 대상 추가·해제를 편집합니다. **별표 변경은 메모리 초안만 갱신하며 지도·배경 타일·열린 팝업·확대 위치는 유지됩니다.**
- 저장 파일과 초안이 다르면 추가·해제 건수와 **업데이트 필요**를 표시합니다. **수집 지역 업데이트**를 눌러야 JSON 파일에 저장합니다. 변경사항 되돌리기로 초안을 복원합니다. 새로고침하면 저장하지 않은 초안은 사라집니다.
- 수집에는 **파일에 저장된 목록**을 사용합니다. 수집 중에는 목록 저장과 다른 작업을 막고, 진행 상태·건수·중단·최근 이력을 표시합니다. API는 같은 시군구·월을 한 번만 요청하며 동별 범위는 조회 단계에서 적용합니다.
- 월 전체 응답의 페이지·총 건수·거래 필드를 검증한 뒤 해당 월을 한 트랜잭션으로 교체합니다. 실패하거나 중단한 월은 기존 자료를 유지합니다. 이미 완료한 월은 보존합니다.
- 원천 필드, 빈 문자열, 선행 0, 해제 및 동일 거래를 보존합니다. XML의 DTD/entity를 거부하고 저장 응답에서 인증 값을 제거합니다. 일시적인 연결 오류·429·5xx는 최대 세 번 재시도합니다.
- 경계에 없는 개편 지역은 공식 서울·경기 시군구 코드와 법정동명을 입력해 별도로 등록할 수 있습니다. 이 지역은 최신 경계가 추가되기 전까지 목록에서 선택합니다.

경계는 [V-World 기반 kr-admin-geojson](https://github.com/KnellBalm/kr-admin-geojson)의 **2023-07-29** 공개 자료입니다. 이후 부천·화성 등의 개편은 반영되지 않을 수 있습니다. 상세 출처: [admin/assets/BOUNDARIES.md](admin/assets/BOUNDARIES.md).

## 데이터 갱신

1. `run-admin.bat` 또는 `pnpm admin`으로 로컬 관리자 실행.
2. 지도 별표로 편집 → **수집 지역 업데이트**.
3. 계약월 지정 → **저장 지역 수집**. 완료 상태 확인.
4. **1. 공개 데이터 내보내기** → **2. GitHub Pages 정적 빌드·검사**.
5. 생성된 공개 데이터와 정적 파일을 커밋·푸시.

```powershell
git add public/data docs
git commit -m "Update transaction data"
git push origin main
```

CLI만 사용할 때:

```powershell
pnpm data:export
pnpm build
pnpm check:publish
# Windows: build.bat은 설치·공개 빌드·검사를 함께 실행
```

내보내기는 작업 DB의 허용된 열만 읽어 **새 공개 DB**를 생성합니다. 파일명을 SHA256 해시로 구분하고 manifest를 마지막에 저장합니다.

| 공개 파일 | 내용 |
|---|---|
| `manifest.json` | 지역 목록, 저장한 즐겨찾기 ID, 지역별 건수·월·해시 |
| `trades-<시군구>-<해시>.json` | 정규화 값 + 모든 원천 필드 `raw` |
| `public.sqlite3` | `trades`·`regions`·`metadata` 세 테이블 |

**공개 저장소의 소스와 공개 데이터는 누구나 내려받을 수 있습니다.** `.env`, API 키, 로컬 작업 DB, 수집 이력·XML, `collection_regions.json`, 관리자 빌드는 Git에서 제외하고 게시 검사에서도 차단합니다. 즐겨찾기 **지역 ID만** 관리자가 공개하도록 선택한 목록으로 manifest에 포함합니다. Git 인덱스와 현재 게시 파일을 실제 로컬 비밀 값과 대조합니다.

공개 사이트의 최초 조회 지역은 미선택입니다. 기본 관심 지역을 임의로 넣지 않으며 즐겨찾기는 저장한 목록만 표시합니다. 즐겨찾기가 비어 있어도 전체 시·구·동 검색으로 조회할 수 있습니다. 유효한 공유 URL에는 지역·기간·탭을 복원합니다.

## 공개 화면

- **대시보드**: 해제 제외 거래·금액/전용평당 중앙값·단지 수·월별 가격/거래량·면적 분포·즐겨찾기 비교·단지 집계.
- **원천 데이터**: 해제 포함 API 전체 필드. 열별 포함·일치·제외·빈 값·숫자 이상/이하 필터, 정렬·페이지 이동·CSV.
- **지역 조회**: 시도·시·구 필터, 법정동 검색, 구 전체 조회, 저장한 즐겨찾기. 미수집 지역은 빈 화면.
- **데이터 안내**: 갱신 시각·공개 범위·통계 기준·SQLite 다운로드.

최초 이전 자료는 17,367건, 2025.10–2026.09, 용인 수지구·수원 영통구·성남 분당구의 전체 API 응답입니다. 이후 수집한 자료에 따라 범위가 달라집니다. 금액은 만 원 단위, 전용평은 전용면적 ÷ 3.305785입니다. 거래 구성에 따라 중앙값이 달라질 수 있습니다.

## 테스트

```powershell
node --test tests/domain.test.mjs tests/server.test.mjs
pnpm test
pnpm admin:build
pnpm build
pnpm check:publish
```

수집 검증·월 교체/실패 보존·취소·중복 요청·원천 보존·키 제거·내보내기 허용 테이블·외부 요청 거부·명시적 저장·지도 유지·공개 통계를 검사합니다. 테스트는 임시 DB와 가짜 API 응답을 사용합니다.

## 배포

GitHub Settings → Pages → **Deploy from a branch** → `main` / `/docs`. Vite `base`는 사용자 사이트에 맞춰 `/`입니다. `pnpm build`가 `.nojekyll`을 만듭니다. `admin-dist/`는 별도의 빌드이며 Pages에 들어가지 않습니다.

```powershell
node scripts/github-pages.mjs status
```

배포 조회 도구는 Git의 기존 인증을 메모리에서 사용하며 토큰을 파일이나 출력에 남기지 않습니다.

- [이전 프로젝트 분석 기록](project-notes/PROJECT_AUDIT.md) — 최초 이전 시점의 기록이며 현재 실행 구조는 이 문서를 기준으로 합니다.
- [GitHub Pages 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Vite 배포 안내](https://vite.dev/guide/static-deploy.html)

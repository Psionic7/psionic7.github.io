# 집의 기록

서울·경기의 아파트 실거래를 살펴보는 **React 정적 웹앱**입니다.

- 공개 사이트: **https://psionic7.github.io/**
- 공개 저장소: **Psionic7/psionic7.github.io**
- 배포: GitHub Pages → `main` 브랜치의 **`/docs`**
- 수집·관리: 관리자 PC의 별도 비공개 **my_real_estate** 프로젝트

## 화면

- **대시보드**: 유효 거래, 금액 중앙값, 전용평당 중앙값, 거래 단지 수, 월별 가격·거래량, 면적별 분포, 관심 지역 비교, 아파트별 집계.
- **원천 데이터**: API의 모든 필드와 빈 값을 보존합니다. 각 열에서 포함·일치·제외·빈 값·숫자 이상/이하 필터를 조합하고 정렬·페이지 이동·CSV 다운로드를 할 수 있습니다. 해제 거래도 포함합니다.
- **지역 조회**: 서울·경기 시도 → 시 → 구 필터, 법정동 검색, 구 전체 조회, 수지·광교·분당 바로가기. 미수집 지역은 빈 상태를 표시합니다.
- **데이터 안내**: 현재 공개 범위, 통계 기준, 전체 공개 SQLite 다운로드와 로컬 수집 안내.
- 조회 지역·기간·탭은 URL에 남아 주소를 공유할 수 있습니다.

## 구조

```text
my_real_estate/                         psionic7.github.io/
  .env (로컬 API 키)                     src/ (React 화면 + 통계)
  data/my_real_estate.sqlite3             public/data/ (공개 JSON + SQLite)
  data/collection_regions.json           scripts/export_data.py
  run.bat → 로컬 Streamlit 관리자          docs/ (빌드 결과, Pages 배포 대상)
  scripts/export_pages.py ──내보내기──→    pnpm build → git push → GitHub Pages
```

공개 사이트에는 Python 서버·API 호출·로그인·관리자 쓰기 기능이 없습니다. 서버 비용 없이 공개 정적 자료를 브라우저에서 필터링하고 집계합니다. `docs/`는 생성물이며 직접 편집하지 않습니다.

## 개발

Node.js 24, pnpm 11을 기준으로 검증했습니다. 의존성 버전은 `package.json`과 `pnpm-lock.yaml`에 고정되어 있습니다.

```powershell
pnpm install --frozen-lockfile
git config core.hooksPath .githooks
pnpm dev
# http://127.0.0.1:5173
```

```powershell
pnpm build
pnpm preview
# http://127.0.0.1:4173
```

이 PC에서 pnpm이 PATH에 없다면 **`build.bat`**으로 빌드·공개 파일 검증을 함께 실행할 수 있습니다. 이 도구는 설치된 Codex 런타임의 pnpm 또는 PATH의 pnpm을 사용합니다.

## 데이터 갱신

1. 관리자 PC의 `my_real_estate/run.bat`을 실행합니다. 루프백 주소에서만 수집·관리할 수 있습니다.
2. 지도 팝업의 별표로 수집 지역을 편집하고 **수집 지역 업데이트**를 눌러 파일에 저장합니다. 업데이트 전 변경은 세션 메모리에만 남습니다.
3. 계약월을 지정하고 **선택 지역 수집**을 실행합니다. 같은 시군구·월은 한 번만 요청하고, 법정동 범위는 조회 시 적용합니다.
4. **GitHub Pages 데이터 내보내기**를 누릅니다. 공개 SQLite를 만든 뒤 이 프로젝트의 `public/data/`로 내보냅니다.
5. 이 프로젝트에서 빌드·검사·커밋·푸시합니다.

```powershell
cd ..\psionic7.github.io
.\build.bat
# 반드시 빌드와 검사가 성공한 뒤 실행
git add public/data docs
git commit -m "Update apartment transaction data"
git push origin main
```

UI 대신 로컬 CLI로 내보낼 수도 있습니다.

```powershell
# my_real_estate 폴더에서
.\.venv\Scripts\python.exe -X utf8 scripts/export_pages.py
```

공개 SQLite를 이미 생성했다면, 내보내기 도구는 Python 표준 라이브러리만 필요합니다.

```powershell
# React 프로젝트 폴더에서
python scripts/export_data.py --source ../my_real_estate/data/public.sqlite3 --secrets-file ../my_real_estate/.env
pnpm build
python scripts/check_public.py --secrets-file ../my_real_estate/.env
```

### 내보내는 파일

| 파일 | 내용 |
|---|---|
| `public/data/manifest.json` | 공개 시각, 지역 목록, 지역별 파일·건수·계약월·체크섬 |
| `public/data/trades-<시군구>-<해시>.json` | 계산용 값 + 가공하지 않은 API 필드 `raw` |
| `public/data/public.sqlite3` | `trades`, `regions`, `metadata`만 담은 공개 DB |
| `docs/` | 위 데이터와 React를 함께 담은 정적 빌드 |

지역 파일명에 내용 해시를 넣어 오래된 브라우저 캐시와 새로운 목록이 섞이지 않게 합니다. 데이터가 없는 시군구는 파일을 요청하지 않습니다. 다른 지역으로 이동한 뒤 이전 요청이 끝나도 이전 지역을 표시하지 않습니다.

**이 저장소와 SQLite·JSON은 전부 공개됩니다.** `.env`, API 키, 수집 이력, 응답 XML, 로컬 작업 DB, 저장한 수집 대상 파일은 넣지 않습니다. 기존 비공개 저장소의 이력도 가져오지 않았습니다. 공개 검사는 실제 로컬 키 값과 게시 파일을 대조하고, SQLite 테이블·건수·무결성·JSON 체크섬·빌드 최신 여부를 확인합니다.

## 테스트

```powershell
node --test tests/domain.test.mjs
pnpm test
python -m unittest discover -s tests -p "test_*.py"
python scripts/check_public.py --secrets-file ../my_real_estate/.env
```

기존 Python 통계와 현재 공개 JSON을 비교하려면 비공개 로컬 프로젝트의 가상환경으로 다음 도구를 실행합니다.

```powershell
..\my_real_estate\.venv\Scripts\python.exe -X utf8 scripts/verify_legacy.py --legacy-project ../my_real_estate
```

## 데이터 기준과 범위

- 자료: [국토교통부 아파트 매매 실거래가 API](https://www.data.go.kr/data/15126469/openapi.do).
- 최초 이전 자료: **17,367건**, 계약월 **2025.10–2026.09**, 용인 수지구·수원 영통구·성남 분당구의 API 응답 전체. 이 범위는 수집·배포 후 달라집니다.
- 대시보드에서 해제 거래는 제외하고, 원천 데이터에서는 보존합니다. 금액은 만 원 단위 원천값을 억 원으로 환산합니다. 전용평은 전용면적 ÷ 3.305785입니다.
- 광교 바로가기는 **이의동·하동·원천동**만 조회합니다. 영통구 전체와 범위가 다르며 광교 사업지구 경계와도 일치하지 않을 수 있습니다.
- 법정읍면동 목록은 [V-World 기반 kr-admin-geojson](https://github.com/KnellBalm/kr-admin-geojson)의 **2023-07-29** 자료입니다. 부천·화성 등의 이후 개편은 반영되지 않을 수 있습니다. 수집 지도와 경계 파일은 로컬 관리자 프로젝트에서 유지합니다.
- 모든 API 필드·빈 값·해제·동일 거래를 보존합니다. 새로운 API 필드도 원천 표에 표시합니다. 가격 중앙값은 거래 구성 변화에 영향을 받으며, 특정 단지의 시세와 동일한 지표는 아닙니다.

## 배포 설정

GitHub → Settings → Pages → **Deploy from a branch** → `main` / `/docs`.

`psionic7.github.io`는 사용자 사이트이므로 Vite `base`는 `/`입니다. `.nojekyll`은 빌드 후 자동 생성됩니다. 별도의 유료 호스팅이나 CI 빌드 없이 커밋한 정적 파일을 배포합니다. 소스 변경·데이터 갱신 후에는 반드시 `pnpm build`를 다시 실행하세요.

- [기존 프로젝트 상세 분석과 이전 결정](project-notes/PROJECT_AUDIT.md)
- [GitHub Pages 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Vite 정적 배포 안내](https://vite.dev/guide/static-deploy.html)

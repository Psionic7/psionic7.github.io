# GitHub 로그인 관리자 포털 설정

새 포털은 GitHub 계정 로그인만 사용한다. 브라우저에는 GitHub 토큰이나 OAuth Client Secret을 전달하지 않는다. 공개 사이트는 GitHub Pages에 유지하고, 인증 서버와 관리자 화면은 Cloudflare Workers에 함께 배포한다. 관리자 작업은 서버에 저장한 저장소 소유자의 토큰으로 수행한다.

## 인증과 호스팅의 구분

GitHub 계정은 관리자 로그인에 사용하고 Cloudflare 계정은 인증 서버를 호스팅하기 위해 사용한다. GitHub 로그인 자체에 Cloudflare 계정이 필수인 것은 아니다. 이번 구현은 Workers와 Durable Objects로 작성했으므로 Cloudflare에 배포할 때 계정이 필요하다. 기존 서버나 다른 호스팅을 사용할 수 있지만 서버 실행과 세션 저장 부분의 이식이 필요하다.

## 필요한 최초 설정

1. Cloudflare의 Workers 서비스를 사용할 계정을 준비하고 Workers용 API Token과 Account ID를 확인한다.
2. 관리자 서버 주소를 정한다. 기본 Worker 이름은 home-records-admin이며 Workers의 실제 하위 도메인을 포함한 주소를 사용한다. 아래 예시는 반드시 본인 주소로 바꾼다.
3. GitHub Settings → Developer settings → OAuth Apps → New OAuth App에서 다음을 등록한다.
   - Application name: Home Records Admin
   - Homepage URL: https://home-records-admin.YOUR-SUBDOMAIN.workers.dev
   - Authorization callback URL: https://home-records-admin.YOUR-SUBDOMAIN.workers.dev/api/admin/callback
4. Client ID와 Client Secret을 확인한다. 로그인 권한은 read:user로 제한하며 로그인한 계정의 ID와 저장소 소유자 ID를 서버에서 비교한다.
5. 작업용 fine-grained GitHub 토큰은 Psionic7/psionic7.github.io 하나로 제한한다. Actions, Contents, Workflows에 Read and write 권한이 필요하다. 토큰 소유자는 Psionic7이어야 한다.

## GitHub 저장소 설정

Settings → Secrets and variables → Actions에서 다음을 넣는다. 비밀 값은 채팅·코드·공개 변수에 넣지 않는다.

| 종류 | 이름 | 내용 |
| --- | --- | --- |
| Secret | ADMIN_GITHUB_TOKEN | 관리자 작업용 fine-grained GitHub 토큰 |
| Secret | GITHUB_OAUTH_CLIENT_SECRET | OAuth App의 Client Secret |
| Secret | CLOUDFLARE_API_TOKEN | Workers 배포용 Cloudflare API Token |
| Variable | CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| Variable | GITHUB_OAUTH_CLIENT_ID | OAuth App Client ID |
| Variable | ADMIN_PORTAL_URL | 관리자 서버의 HTTPS 원점 주소, 예: https://home-records-admin.YOUR-SUBDOMAIN.workers.dev |

ADMIN_PORTAL_URL에는 /admin.html이나 쿼리를 붙이지 않는다. callback URL의 원점과 정확하게 같아야 한다.

## 배포 및 사용

코드가 main에 반영된 후 Actions에서 **Deploy GitHub admin login**을 수동 실행한다. 워크플로는 인증 테스트 → 관리자 UI 빌드 → 서버 배포 설정 생성 → 서버와 Secrets 배포를 수행한다. GitHub Secrets의 두 인증 값을 서버의 GITHUB_ADMIN_TOKEN, GITHUB_OAUTH_CLIENT_SECRET Secrets로 전달한다. 비밀 값은 UI 빌드 단계에 제공하지 않는다.

관리자 포털의 /admin.html을 열고 **GitHub로 로그인**을 누른다. GitHub 인증과 소유자 확인을 마친 뒤 기존 지역 지도·설정 저장·수집 실행·이력 기능을 사용할 수 있다. 접속은 4시간 동안 유지되며 새로고침 후 복원한다. 로그아웃하면 서버 세션을 삭제한다.

공개 사이트의 기존 수집·배포 워크플로를 다시 실행하면 ADMIN_PORTAL_URL을 읽어 기존 /admin.html에 **GitHub로 로그인** 링크가 표시된다. 그 전까지 기존 토큰 접속은 유지된다. 관리자 서버는 최신 공개 manifest를 Pages에서 읽는다. 공개 사이트와 포털 UI는 각각 배포하므로 관리자 UI를 수정한 경우 관리자 배포도 다시 실행한다.

서버는 임의 GitHub API 프록시를 제공하지 않는다. 저장·수집에는 같은 출처와 CSRF 값을 요구하며 저장은 서버의 지역 목록과 현재 Git SHA로 검증한다. 로그인 시작은 IP별 1분에 5회로 제한한다. OAuth state는 10분짜리 일회성 값이고 브라우저 쿠키와 함께 확인한다. PKCE S256을 사용하며 OAuth 토큰은 계정 확인 요청에서만 사용하고 세션·브라우저에 저장하지 않는다. 서비스 토큰 또는 OAuth 설정을 변경하면 기존 세션도 무효화된다.

## 로컬 확인

- pnpm admin:portal:build: 비밀 값 없이 관리자 UI 빌드
- node --test tests/admin-auth.test.mjs: 인증 서버 테스트
- pnpm test: 공개 화면과 관리자 통합 테스트
- pnpm dlx wrangler@4.136.3 deploy --dry-run --config auth-admin/wrangler.jsonc: 외부 배포 없이 서버 빌드 확인

이 작업의 http://127.0.0.1:4180/admin.html 미리보기는 모의 GitHub 응답을 사용한 화면 확인용이다. 실제 계정 연결이나 GitHub 설정 변경·수집 실행을 수행하지 않는다. 실제 로그인은 위 OAuth App와 서버 설정이 완료되어야 사용할 수 있다.

참고: [GitHub OAuth 로그인](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Workers Secret 배포](https://github.com/cloudflare/wrangler-action).


## 2026-10-10 설정 확인 결과

- 저장소의 새 관리자용 Secrets 3개와 Variables 3개는 아직 없다. 기존 수집용 Secrets는 유지했다.
- 로컬 Cloudflare 인증과 OAuth 자격증명이 없으며 사용자는 Cloudflare 계정이 없다고 알려 주었다.
- 따라서 계정 생성 → Workers 하위 도메인 확인 → OAuth App 등록 → 위 표의 값 등록 → 수동 배포가 남았다. 현재 실제 관리자 서버는 배포하지 않았다.
- [Cloudflare 계정 생성](https://dash.cloudflare.com/sign-up), [GitHub OAuth App 등록](https://github.com/settings/applications/new), [저장소 Secrets](https://github.com/Psionic7/psionic7.github.io/settings/secrets/actions), [저장소 Variables](https://github.com/Psionic7/psionic7.github.io/settings/variables/actions).

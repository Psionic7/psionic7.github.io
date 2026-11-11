# 네이버 수집 시간 초과의 단계별 기록

2026-11-12 로컬 구현·검증 기록이다. GitHub의 시간 초과 원인은 새 원격 로그를 받기 전까지 미확정이다. 로컬 성공이나 테스트 서버 성공을 원격 네이버 접속 성공으로 보고하지 않는다.

## 기존 기록의 문제와 수정

기존 Python 작업은 브라우저 이동·렌더링·매물 응답을 같은 `timeout`으로 반환했다. 내부 완료 기한도 페이지 이동이 끝난 뒤 새로 계산해, 이동 전부터 시작한 상위 제한 시간이 먼저 종료될 수 있었다. 기존 로그만으로 문서 접속 실패와 매물 API 대기를 구분하기 어려웠다.

현재는 요청 예산을 하나로 계산한다. 기본 Node 제한 90초 중 Python 작업은 80초를 사용하고 나머지는 실패 기록과 종료에 사용한다. fin 단지 이동 응답은 최대 20초, 개별 브라우저 상태 조회는 최대 5초로 나눈다. 실패 상태·스크린샷은 각각 최대 2초만 기다린다.

## 보존하는 자료

- `local/data-validation/naver-live.json`: DNS/TLS, 전체 결과, 실패 단계, 추적 파일 경로
- `local/data-validation/naver-browser/<UUID>.jsonl`: 브라우저 시작부터 UTC 시각·경과 시간·단계·요청/응답 건수
- 같은 UUID의 `.png`: 실패 당시 익명 공개 화면; 캡처가 실패하면 그 사실도 기록

JSONL은 작업 중 바로 기록하므로 부모 프로세스가 작업을 종료해도 완료한 단계가 남는다. 반복 기록은 제한하고 마지막 실패·완료 기록은 보존한다. Git 제외 경로에만 저장한다. 쿠키·인증 헤더·응답 원문·페이지 본문·URL 쿼리는 추적 파일에 넣지 않는다. 페이지 상태에는 경로, readyState, 본문 글자 수, 매물 링크 수, 접근 제한 문구의 유무만 기록한다.

Node의 DNS/TLS 검사는 Chrome과 별개의 연결 경로다. DNS·TLS 성공만으로 Chrome의 페이지 로딩이나 네이버의 접근 허용을 확정하지 않는다. 프록시 값은 기록하지 않고 설정 여부만 남긴다.

| 이벤트·단계 | 확인하는 사실 |
| --- | --- |
| `browser_start` → `browser_ready` | Chrome 실행·새 탭·관측 준비 |
| `navigation_ack` | 페이지 이동 명령의 반환 여부 |
| `document_request`, `document_redirect`, `document_response` | 문서 요청·리디렉션·HTTP 상태·연결 시간 |
| `dom_content_loaded`, `document_render` | 렌더링과 브라우저 제어 응답 |
| `list_request`, `list_response_headers`, `list_response_body` | 매물 요청·응답·파싱·다음 페이지 유무 |
| `first_list_request`, `first_list_response`, `next_list_response` | 완료되지 않은 대기 조건 |
| `network_failed` | Chrome의 `net::ERR_*`와 취소 여부 |
| `operation_failed`, `failure_state` | 실패 단계·마지막 완료 단계·페이지 상태 |

HTTP 200이어도 전체 매물 응답과 주소 검증을 통과해야 성공이다. 시간 초과·접근 제한·매물 0건은 구분한다.

## 실행

```powershell
$env:NAVER_BROWSER_PYTHON = 'C:/Users/Psionic/Documents/ChatGPT/insane-search/.venv/Scripts/python.exe'
node scripts/check-naver-live.mjs --report local/data-validation/naver-diagnostics-live.json
```

기본 대상은 로컬 동결 기준본에 확정 연결이 있는 단지 `107215`다. 다른 승인 단지는 `--complex-no <번호>`로 지정한다. 활성 승인·현재 범위 해시를 확인하고 기준본의 위치·공유 범위 문맥을 함께 사용한다. 공개 매물 스냅샷의 옛 연결로 대체하지 않는다. 제한 시간은 `--timeout-ms`로 12,000–180,000ms 범위에서 지정하며 기본 90,000ms다. 검증 명령은 작업 DB와 공개 스냅샷을 변경하지 않는다.

현행 fin 수집기는 확정 단지 번호로 수집한다. 예전 실수집 검증에 남은 번호 없는 자동 검색은 현재 경로에서 지원하지 않아, 앞선 수집이 성공해도 후속 `unmatched`로 실패할 수 있었다. 진단 명령과 CI는 확정 번호만 검사하도록 맞췄다. 로컬 연결 검토용 기존 검색기 통합 테스트는 유지한다.

GitHub `naver-listings-smoke.yml`은 요약 JSON과 `naver-browser/**`를 함께 아티팩트로 보존하도록 수정했다. Ubuntu·Windows를 같은 단계로 비교할 수 있다. 변경 코드가 원격에 반영된 이후 실행부터 적용된다.

## 실제 로컬 결과

단지 107215에서 광고 34건·1페이지를 약 9.49초에 수집했다. 결과는 `local/data-validation/naver-diagnostics-live.json`과 연결된 `2118f4ac-2487-4e99-a303-bb9496aff555.jsonl`에 있다.

| 항목 | 관측 |
| --- | ---: |
| Node DNS 조회 | 20ms |
| Node TLS 연결 | 47ms, TLS 1.3 |
| Python 내 Chrome 준비 | 2,172ms |
| 단지 이동 명령 반환 | 907ms |
| 이동 시작 → DOMContentLoaded | 4,547ms |
| 이동 시작 → 첫 매물 요청 | 5,610ms |
| 매물 요청 → 응답 본문 확보 | 750ms |
| 이동 시작 → 수집 자료 확보 | 6,500ms |

문서가 `/complexes/107215`에서 `/map`으로 이동한 뒤 정상 렌더링하고 매물 응답을 받았다. 이 이동 자체를 차단으로 해석하지 않는다. 대표 목록 8개에서 중개사별 광고를 보존한 결과가 34건이다.

## 검사와 남은 확인

실제 Chrome을 사용하는 재현 서버에서 문서 응답을 멈추면 `navigation_ack`, 매물 응답만 멈추면 `first_list_response` 대기로 구분됐다. 두 경우 모두 완료 단계·요청/응답 건수가 파일에 남았다. 부모 오류에도 단계와 파일 경로가 보존된다. 기존 검색·공유 범위·전체 페이지 수집을 포함한 단위·Chrome 통합 검사 27개, 데이터 검사 46개가 통과했다.

현재 확인한 것은 로컬 네트워크·렌더링·매물 응답이 정상이라는 사실이다. GitHub에서 HTTP 응답 전 정지인지, HTML 이후 렌더링 정지인지, 매물 요청 이후 정지인지는 새 원격 추적 파일로 판별해야 한다. IP 차단·네이버 정책·DNS 장애 중 어느 하나로 아직 확정하지 않는다.

최종 명령은 로컬 동결 기준본의 활성 승인과 위치 문맥을 확인한 뒤 다시 실행했다. `naver-diagnostics-approved.json`에서 기준본 세대가 일치했고 같은 단지 34건·1페이지가 8,519ms에 완료됐다. DNS 19ms·TLS 53ms였으며 추적 파일은 `e9b0d8e0-2bee-48f1-bc03-281a1d162bf2.jsonl`이다. 두 번의 실제 성공을 확인했다. 원천 DB와 공개 매물은 변경하지 않았다.

필수 `data:verify`, 원본 대조를 포함한 `build`, `check:publish`, 연결 감사와 `git diff --check`도 통과했다. 이 기록 시점의 변경은 커밋하지 않았다. 프로젝트의 작업별 명시적 커밋·푸시 규칙에 따라, 원격 코드 반영과 새 GitHub 진단 실행은 승인을 기다린다.

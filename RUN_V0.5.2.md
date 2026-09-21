# PlugPark v0.5.2 — 1102 우회 + 빠른 EV D1 Backfill

## 왜 이 버전인가
Cloudflare Worker HTTP 요청 안에서 EV 2페이지를 파싱하고 400행을 D1에 쓰는 과정이 `1102`(Worker resource limit)로 종료되었습니다.
이번 버전은 두 가지를 같이 처리합니다.

1. Worker 수동 ingest는 한 번에 **1페이지만** 허용하고, 성공 전에는 checkpoint/runId를 덮어쓰지 않습니다.
2. 초기 대량 적재는 Worker가 아니라 **사용자 PC의 Node + Wrangler D1 REST 경로**에서 실행합니다. 이 경로는 Worker CPU 1102를 피합니다.

## 적용
ZIP을 프로젝트 루트에 덮어쓴 뒤:

```powershell
npm run deploy
```

추가 migration은 없습니다.

## 가장 빠른 전체 EV 적재
Cloudflare secret의 EV 키와 같은 공공데이터 API 키를 준비한 뒤:

```powershell
npm run ev:backfill
```

키를 물으면 로컬 터미널에만 붙여넣습니다. ChatGPT에 보낼 필요가 없습니다.

기본 동작:
- `numOfRows=1000`
- `zcode=26`
- 최대 3페이지를 로컬에서 받은 뒤 한 번의 D1 SQL 업로드
- `statId + chgerId` UPSERT라 기존 400건과 중복되어도 안전
- `.plugpark/ev-backfill-state.json`에 로컬 checkpoint 저장
- 중간에 끊겨도 같은 명령을 다시 실행하면 다음 페이지부터 재개
- 각 페이지의 `zcode=26`, `pageNo`, 오류 envelope를 검증

완료 후:

```powershell
curl.exe "https://plugpark.dtdt4865.workers.dev/api/d1/ev-info-state?v=52"
curl.exe "https://plugpark.dtdt4865.workers.dev/api/d1/ev-info-search?q=센텀&v=52"
```

## 참고
`.plugpark/ev-backfill-state.json`을 삭제하면 page 1부터 다시 시작합니다. D1은 UPSERT라 DB 중복 행은 생기지 않습니다.

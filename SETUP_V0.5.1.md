# PlugPark v0.5.1 — D1 FOUNDATION + EV INFO INGEST

이번 단계는 기존 UI와 `/api/places` 동작을 바꾸지 않습니다.  
D1 저장 파이프라인을 옆에 추가해서 **EV Info 1~2페이지 저장 → 중복 upsert → checkpoint 재개**를 검증하는 단계입니다.

## 1. 패치 덮어쓰기

ZIP의 `worker/`, `migrations/`, `package.json`을 프로젝트 루트에 덮어씁니다.

## 2. D1 생성

PowerShell:

```powershell
npx wrangler d1 create plugpark-db
```

출력되는 `database_id`를 복사합니다.

## 3. wrangler.toml에 D1 binding 추가

`wrangler.d1.snippet.toml` 내용을 기존 `wrangler.toml` 맨 아래에 추가하고:

```toml
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"
```

부분을 실제 ID로 교체합니다.

기존 `[assets]`, `[vars]`, Worker 설정은 지우지 마세요.

## 4. migration 적용

```powershell
npm run d1:migrate:remote
```

로컬 개발 DB도 필요하면:

```powershell
npm run d1:migrate:local
```

## 5. ingest 관리자 토큰 설정

아무 긴 임의 문자열을 하나 정해서 secret으로 등록합니다.

```powershell
npx wrangler secret put INGEST_ADMIN_TOKEN
```

프롬프트가 뜨면 직접 만든 토큰을 입력합니다.

## 6. 배포

```powershell
npm run deploy
```

배포 로그에 `plugpark@0.5.1`이 보여야 합니다.

## 7. D1 연결 확인

```powershell
curl.exe "https://plugpark.dtdt4865.workers.dev/api/health?v=51"
curl.exe "https://plugpark.dtdt4865.workers.dev/api/d1/health?v=51"
```

정상 핵심값:

```json
{
  "dataLayerVersion": "v0.5.1",
  "d1Configured": true
}
```

## 8. EV Info 2페이지 수집 테스트

현재 PowerShell 세션에 **wrangler secret에 넣었던 것과 같은 값**을 넣습니다.

```powershell
$env:PLUGPARK_INGEST_TOKEN="여기에_같은_토큰"
```

그다음:

```powershell
curl.exe -X POST `
  -H "Authorization: Bearer $env:PLUGPARK_INGEST_TOKEN" `
  "https://plugpark.dtdt4865.workers.dev/api/admin/d1/ev-info-ingest?pages=2"
```

이 호출은 최대 2페이지(현재 페이지 크기 200)를 D1에 저장합니다.

## 9. checkpoint 확인

```powershell
curl.exe "https://plugpark.dtdt4865.workers.dev/api/d1/ev-info-state?v=51"
```

예상 형태:

```json
{
  "ok": true,
  "state": {
    "status": "running",
    "next_page": 3,
    "reported_total_count": 32642
  },
  "stored": {
    "chargerCount": 400
  }
}
```

실제 숫자는 API 응답/중복 여부에 따라 달라질 수 있습니다.

## 10. 동일 2페이지 재호출이 아니라 '다음 페이지' 재개 확인

같은 POST를 다시 실행합니다.

```powershell
curl.exe -X POST `
  -H "Authorization: Bearer $env:PLUGPARK_INGEST_TOKEN" `
  "https://plugpark.dtdt4865.workers.dev/api/admin/d1/ev-info-ingest?pages=2"
```

정상이라면 `next_page`가 3에서 시작해 5로 이동합니다. `stat_id + chger_id`가 PRIMARY KEY라 같은 충전기가 들어와도 행이 중복 생성되지 않습니다.

## 11. 센텀 데이터가 D1에 들어왔는지 확인

```powershell
curl.exe "https://plugpark.dtdt4865.workers.dev/api/d1/ev-info-search?q=센텀&v=51"
```

아직 앞쪽 페이지에 센텀이 없으면 0건일 수 있습니다. 이 단계에서는 전체 수집을 아직 자동으로 돌리지 않습니다.

## v0.5.1에서 의도적으로 하지 않은 것

- Cron 자동 수집: 아직 안 함
- EV Status D1 upsert: 다음 단계
- `/api/places` D1 전환: 아직 안 함
- 기존 Cache EV 수집 코드 삭제: 아직 안 함
- 프론트 polling 삭제: 아직 안 함

먼저 D1 ingest/checkpoint가 정확히 동작하는지 검증한 다음 다음 단계로 넘어갑니다.

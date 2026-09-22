# PlugPark

부산 공영주차장과 한국환경공단 EV 충전소 데이터를 결합해 **주차 + 충전 상태를 함께 보여주는 Cloudflare 웹앱**입니다.

## Current data layer — v0.7.1

사용자 요청에서는 공공 API를 직접 호출하지 않습니다.

```text
EV Info / EV Status ─┐
                     ├─ 수집기/Cron → D1
부산 주차 API ────────┘
                           │
                           ▼
parking_read_model
parking_ev_matches
ev_stations
ev_station_live_status
parking realtime snapshot
                           │
                           ▼
                    GET /api/places
                    upstream call = 0
```

현재 운영 D1의 EV Info 전체 적재는 이미 완료되어 있으므로 일반 배포 과정에서 `npm run ev:backfill`을 다시 실행하지 않습니다.

## 설치

```bash
npm install
```

## 로컬 Worker 설정

실제 값은 `.dev.vars`에만 두고 Git에 커밋하지 않습니다.

```text
BUSAN_PARKING_API_KEY=...
EV_CHARGER_API_KEY=...
INGEST_ADMIN_TOKEN=...
BUSAN_REALTIME_PARKING_API_URL=...
```

`BUSAN_REALTIME_PARKING_API_URL`에는 공공데이터포털의 **부산시설공단 공영주차장 시설 현황 조회 서비스에서 확인한 실제 상세기능 요청주소**를 사용합니다.

PlugPark는 v0.7.1부터 이 URL의 파라미터를 추측해서 추가/삭제하지 않습니다. `serviceKey`가 URL에 없을 때만 별도 API 키를 추가합니다.

## v0.7.1 검증/배포 순서

실제 상세기능 요청주소를 `.dev.vars`에 넣은 뒤 준비 단계는 한 명령으로 실행할 수 있습니다.

```bash
npm run prepare:live
```

이 명령은 Local verify → 실제 Parking API 1회 probe → Remote URL 설정 → read-only preflight 순으로 진행합니다.

세부 단계:

### 1. Local-only 검증

```bash
npm run verify:live
```

- Remote Cloudflare write: 0
- 실제 공공 API call: 0
- fixture 기반 D1/read-model/live overlay 검증
- 숫자 불일치 주차 데이터가 자동 보정되지 않는지 검증

### 2. 실제 부산시설공단 API 계약 Probe

```bash
npm run probe:parking-api
```

- 실제 공공 API GET: 정확히 1회
- Remote D1 write: 0
- 응답 필드 `parkgcd`, `parknm`, `curravacnt`, `parkingcnt`, `maxcnt`, `lastupdatetime` 확인
- 결과는 `.plugpark/parking-api-probe.json`에 저장

### 3. Probe한 URL을 Cloudflare Worker에 설정

```bash
npm run configure:parking-api
```

Probe 결과와 URL hash가 같을 때만 `BUSAN_REALTIME_PARKING_API_URL`을 Worker secret으로 설정합니다. URL에 `serviceKey`가 들어 있으면 제거하고 기존 `BUSAN_PARKING_API_KEY`를 사용합니다.

### 4. Read-only Remote preflight

```bash
npm run preflight:remote
```

EV Info 전체 적재 상태, v0.6 read model, Local PASS, Parking API probe/config receipt를 확인합니다.

### 5. Remote release

```bash
npm run release:live
```

순서:

```text
Local verify
→ read-only preflight
→ D1 migration 1회
→ Worker deploy 1회
→ EV Status incremental sync 1회
→ Parking realtime sync 1회
→ /api/places smoke verify
```

Remote write stage는 자동 재POST하지 않습니다.

## EV Status

- `getChargerStatus`
- 부산 `zcode=26`
- 증분 수집은 `period=10`
- 사용자 요청에서는 API 호출하지 않음
- 상태/statusUpdatedAt이 실제로 바뀐 충전기만 D1 UPSERT
- EV Info 전체 적재를 baseline coverage로 사용하고 Status는 그 위에 overlay
- API retry가 발생하면 실제 attempt 수만큼 `api_usage_daily`에 기록

## 실시간 주차

실시간 주차 응답 계약:

```text
parkgcd
parknm
curravacnt
parkingcnt
maxcnt
lastupdatetime
```

세 숫자가 모두 존재할 때:

```text
curravacnt + parkingcnt == maxcnt
```

가 맞지 않으면 해당 행을 invalid로 처리합니다. 원본 값을 임의로 고쳐 정상 데이터처럼 사용하지 않습니다.

정확히 한 숫자만 누락된 경우에만 다른 두 값에서 파생할 수 있습니다.

## 주요 환경

- React 19
- TypeScript
- Vite
- Cloudflare Workers
- Cloudflare D1
- Kakao Map JavaScript SDK

## 보안

다음 파일은 Git에서 제외됩니다.

```text
.dev.vars
.env*
.plugpark/
payload/
hotfix_payload/
*.sqlite*
```

API 인증키와 관리자 토큰을 소스/프론트 코드에 넣지 않습니다.

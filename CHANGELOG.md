# PlugPark v0.2.1 EV API Fix

## Fixed

- `GET /api/chargers`에서 발생하던 upstream HTTP 522 대응
- `GET /api/places`가 EV API 실패로 같이 실패하는 원인 제거를 위한 EV 조회 안정화

## Implementation

- EV charger endpoint primary: `http://apis.data.go.kr/B552584/EvCharger/getChargerInfo`
- HTTPS endpoint retained as fallback
- `numOfRows=9999` -> `1000` paginated requests
- reads `totalCount` and fetches all Busan pages (`zcode=26`)
- retries transient upstream 408/429/5xx/522/524 errors
- normalizes URL-encoded public-data service keys before `URLSearchParams`

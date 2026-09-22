# PlugPark v0.7.0.3 — Safe LIVE Remote Release

현재 기준:
- Worker dataLayerVersion: `v0.7.0.1`
- LIVE LOCAL VERIFY: PASS
- Cloudflare remote write: 0
- 실제 공공 API call: 0

## 이번 패치가 고치는 것

v0.7.0.1 hotfix 뒤에도 remote scripts 일부가 `v0.7.0`만 정상으로 보던 버전 불일치를 수정합니다.

또한 v0.7 최종 완료 조건은 EV Status + 부산 실시간 주차이므로,
`BUSAN_REALTIME_PARKING_API_URL`이 없을 때 Parking을 조용히 SKIP한 채 배포되는 경로를 막습니다.

### 안전 순서

1. Local verify 재실행 → 새 baseline 생성
2. Read-only remote preflight
3. Parking URL / API secrets / EV Info / v0.6 read model 확인
4. 위 조건이 모두 PASS한 경우에만 remote write 시작
5. D1 migration 1회
6. Worker deploy 1회
7. EV Status incremental sync 1회
8. Parking realtime sync 1회
9. `/api/places` upstream call=0 smoke verify

자동 재POST는 없습니다.

## 실행

### Preflight만
```powershell
python .\apply_v0_7_0_3_safe_live_remote_release.py --preflight
```

이 단계는 remote write 0입니다.

### Preflight PASS 후 release
```powershell
python .\apply_v0_7_0_3_safe_live_remote_release.py --release
```

`BUSAN_REALTIME_PARKING_API_URL`이 설정되지 않았다면 **remote write/deploy 전에 중단**합니다.

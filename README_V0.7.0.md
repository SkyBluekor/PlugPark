# PlugPark v0.7.0 LIVE DATA LOCAL-FIRST

## 이번 단계
v0.6.2.1에서 성공한 D1 read model은 유지하고, EV Status와 부산 실시간 주차를
**사용자 요청과 분리된 scheduled sync**로 추가합니다.

### 핵심
- `/api/places`는 D1-only. 외부 API 호출 0회.
- EV Status: 10분 주기, `period=10`, 최대 9999/page, changed-row only.
- 영향받은 EV station만 live summary 재계산.
- Parking realtime: 5분 주기.
- Parking realtime은 100개 단위 JSON snapshot chunk로 저장해 D1 writes를 크게 줄임.
- 마지막 정상 snapshot 유지. 빈 성공 응답/스키마 오류에서는 기존 snapshot 삭제 금지.
- API usage safety budget.
- Local fixture 검증에서는 실제 공공 API call 0, remote D1 write 0.

## 적용 + 로컬 검증

```powershell
python .\apply_v0_7_0_live_data.py --verify
```

성공 기준:

```text
✅ LIVE LOCAL VERIFY: PASS
Cloudflare remote write: 0
실제 공공 API call: 0
```

## Remote 적용
로컬 PASS 후에만:

```powershell
npm run release:live
```

### 부산 실시간 주차 URL
`BUSAN_REALTIME_PARKING_API_URL`이 Remote에 없으면 v0.7.0 release는
EV Status까지 적용하고 Parking live stage는 명시적으로 SKIP합니다.

공공데이터포털 활용신청 화면에서 제공되는 실제 요청 URL을 확인한 뒤 설정해야 합니다.
URL을 추측해서 코드에 하드코딩하지 않습니다.

# PlugPark v0.6.0 적용

이 ZIP의 파일을 `C:\TAEWOO\CapstonDesign\PlugPark` 루트에 경로 그대로 덮어씁니다.
EV Info 32,642건 D1 데이터는 삭제하거나 재수집하지 않습니다.

## 사용자가 실행할 명령은 1개

```powershell
npm run release
```

`release`가 자동으로 다음을 수행합니다.
1. `tsc -b && vite build`
2. `wrangler deploy`
3. D1 `ev_stations` 집계
4. 공영주차장 read model 생성
5. 주차장 ↔ EV 사전매칭 생성
6. `/api/d1/read-model-state` 자동 확인
7. `/api/places`가 D1 read path인지 자동 확인
8. `센텀` match-debug 자동 확인

`PLUGPARK_INGEST_TOKEN` 환경변수가 없으면 read model 준비 단계에서 토큰을 한 번 입력하라고 나옵니다.

정상 종료 마지막 줄:

```text
✅ PlugPark v0.6.0 자동 검증 완료
```

그 다음 웹 화면을 한 번만 확인하면 됩니다.

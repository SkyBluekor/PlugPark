# PlugPark v0.6.0 적용

현재 프로젝트 루트에 이 ZIP의 파일을 경로 그대로 덮어씁니다.

EV Info 32,642건은 삭제하거나 재수집하지 않습니다.

## 실행
PowerShell에서 관리자 토큰 환경변수가 이미 있다면:

```powershell
npm run release
```

없다면 `data:prepare` 단계에서 한 번 입력을 요청합니다.

`release`는 빌드/배포 후 D1 read model을 `stations → parking → matches` 순서로 준비합니다.
마지막 출력에서 `ready: true`를 확인한 뒤 웹을 한 번 열면 됩니다.

## 구조 변경
- `/api/places`는 EV/주차 upstream을 호출하지 않고 D1 read model만 읽습니다.
- EV Info 사용자 polling/cache 수집을 UI에서 제거했습니다.
- `ev_stations`에 32,642 charger를 statId 단위로 집계합니다.
- `parking_ev_matches`는 배포 준비 단계에서 사전 계산합니다.
- 이름 포함 매칭은 Dice 0.72 제한을 제거하여 `해운대센텀시티` ↔ `센텀시티` 같은 케이스를 처리합니다.
- `/api/d1/match-debug?q=센텀`으로 매칭 근거를 확인할 수 있습니다.

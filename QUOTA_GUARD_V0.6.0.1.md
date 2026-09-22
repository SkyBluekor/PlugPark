# PlugPark v0.6.0.1 — D1 Free quota guard

## 지금 발생한 오류
Cloudflare D1 Free의 **일일 row write 한도**를 이미 사용한 상태입니다.
이 상태에서는 재시도 횟수를 늘려도 성공하지 않으므로 즉시 중단하도록 변경했습니다.

## 변경
- D1 daily row write/read quota 오류 감지
- quota 오류는 5회 재시도하지 않고 즉시 종료
- 이미 성공한 `npm run deploy`를 다시 할 필요가 없도록 `resume:v0.6` 추가
- 기존 EV Info 32,642건은 삭제/초기화하지 않음

## 한도 초기화 후 실행
```powershell
npm run resume:v0.6
```

이 명령은:
1. stations read model
2. parking read model
3. parking↔EV matches
4. v0.6 검증

만 실행합니다. Worker 재배포와 EV 전체 backfill은 다시 하지 않습니다.

## 중요
현재 quota 오류는 코드 재시도로 해결되는 종류가 아닙니다.
Free 한도 초기화: 매일 00:00 UTC = 한국시간 09:00

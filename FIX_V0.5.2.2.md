# PlugPark v0.5.2.2 — Wrangler Windows spawn fix

## 원인
v0.5.2.1은 Windows에서 `cmd.exe /c`를 통해 Wrangler를 실행했지만,
DB 이름에 넣은 따옴표가 literal argument로 전달되어 Wrangler가
`"plugpark-db"`라는 이름의 DB를 찾으려 했습니다.

또한 종료 과정에서 Node/uv assertion까지 발생했습니다.

## 수정
- `npx.cmd` / `cmd.exe`를 완전히 사용하지 않음
- 현재 Node(`process.execPath`)로 `node_modules/wrangler/bin/wrangler.js` 직접 실행
- DB 이름과 SQL 경로를 child_process 인자 배열로 전달
- Windows shell quoting 문제 제거
- D1 저장 단위를 3페이지(3000건) → 1페이지(1000건)로 축소
- 한 페이지 저장 성공 직후 checkpoint 기록

## 실행
배포는 필요 없습니다. 로컬 스크립트만 바뀝니다.

PowerShell 권장:

```powershell
$env:EV_CHARGER_API_KEY="본인의_API_KEY"
npm run ev:backfill
```

기존 D1 데이터는 `(stat_id, chger_id)` UPSERT이므로 다시 page 1부터 시작해도 중복되지 않습니다.

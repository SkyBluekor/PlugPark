# v0.5.2.1 Windows backfill fix

## 수정 이유
Windows + Node.js 24에서 `spawnSync("npx.cmd", ..., shell:false)`가 `EINVAL`을 반환할 수 있습니다.

## 수정
- Windows에서는 `cmd.exe /d /s /c`를 통해 Wrangler 실행
- macOS/Linux는 기존처럼 `npx` 직접 실행
- 기존 D1 데이터는 `stat_id + chger_id` UPSERT이므로 재실행해도 중복되지 않음
- 로컬 checkpoint가 저장된 이후부터는 자동 재개

## 실행
```powershell
npm run ev:backfill
```

이전 실패는 D1 저장 전 발생했으므로 `.plugpark/ev-backfill-state.json`이 없다면 page 1부터 다시 조회할 수 있습니다.
기존 D1 400건과 겹치는 행은 UPDATE되어 중복되지 않습니다.

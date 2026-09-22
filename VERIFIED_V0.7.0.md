# v0.7.0 사전 검증 결과

패치 생성 환경에서 아래를 실제 확인했습니다.

- `worker/index.ts` TypeScript standalone compile PASS
- `src/App.tsx`, `src/types.ts` TypeScript syntax/transpile PASS
- `verify-live-local.mjs`, `live-remote-preflight.mjs`, `release-live.mjs`,
  `live-state-remote.mjs`, `source-baseline.mjs` → `node --check` PASS
- SQLite에서 migration 0001 + 0002 + 0003 + local fixture 적용 PASS
- EV Status JSON upsert / PK conflict update SQL PASS
- 영향 station live summary 집계 SQL PASS
- Parking realtime link upsert SQL PASS
- `apply_v0_7_0_live_data.py`를 v0.6.2.1 스냅샷에 적용 PASS
- apply 재실행 idempotence PASS
- wrangler.toml `[triggers] crons = ["*/5 * * * *"]` 패치 PASS

아직 실제 사용자 프로젝트 전체 production build 및 Wrangler local 실행은
사용자 프로젝트의 설치된 `node_modules`, `tsconfig`, 실제 `wrangler.toml`이 필요하므로
다음 한 명령이 최종 로컬 검증을 수행합니다.

```powershell
python .\apply_v0_7_0_live_data.py --verify
```

이 검증은 Remote Cloudflare write와 실제 공공 API 호출을 하지 않습니다.

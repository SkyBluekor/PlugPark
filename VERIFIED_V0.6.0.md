# PlugPark v0.6.0 검증 보고

## 실제로 확인한 것
- `worker/index.ts` TypeScript `--noEmit --noUnusedLocals --noUnusedParameters` 검사 PASS
- `src/App.tsx`, `src/types.ts` TypeScript 검사 PASS (KakaoMap/mock은 테스트 stub으로 대체)
- `prepare-read-models.mjs`, `verify-v0.6.mjs` Node syntax check PASS
- SQLite에서 v0.5.1 + v0.6.0 schema 적용 PASS
- SQLite JSON1 기반 parking read model insert PASS
- `ev_chargers -> ev_stations` 집계 SQL smoke test PASS
- `해운대센텀시티 공영주차장 -> 센텀시티` 포함 이름 candidate smoke test PASS
- 사전 match -> `/api/places`용 aggregate query smoke test PASS
- `handlePlaces` 내부 upstream `fetch()` 없음 확인 PASS
- `handlePlaces` 내부 `EV_INFO_URL`, `EV_STATUS_URL` 참조 없음 확인 PASS
- 프론트 `setTimeout` EV polling 제거 확인 PASS
- 프론트 `/api/parking-places` 선행 호출 제거 확인 PASS
- EV 페이지 수집 진행 UI 제거 확인 PASS

## 아직 확인하지 않은 것
- 사용자의 실제 로컬 전체 프로젝트에서 `npm run build`
- 실제 Cloudflare D1에서 read model 생성 결과
- 실제 센텀 데이터의 최종 match 개수
- 실제 배포 화면 렌더링

이 네 항목은 `npm run release`가 빌드/배포/read model 생성/API 자동 검증까지 연속 수행하도록 구성했습니다. 마지막 화면 확인만 사용자가 하면 됩니다.

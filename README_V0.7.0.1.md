# PlugPark v0.7.0.1 — Type inference hotfix

## 실패 원인

`readRowToPlace()`가 반환하는 `charger.statusFresh`의 초기값이 단순 `null`이어서
TypeScript가 `ReturnType<typeof readRowToPlace>` 안의 타입을 `null`로 좁혀 추론했습니다.

그 뒤 `/api/places`에서 실제 LIVE 상태인 `boolean`을 넣으면:

```text
boolean is not assignable to null
```

오류가 발생했습니다.

API/D1/Cloudflare 문제가 아니라 **TypeScript 반환 타입 추론 문제**입니다.

## 수정

```ts
statusFresh: null
```

을 다음으로 변경합니다.

```ts
statusFresh: null as boolean | null
```

따라서 `applyParkingRealtimeOverlay()`가 받는 place 타입도 자연스럽게
`statusFresh: boolean | null`로 추론됩니다.

## 검증

ZIP을 프로젝트 루트에 풀고:

```powershell
python .\apply_v0_7_0_1_type_hotfix.py --verify
```

이 명령은 수정 후 기존 `npm run verify:live-local`을 다시 실행합니다.

- Cloudflare remote write: 0
- 실제 공공 API call: 0
- fixture/local D1만 사용

## 완료 기준

마지막에:

```text
✅ LIVE LOCAL VERIFY: PASS
Cloudflare remote write: 0
실제 공공 API call: 0
```

가 나오면 다음 remote release 단계로 넘어갑니다.

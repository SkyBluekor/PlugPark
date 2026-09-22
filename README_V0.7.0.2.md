# PlugPark v0.7.0.2 — Local verifier version fix

## 원인

v0.7.0.1 hotfix가 Worker의 `dataLayerVersion`을 `v0.7.0.1`로 올렸지만,
`verify-live-local.mjs`는 여전히 `v0.7.0`만 정답으로 검사했습니다.

그래서 실제 기능 실패가 아니라 다음 assertion에서 검증이 중단됐습니다.

```text
dataLayerVersion=v0.7.0.1
```

## 수정
- health 기대 버전: `v0.7.0` → `v0.7.0.1`
- `/api/places` 기대 버전: `v0.7.0` → `v0.7.0.1`
- verify result 기록 버전도 `v0.7.0.1`
- Windows `npm.cmd` 문제를 피하려고 재검증은 `node scripts/verify-live-local.mjs` 직접 실행

## 실행

```powershell
python .\apply_v0_7_0_2_verify_version_fix.py --verify
```

Cloudflare remote write와 실제 공공 API call은 0입니다.

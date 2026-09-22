# PlugPark v0.6.2 SAFE REMOTE RELEASE

목적: v0.6.1 LOCAL VERIFY PASS 이후 Cloudflare에 한 번만 안전하게 적용.

## 핵심
- read model 재생성의 DELETE + INSERT를 D1 batch로 묶어 실패 시 기존 read model 보존
- remote preflight는 read-only
- deploy 1회
- stations / parking / matches POST를 각각 1회만 실행
- quota / auth / network 실패 시 자동 재POST 금지
- 응답 유실 가능성이 있는 network failure는 `npm run status:remote`로 상태만 확인
- release 전에 LOCAL VERIFY를 다시 자동 실행

## 실행
프로젝트 루트에 압축을 풀고:

```powershell
python .\apply_v0_6_2_safe_remote_release.py --release
```

성공 마지막:
```text
✅ REMOTE RELEASE: PASS
```

실패 시 자동 재시도하지 않습니다. 특히 D1 quota 오류에서는 추가 write를 하지 않습니다.

# PlugPark v0.6.1 LOCAL-FIRST RECOVERY

목표: Cloudflare Remote를 개발/테스트 환경으로 사용하지 않고, 현재 로컬 소스를 기준으로 로컬 D1 + 로컬 Worker에서 먼저 검증합니다.

## 적용
프로젝트 루트 `C:\TAEWOO\CapstonDesign\PlugPark` 에 이 ZIP 내용을 풀고:

```powershell
python .\apply_v0_6_1_local_recovery.py --verify
```

한 명령으로:
1. 현재 `worker/index.ts`, `package.json` 백업
2. 예상 v0.6.0 구조인지 확인 (다르면 무수정 중단)
3. LOCAL_FIXTURE_MODE 추가
4. fixture/검증 스크립트 추가
5. 현재 소스 hash/Git baseline 저장
6. TypeScript + Vite build
7. 격리 Local D1 schema/fixture 생성
8. Local Worker 기동
9. stations → parking → matches 생성
10. `/api/places` D1-only 확인
11. 센텀 회귀 테스트
12. remote write 0 확인

## 성공 기준
마지막:
`✅ LOCAL VERIFY: PASS`

## 중요한 안전장치
- Cloudflare Remote D1 write 없음
- EV 전체 backfill 없음
- 현재 소스 구조가 예상과 다르면 파일을 덮어쓰지 않고 중단
- 원본은 `.plugpark/recovery-backup-v0.6.1/`에 저장

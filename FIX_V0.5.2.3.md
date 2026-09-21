# PlugPark v0.5.2.3 — Resilient D1 backfill

이번 오류는 EV API가 아니라 `wrangler d1 execute --remote` 도중 네트워크 연결이 끊긴 것입니다.

수정:
- EV API는 기존처럼 1000건씩 조회
- D1 업로드는 1000건 한 파일 → 200건씩 5개 작은 commit으로 분할
- 각 D1 commit 실패 시 최대 4회 자동 재시도
- 재시도 대기: 1.5초 → 4초 → 8초
- 모든 row chunk가 성공한 뒤에만 remote checkpoint 증가
- 중간 chunk에서 실패해도 다음 실행에서 같은 페이지를 다시 UPSERT하므로 중복 없음
- 한 페이지 완료 후 local checkpoint 저장

배포 필요 없음. 로컬 스크립트만 교체한 뒤:

```powershell
npm run ev:backfill
```

을 실행하세요.

정상 진행 예:

EV page 1 조회... 1000건
D1 저장: page 1~1, 1000건
  D1 rows 1-200 / 1000
  D1 rows 201-400 / 1000
  ...
  D1 rows 801-1000 / 1000
✓ checkpoint nextPage=2

네트워크가 잠깐 끊기면 자동으로 같은 chunk를 재시도합니다.

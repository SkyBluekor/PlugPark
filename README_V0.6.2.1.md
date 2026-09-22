# PlugPark v0.6.2.1 Parking Dedup Hotfix

원격 `parking` stage의 `UNIQUE constraint failed: parking_read_model.parking_id`를 수정합니다.

## 원인
운영 부산 공영주차장 응답/실시간 JOIN 결과에는 동일 `parking_id`가 둘 이상 존재할 수 있지만, 로컬 fixture는 모두 유일한 ID라 이 조건을 검증하지 못했습니다. `parking_read_model.parking_id`는 PRIMARY KEY라 한 batch 안에 중복 ID가 들어가면 전체 stage가 실패합니다.

## 수정
- 원본 공영주차장 normalization 직후 `parking_id` 1차 중복 제거
- `parking_read_model` write 직전 2차 방어 중복 제거
- 관리번호가 없는 주차장은 fallback ID에 이름+주소 사용
- duplicate fixture를 local verification에 추가
- remote resume은 이미 성공한 `stations`를 다시 쓰지 않음
- hotfix deploy 1회, parking 1회, matches 1회만 실행
- remote stage 자동 재시도 없음

## 실행
```powershell
python .\apply_v0_6_2_1_parking_dedupe_hotfix.py --resume
```

정상 종료:
```text
✅ LOCAL VERIFY: PASS
...
Remote read model parking (1회) ... PASS
Remote read model matches (1회) ... PASS
✅ REMOTE RESUME: PASS
```

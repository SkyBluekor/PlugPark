# PlugPark v0.3 — 실시간 주차 + EV 전체 캐시

## 변경사항
- 기존 부산광역시 공영주차장 API를 기본/요금/운영정보용으로 유지
- 부산시설공단 실시간 주차 API를 환경변수 URL로 추가 연결
- 두 주차 API를 이름/주소/좌표/코드 점수로 병합
- 주차가능/현재주차/최대주차/최종갱신 값을 실시간 API 우선으로 반영
- EV 첫 화면은 1000건 quick snapshot으로 빠르게 표시
- 부산 16개 구·군 EV 전체 정보는 Cloudflare Cache API에 백그라운드 수집
- getChargerStatus 최근 10분 상태를 statId+chgerId 기준으로 덮어쓰기
- EV 매칭을 단순 200m에서 거리+이름+주소 점수 기반으로 개선
- 매칭되지 않은 공영주차장도 P 마커로 유지
- 전체 EV 캐시가 만들어진 뒤 프론트가 최대 2회 자동 재조회

## 딱 한 번 필요한 설정
공공데이터포털에서 승인받은
`부산시설공단_공영주차장 시설 현황 조회 서비스`
상세기능의 **요청주소**를 복사해서 Cloudflare 환경변수로 등록하세요.

권장:
`BUSAN_REALTIME_PARKING_API_URL=<요청주소>`

API 키는 기존 `BUSAN_PARKING_API_KEY`를 그대로 사용합니다.

## 진단
- `/api/parking-diagnostics`
- `/api/ev-diagnostics`
- `/api/health`

# PlugPark v0.2.3 Fast Load

- 첫 화면에서 `/api/parking-places`를 먼저 받아 실제 공영주차장을 즉시 표시
- EV 매칭은 백그라운드에서 갱신하여 화면 전체가 오래 멈춰 보이는 문제 제거
- EV 전체 32642건 순회 제거
- 부산 16개 구·군(zscode) 단위로 작게 분할 조회
- 구·군 요청 4개씩 병렬 처리
- 구·군당 최대 2페이지(500건 x 2)로 상한 설정
- 중복 충전기 제거
- EV 데이터 메모리 캐시 10분
- 최종 `/api/places` 응답 Cloudflare Cache 5분
- EV 실패 시 Demo로 갈아타지 않고 실제 부산 공영주차장 결과 유지

배포:
npm run deploy

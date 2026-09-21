# PlugPark 프로젝트 명세 v0.1

## 1. 한 줄 정의

**부산 공영주차장 실시간 주차면과 전기자동차 충전소 상태를 공간적으로 매칭해, “지금 주차 + 충전이 동시에 가능한 곳”을 찾는 웹앱.**

## 2. 타깃 사용자

- 부산에서 전기차를 운전하는 사용자
- 외부에서 부산으로 차량 방문한 EV 운전자
- 목적지 주변에서 주차와 충전을 한 번에 해결하려는 사용자

## 3. 해결할 문제

1. 주차장은 찾았지만 EV 충전기가 없는 경우
2. 충전소는 찾았지만 실제 주차 여유를 알기 어려운 경우
3. 서로 다른 서비스에서 주차/충전 정보를 번갈아 확인하는 불편

PlugPark의 차별점은 **각 API 결과를 단순히 나란히 보여주는 것이 아니라 좌표를 기준으로 JOIN(공간 매칭)** 하는 것입니다.

## 4. MVP 범위

### 필수
- 부산 공영주차장 목록/실시간 주차면 조회
- 부산 지역 EV 충전기 조회
- 주차장-충전소 반경 매칭 (기본 200m, 50~500m 설정 가능)
- 충전 상태 집계: 사용 가능 / 충전 중 / 전체
- 급속/완속 구분
- 이름/주소/충전소 검색
- 현재 위치 기준 거리 정렬
- 상세 패널
- API Secret 서버측 보호

### 후순위
- Kakao Map 실제 지도
- 길찾기
- 즐겨찾기
- 최근 검색
- 충전기 상태 변경 알림
- D1 기반 이력 수집/혼잡 패턴

## 5. 데이터 소스

### 부산광역시 공영주차장 정보 서비스
사용 필드:
- `pkNam` 주차장명
- `mgntNum` 관리번호
- `doroAddr`, `jibunAddr` 주소
- `pkCnt` 주차구획수
- `currava` 실시간주차면수
- `xCdnt`, `yCdnt` 위·경도
- `pkBascTime`, `tenMin`, `feeInfo` 요금
- `svcSrtTe`, `svcEndTe`, `oprDay` 운영정보

### 한국환경공단 전기자동차 충전소 정보
사용 필드:
- `statNm`, `statId`, `chgerId`
- `lat`, `lng`
- `chgerType`
- `stat` (`2` 사용가능, `3` 충전중 등)
- `statUpdDt`
- `output`
- `delYn`
- 부산 필터 `zcode=26`

## 6. 공간 매칭

```text
공영주차장 좌표 (lat/lng)
        +
EV 충전기 좌표 (lat/lng)
        ↓
Haversine 거리 계산
        ↓
기본 반경 200m 이하
        ↓
PlugPark 장소 후보
```

MVP에서는 시설명 문자열이 서로 다를 수 있기 때문에 이름 JOIN보다 좌표 기반 매칭을 우선합니다.

## 7. 시스템 구조

```text
Browser (React + Vite)
        ↓ same origin
Cloudflare Worker
   ├── /api/parking
   ├── /api/chargers
   └── /api/places  ← 공간 매칭
        ↓
   Public Data APIs
```

API Key는 Worker에만 존재하며 프론트엔드에는 전달하지 않습니다.

## 8. 보안 규칙

- 실제 API Key를 Git에 커밋하지 않음
- 로컬: `.dev.vars` (gitignore)
- 운영: Cloudflare Secret
- `VITE_BUSAN_PARKING_API_KEY` 같은 형태로 만들지 않음: `VITE_*`는 브라우저에 노출됨
- `.env`, `.dev.vars` 모두 `.gitignore`에 포함

## 9. UI 방향

- 전형적인 파스텔/카드형 AI UI보다 타이포그래피/정보 밀도 중심
- 주차: P, 충전: 번개 아이콘으로 즉시 구분
- 핵심 숫자: `주차 37/120`, `충전 가능 3/4`
- 지도 API 전에는 좌표 기반 분포도로 위치 관계만 직관적으로 표시
- 컨셉 이미지는 `docs/concepts/plugpark-project-board.png`와 `public/plugpark-hero.png` 참고

## 10. 완료 기준

1. API Secret이 설정되면 `/api/places`가 실데이터 반환
2. 매칭 장소가 목록에 표시
3. 실시간 주차면, 충전 가능 수, 급/완속 개수가 보임
4. 위치 권한 허용 시 가까운 순 정렬
5. Secret 미설정 시 UI 개발을 계속할 수 있도록 DEMO 데이터 표시
6. Cloudflare 배포 후 API Key가 브라우저 Network/JS bundle에 노출되지 않음

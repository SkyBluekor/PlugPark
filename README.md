# PlugPark

부산 공영주차장 정보와 한국환경공단 전기차 충전소 정보를 좌표로 결합해 **주차 + 충전이 동시에 가능한 장소**를 보여주는 Cloudflare 웹앱입니다.

## v0.2 핵심 변경

- 실제 **Kakao Map Web(JavaScript) SDK** 적용
- 기존 `부산 매칭 분포` 가짜 지도 제거
- `WHY PLUGPARK`, `DATA 01/02`, `SECURITY` 소개 섹션 제거
- 검색 결과 영역을 화면 높이 안에 고정하고 내부 스크롤 사용
- 처음 20개만 렌더링하고 `더 보기`로 20개씩 추가
- 리스트 클릭 ↔ 지도 위치 이동 ↔ 상세 Drawer 연동
- P⚡ 커스텀 마커, 현재 위치 마커
- 주차 가능 / 충전 가능 / 급속 / 완속 필터
- 충전 가능순 / 주차 여유순 / 현재 위치 거리순 정렬
- Hero를 축소하고 EV 주차장 이미지로 교체
- 상세 Drawer에서 Kakao Map 보기 / 길찾기 연결

## 1. 설치

```bash
npm install
```

## 2. 로컬 Worker Secret

`.dev.vars`:

```text
BUSAN_PARKING_API_KEY=공공데이터포털_인증키
EV_CHARGER_API_KEY=공공데이터포털_인증키
MATCH_RADIUS_METERS=200
```

공공데이터 API 키는 프론트에 넣지 않습니다.

## 3. Kakao Map JavaScript 키

프로젝트 루트 `.env`:

```env
VITE_KAKAO_MAP_JS_KEY=카카오_JavaScript_키
```

카카오 JavaScript 키는 Web SDK 특성상 브라우저에서 사용되는 키입니다. Git 저장소에는 `.env`를 올리지 않고, Kakao Developers의 **JavaScript SDK 도메인 제한**으로 사용 도메인을 제한합니다.

등록 예:

```text
https://plugpark.dtdt4865.workers.dev
http://127.0.0.1:8787
```

Kakao Developers에서 **Kakao Map API 사용 설정도 ON**이어야 합니다.

## 4. 로컬 실행

```bash
npm run cf:dev
```

기본 주소:

```text
http://127.0.0.1:8787
```

API 확인:

```text
/api/health
/api/parking
/api/chargers
/api/places
```

## 5. 운영 Secret

```bash
npx wrangler secret put BUSAN_PARKING_API_KEY
npx wrangler secret put EV_CHARGER_API_KEY
```

배포:

```bash
npm run deploy
```

## 6. 데이터 매칭

```text
부산 공영주차장 좌표
        +
EV 충전기 좌표
        ↓
Haversine 거리 계산
        ↓
MATCH_RADIUS_METERS 이내 충전기 집계
        ↓
PlugPark 장소
```

현재 200m 공간 매칭은 MVP 기준입니다. 다음 데이터 품질 단계에서는 주소/시설명 유사도까지 함께 적용할 예정입니다.

## 7. 주요 환경변수

```text
.dev.vars / Cloudflare Secret
- BUSAN_PARKING_API_KEY
- EV_CHARGER_API_KEY

wrangler.toml 일반 변수
- MATCH_RADIUS_METERS

.env 프론트 변수
- VITE_KAKAO_MAP_JS_KEY
```

## 8. 주요 구조

```text
PlugPark/
├─ src/
│  ├─ components/
│  │  └─ KakaoMap.tsx
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ mock.ts
│  ├─ types.ts
│  └─ styles.css
├─ worker/
│  └─ index.ts
├─ public/
│  └─ plugpark-hero-v2.jpg
├─ .dev.vars
├─ .env
├─ wrangler.toml
└─ package.json
```

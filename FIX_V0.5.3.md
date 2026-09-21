# v0.5.3 Direct D1 upload

`wrangler d1 execute --remote --file` import API가 장시간 대기/Network connection lost/OAuth 10000 오류를 반복하여 backfill 경로에서 제거했습니다.

로컬 스크립트는 환경공단 EV API를 읽은 뒤 100건씩 PlugPark Worker의 관리자 endpoint로 전송합니다. Worker는 이미 연결된 D1 binding을 사용해 직접 UPSERT합니다.

실패한 HTTP chunk는 자동 재시도하며, 페이지 checkpoint는 모든 chunk 성공 뒤에만 이동합니다.

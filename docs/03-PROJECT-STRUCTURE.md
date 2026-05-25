# 프로젝트 구조

## 루트 파일
- `server.js`
  - Node HTTP 서버
  - Hermes CLI 호출 래퍼
  - 파일 업로드 처리
  - LAN/로컬 접근 제어
  - Hermes 응답 정리(`review diff`, `session_id` 등 필터)

- `start-hermes-chat-ui.command`
  - macOS 더블클릭 실행 스크립트
  - Hermes/Node 설치 여부 확인 후 서버 시작

- `package.json`
  - 프로젝트 메타데이터
  - `npm start` = `node server.js`

- `README.md`
  - 프로젝트 기본 설명

## public/
- `public/index.html`
  - UI 뼈대
- `public/styles.css`
  - 텔레그램 스타일 UI
  - 좌측 목록 리사이즈 스타일 포함
- `public/app.js`
  - 채팅 스레드 저장/전환
  - 메시지 전송
  - 첨부파일 처리
  - 슬래시 명령 처리
  - 한글 IME 조합 입력 전송 보정

## uploads/
- 업로드된 파일 저장 폴더
- 배포 zip에는 포함하지 않는 것을 권장

## 실행 흐름
1. 브라우저에서 메시지 입력
2. `public/app.js`가 `/api/chat` 호출
3. `server.js`가 `hermes chat -q ... -Q` 실행
4. Hermes 응답에서 `session_id` 파싱
5. 응답 텍스트를 정리 후 브라우저에 표시

## 빌드 관점 요약
- 번들러 없음
- 트랜스파일 없음
- npm 의존성 설치 없음
- Node 표준 모듈만 사용
- 따라서 이식성과 복사 배포가 쉬움

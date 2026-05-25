# Hermes Telegram Chat UI - 문서 시작점

이 폴더는 다른 컴퓨터에서 이 웹앱을 바로 실행하고 수정할 수 있게 만든 Markdown 문서 세트입니다.

## 핵심 결론
- 이 프로젝트는 별도 프론트엔드 빌드 과정이 없습니다.
- `node server.js` 또는 `./start-hermes-chat-ui.command`로 바로 실행됩니다.
- 다른 컴퓨터에는 `Hermes CLI`와 `Node.js`만 있으면 됩니다.

## 문서 순서
1. `01-QUICKSTART.md`
   - 가장 빠른 실행 방법
2. `02-BUILD-RUN-ON-ANOTHER-COMPUTER.md`
   - 다른 맥/컴퓨터로 옮겨 실행하는 절차
3. `03-PROJECT-STRUCTURE.md`
   - 파일 구조와 역할
4. `04-TEST-CHECKLIST.md`
   - 실행 후 점검 항목
5. `05-TROUBLESHOOTING.md`
   - 자주 생기는 문제 해결

## 프로젝트 특징
- Hermes CLI 직접 호출
- 브라우저 `localStorage` 기반 채팅 스레드 저장
- 파일 업로드 지원
- `/help`, `/new`, `/resume` 등 웹앱 명령 지원
- 한국어 IME(한글 조합 입력) 전송 버그 수정 반영
- Hermes 내부 verbose/thinking 노이즈 응답 필터링 반영

## 추천 사용 방식
- GitHub에서 clone 또는 zip 다운로드
- 압축 해제 후 `start-hermes-chat-ui.command` 실행
- 브라우저에서 `http://127.0.0.1:8793` 접속

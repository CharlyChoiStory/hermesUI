#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v hermes >/dev/null 2>&1; then
  echo "[오류] Hermes CLI를 찾지 못했습니다."
  echo "먼저 맥북에어에 Hermes를 설치하고 'hermes --version'이 되는지 확인하세요."
  read -r -p "엔터를 누르면 종료합니다..." _
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[오류] Node.js를 찾지 못했습니다."
  echo "먼저 맥북에어에 Node.js를 설치하고 'node --version'이 되는지 확인하세요."
  read -r -p "엔터를 누르면 종료합니다..." _
  exit 1
fi

PORT="${PORT:-8793}"
HOST="${HOST:-127.0.0.1}"
ALLOW_LAN="${ALLOW_LAN:-0}"
HERMES_TIMEOUT_MS="${HERMES_TIMEOUT_MS:-1800000}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"

mkdir -p "$HERMES_HOME/logs"
chmod 700 "$HERMES_HOME" "$HERMES_HOME/logs" 2>/dev/null || true
if ! touch "$HERMES_HOME/logs/agent.log" 2>/dev/null; then
  echo "[오류] Hermes 로그 파일에 쓸 수 없습니다: $HERMES_HOME/logs/agent.log"
  echo "Finder/터미널 권한 문제일 수 있습니다. 이 파일을 터미널에서 다시 실행해 주세요."
  read -r -p "엔터를 누르면 종료합니다..." _
  exit 1
fi

printf '\nHermes Telegram Chat UI 시작\n'
printf '폴더: %s\n' "$SCRIPT_DIR"
printf 'Hermes: %s\n' "$(command -v hermes)"
printf 'Node: %s\n' "$(command -v node)"
printf 'Hermes home: %s\n' "$HERMES_HOME"
printf 'Hermes timeout: %s ms\n' "$HERMES_TIMEOUT_MS"

if [ "$ALLOW_LAN" = "1" ]; then
  if [ "$HOST" = "127.0.0.1" ]; then
    HOST="0.0.0.0"
  fi
  printf '접속 URL: http://%s:%s (같은 와이파이 허용)\n\n' "$HOST" "$PORT"
else
  printf '접속 URL: http://%s:%s (로컬 전용)\n\n' "$HOST" "$PORT"
fi

printf '중지: 이 창에서 Control+C\n\n'

HOST="$HOST" PORT="$PORT" ALLOW_LAN="$ALLOW_LAN" HERMES_TIMEOUT_MS="$HERMES_TIMEOUT_MS" HERMES_HOME="$HERMES_HOME" node server.js

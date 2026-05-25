#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/hermes-chat-ui-8793.log"
PORT="${PORT:-8793}"
HOST="${HOST:-127.0.0.1}"
ALLOW_LAN="${ALLOW_LAN:-0}"
HERMES_TIMEOUT_MS="${HERMES_TIMEOUT_MS:-1800000}"

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PORT HOST ALLOW_LAN HERMES_TIMEOUT_MS

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Node.js not found: $NODE_BIN" >> "$LOG_FILE"
  exit 1
fi

if ! command -v hermes >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Hermes CLI not found in PATH" >> "$LOG_FILE"
  exit 1
fi

while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') Port $PORT is already in use; waiting for it to become available." >> "$LOG_FILE"
  sleep 15
done

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting Hermes Chat UI on http://$HOST:$PORT" >> "$LOG_FILE"
exec "$NODE_BIN" server.js

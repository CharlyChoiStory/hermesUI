#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LABEL="local.hermes.chat-ui"
OLD_LABEL="com.charlychoi.hermes-chat"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
OLD_PLIST_PATH="$LAUNCH_AGENTS_DIR/$OLD_LABEL.plist"
USER_ID="$(id -u)"
NODE_BIN="$(command -v node || true)"
PORT="${PORT:-8793}"

cd "$APP_DIR"
chmod +x "$APP_DIR/auto-start-hermes-chat-ui.sh"
mkdir -p "$LAUNCH_AGENTS_DIR"

if [ -z "$NODE_BIN" ]; then
  echo "[오류] Node.js를 찾지 못했습니다. 먼저 node --version 이 동작하는지 확인하세요."
  read -r -p "엔터를 누르면 닫습니다..." _
  exit 1
fi

launchctl bootout "gui/$USER_ID/$OLD_LABEL" >/dev/null 2>&1 || true
if [ -f "$OLD_PLIST_PATH" ]; then
  mv "$OLD_PLIST_PATH" "$OLD_PLIST_PATH.disabled" \
    || echo "[경고] 기존 자동 실행 항목을 비활성화하지 못했습니다: $OLD_PLIST_PATH"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/auto-start-hermes-chat-ui.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$APP_DIR/logs/hermes-chat-ui-launchd.log</string>

  <key>StandardErrorPath</key>
  <string>$APP_DIR/logs/hermes-chat-ui-launchd.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>APP_DIR</key>
    <string>$APP_DIR</string>
    <key>NODE_BIN</key>
    <string>$NODE_BIN</string>
    <key>PORT</key>
    <string>$PORT</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>ALLOW_LAN</key>
    <string>0</string>
    <key>HERMES_TIMEOUT_MS</key>
    <string>1800000</string>
    <key>HERMES_HOME</key>
    <string>$HOME/.hermes</string>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "$PLIST_PATH"
launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$USER_ID" "$PLIST_PATH"
launchctl enable "gui/$USER_ID/$LABEL"
launchctl kickstart -k "gui/$USER_ID/$LABEL"

echo
echo "Hermes Chat UI 자동 실행 등록 완료"
echo "주소: http://127.0.0.1:$PORT/"
echo "재부팅 후에도 로그인하면 자동으로 서버가 실행됩니다."
echo
read -r -p "엔터를 누르면 닫습니다..." _

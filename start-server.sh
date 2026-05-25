#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd "$SCRIPT_DIR"
export PORT="${PORT:-8793}"
export HOST="${HOST:-127.0.0.1}"
export ALLOW_LAN="${ALLOW_LAN:-0}"
export HERMES_TIMEOUT_MS="${HERMES_TIMEOUT_MS:-1800000}"
exec node server.js

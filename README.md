# Hermes Telegram Chat UI

Local-first Telegram-style web UI for the Hermes CLI.

This app runs on your own computer, calls your local `hermes` command, and keeps chat history in the browser. It is useful when you want a lightweight PWA-style interface for Hermes without running a cloud service.

## Features

- Telegram-style chat layout with saved local threads
- Hermes CLI wrapper using `hermes chat -q ... -Q`
- Session resume support through Hermes `session_id`
- Streaming answer display with live execution log panel
- Tool/thinking/API progress log formatting
- File upload support for local Hermes workflows
- PWA install support
- Optional macOS LaunchAgent auto-start
- Local-only by default: `127.0.0.1`

## Requirements

- macOS, Linux, or Windows with a shell
- Node.js 18 or newer
- Hermes CLI installed and authenticated locally

Check:

```bash
node --version
hermes --version
```

This project does not include Hermes credentials or model settings. Each user must configure Hermes on their own machine.

## Quick Start

```bash
git clone https://github.com/YOUR_ACCOUNT/hermes-telegram-chat-ui.git
cd hermes-telegram-chat-ui
chmod +x start-hermes-chat-ui.command
./start-hermes-chat-ui.command
```

Open:

```text
http://127.0.0.1:8793
```

You can also run it directly:

```bash
npm start
```

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8793` | Server port |
| `ALLOW_LAN` | `0` | Set `1` to allow same `/24` LAN access |
| `HERMES_TIMEOUT_MS` | `1800000` | Hermes request timeout |

Example:

```bash
HOST=0.0.0.0 ALLOW_LAN=1 PORT=8793 npm start
```

## PWA Install

1. Start the local server.
2. Open `http://127.0.0.1:8793` in Chrome, Edge, or Safari.
3. Use the browser's install/add-to-dock option.

Important: a PWA cannot start the Node server by itself. The local server must already be running.

## macOS Auto Start

To start the server automatically after login:

```bash
chmod +x install-auto-start.command
./install-auto-start.command
```

This registers a user LaunchAgent that starts the app on `http://127.0.0.1:8793`.

## Files

- `server.js`: Node HTTP server and Hermes CLI bridge
- `public/`: browser UI, PWA manifest, service worker, icons
- `start-hermes-chat-ui.command`: simple foreground launcher
- `install-auto-start.command`: macOS auto-start installer
- `auto-start-hermes-chat-ui.sh`: LaunchAgent target script
- `.env.example`: example configuration

## Privacy

- Chat threads are stored in browser `localStorage`.
- Uploaded files are stored under `uploads/`.
- Logs are stored under `logs/`.
- `uploads/`, `logs/`, local config, and private app artifacts are excluded from Git.

## Troubleshooting

If the site cannot be reached, make sure the server is running:

```bash
curl http://127.0.0.1:8793/api/health
```

If Hermes does not answer:

```bash
hermes --version
hermes chat -q "hello" -Q
```

If the PWA shows old behavior, close and reopen it. If needed, remove and reinstall the PWA so the browser refreshes the service worker cache.

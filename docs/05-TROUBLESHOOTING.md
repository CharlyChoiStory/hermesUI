# Troubleshooting

## `hermes: command not found`

Hermes CLI is not installed or is not in `PATH`.

```bash
command -v hermes
hermes --version
```

## `node: command not found`

Install Node.js 18 or newer.

```bash
command -v node
node --version
```

## Browser Cannot Connect

Check whether the server is running:

```bash
curl http://127.0.0.1:8793/api/health
lsof -nP -iTCP:8793 -sTCP:LISTEN
```

Run manually:

```bash
PORT=8793 HOST=127.0.0.1 npm start
```

## Port Conflict

Use another port:

```bash
PORT=8794 npm start
```

Then open:

```text
http://127.0.0.1:8794
```

## HTTPS Does Not Work

This app serves plain HTTP by default:

```text
http://127.0.0.1:8793
```

## LAN Access Does Not Work

Start with LAN enabled:

```bash
HOST=0.0.0.0 ALLOW_LAN=1 PORT=8793 npm start
```

Use the host computer's local IP from another device on the same Wi-Fi.

## Internal English Text Appears In Replies

Restart the server and refresh/reinstall the PWA. The app filters common Hermes verbose, thinking, and internal preamble text before displaying answers.

## The UI Waits Forever

The app sends heartbeat events while Hermes is working and detects inactive streams. If the UI still looks stuck:

1. Press `중단`.
2. Refresh the page.
3. Check Hermes directly:

```bash
hermes chat -q "hello" -Q
```

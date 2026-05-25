# Test Checklist

## Server

Open:

```text
http://127.0.0.1:8793
```

Expected:

- Hermes Local Chat title
- New chat button
- Message input
- Send button

## Health API

```bash
curl http://127.0.0.1:8793/api/health
```

Expected: JSON with `ok: true`.

## Message Test

Send:

```text
안녕. 한 줄로 답해.
```

Expected:

- User message appears once
- Hermes response appears
- Internal verbose/thinking text is not shown in the left answer bubble
- Right panel shows execution events, not a duplicate answer

## Korean IME

Send Korean text with Enter and with the send button.

Expected:

- No duplicated final character
- No double submission

## Sessions

Check:

- `+ 새 채팅`
- `/new`
- `/help`
- `/sessions`
- `/resume`

## File Upload

Attach a small text or image file.

Expected:

- Attachment appears in the chat
- File is stored under `uploads/`
- Hermes can reference the local uploaded path

## Optional LAN

Run:

```bash
HOST=0.0.0.0 ALLOW_LAN=1 PORT=8793 npm start
```

Expected: another same-Wi-Fi device can open `http://YOUR_LOCAL_IP:8793`.

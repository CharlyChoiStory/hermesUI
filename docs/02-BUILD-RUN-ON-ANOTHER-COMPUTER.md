# Run On Another Computer

## Overview

The app is a single Node server plus static files in `public/`. There is no frontend build step and no runtime npm dependency.

## Requirements

```bash
node --version
hermes --version
```

## Install From GitHub

```bash
git clone https://github.com/YOUR_ACCOUNT/hermes-telegram-chat-ui.git
cd hermes-telegram-chat-ui
```

## Run

```bash
npm start
```

Open:

```text
http://127.0.0.1:8793
```

## Change Port

```bash
PORT=8794 npm start
```

Open:

```text
http://127.0.0.1:8794
```

## Allow Same Wi-Fi Access

By default the app is local-only. To allow devices on the same `/24` LAN:

```bash
HOST=0.0.0.0 ALLOW_LAN=1 PORT=8793 npm start
```

Open from another device:

```text
http://YOUR_LOCAL_IP:8793
```

## Why Local Instead Of Cloud

This app is designed for personal Hermes use. It relies on the local `hermes` CLI, local Hermes authentication, and local browser storage.

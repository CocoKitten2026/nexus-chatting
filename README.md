# 💬 Nexus

A self-hosted, privacy-first chat and voice platform built for schools and communities. Built with vanilla JavaScript and Bun — no frameworks, no tracking, no ads.

---

## ✨ Features

- 🔐 **End-to-end encrypted** private messages (ECDH P-256 + AES-GCM)
- 🎙 **Voice channels** with WebRTC peer-to-peer audio
- 📱 **Native Android app** via Capacitor (mic stays alive like a real call)
- 💬 **Text channels** with file attachments and emoji picker
- 🤖 **AI chatbot** powered by Google Gemini
- 🔒 **Password-protected channels**
- 👑 **Admin controls** — ban, kick, mute, broadcast
- 🌙 Multiple themes — Dark, Light, AMOLED, Green
- 📵 **Phone call overlay** — keeps mic recording when you switch apps

---

## 🚀 Quick Start

### Requirements
- [Bun](https://bun.sh) runtime

### Run the server
```bash
bun run server.js
```

Server starts on port `3000`. Users connect via WebSocket at `ws://yourserver:3000/ws`.

---

## ⚙️ Configuration

### Gemini AI Chatbot
Open `index.html` and find this line near the top of the script section:

```js
const GEMINI_API_KEY = "paste-your-gemini-api-key-here"; // 👈 paste your Gemini API key here
```

Replace `paste-your-gemini-api-key-here` with your key from [Google AI Studio](https://aistudio.google.com).

---

## 🏫 Self-Hosting for Schools

Nexus is designed so the **school runs the server but cannot read private messages** — E2E encryption means only the sender and recipient can decrypt DMs.

### Recommended server setup
1. Get a domain with HTTPS (required for mic access in browsers)
2. Use [Caddy](https://caddyserver.com) for automatic SSL:
```
your.domain.edu {
    reverse_proxy localhost:3000
}
```
3. Run the server with Bun
4. Distribute the APK to students

### Admin controls (server console)
| Command | Description |
|---|---|
| `list` | Show online users |
| `ban <name>` | Ban a user |
| `unban <name>` | Unban a user |
| `kick <name>` | Kick a user |
| `broadcast <message>` | Send message to all channels |
| `accounts` | List all registered accounts |
| `channels` | List all channels |
| `delchannel <id>` | Delete a channel |
| `history <channel>` | View last 20 messages |
| `clear <channel>` | Clear channel history |

---

## 📱 Android App

Built with [Capacitor](https://capacitorjs.com). The app uses a native foreground service so the microphone keeps recording when you switch apps — just like a real phone call.

### Build the APK
```bash
bun add @capacitor/core @capacitor/android @capacitor/cli
mkdir www && cp index.html www/
bunx cap init "Nexus" "com.yourname.nexus" --web-dir "www"
bunx cap add android
bunx cap sync android
bunx cap open android
```

Then in Android Studio: **Build → Generate App Bundles or APKs → Generate APKs**

---

## 🔒 Privacy

- Private messages are E2E encrypted — the server never sees plaintext
- No telemetry, no analytics, no ads
- Self-hosted — your data stays on your server
- Passwords are hashed with bcrypt

---

## 📄 License

GPL-3.0 — free to use, modify and self-host.

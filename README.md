# 💬 Nexus

A self-hosted Discord-like messaging platform with real-time text chat, voice channels, AI chatbot, file attachments, emoji pickers, password-protected channels, and persistent user accounts. Built with vanilla JavaScript and Bun.

---

## ✨ Features

- 🔐 Account system (register + sign in, persisted across reconnects)
- 💬 Text channels with chat history, typing indicators, and emoji
- 🔊 Voice channels with WebRTC peer-to-peer audio
- 📎 Image attachments in chat
- 🔒 Password-protected custom channels (text and voice)
- 🤖 Built-in AI chatbot powered by Gemini
- 🎨 Multiple themes (Dark, Light, AMOLED, Green)
- 📱 PWA installable on mobile
- 🌐 Cloudflare Tunnel support for external access

---

## 🖥️ Windows Setup

### 1. Install Bun

Open **PowerShell as Administrator** and run:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Close and reopen PowerShell after it finishes, then verify:

```powershell
bun --version
```

### 2. Run the Server

Put `index.html` and `server.js` in the same folder, then:

```powershell
cd C:\path\to\your\nexus\folder
bun run server.js
```

Nexus is now running at **http://localhost:3000**

### 3. Install Cloudflare Tunnel (Windows)

Download `cloudflared` from the [official releases page](https://github.com/cloudflare/cloudflared/releases/latest) — grab `cloudflared-windows-amd64.exe` and place it in your Nexus folder.

**Login to Cloudflare:**
```powershell
.\cloudflared-windows-amd64.exe tunnel login
```

**Start the tunnel:**
```powershell
.\cloudflared-windows-amd64.exe tunnel --url http://localhost:3000 --proxy-keepalive-timeout 300s --proxy-connection-timeout 300s --proxy-tcp-keepalive 30s --no-autoupdate
```

Your public URL will look like:
```
https://something.trycloudflare.com
```

Share this with your users. They connect using:
```
wss://something.trycloudflare.com/ws
```

> ⚠️ Keep the terminal window open — the tunnel stays up as long as it's running.

---

## 🐧 Linux Setup

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

Verify:

```bash
bun --version
```

### 2. Run the Server

```bash
cd /path/to/your/nexus/folder
bun run server.js
```

Nexus is now running at **http://localhost:3000**

To keep it running after closing the terminal:

```bash
nohup bun run server.js &
```

Or with a proper process manager:

```bash
# Install pm2
npm install -g pm2

# Start Nexus
pm2 start server.js --interpreter bun --name nexus

# Auto-start on reboot
pm2 startup
pm2 save
```

### 3. Install Cloudflare Tunnel (Linux)

```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

**Login to Cloudflare:**
```bash
cloudflared tunnel login
```

**Start the tunnel:**
```bash
cloudflared tunnel --url http://localhost:3000 --proxy-keepalive-timeout 300s --proxy-connection-timeout 300s --proxy-tcp-keepalive 30s --no-autoupdate
```

**Run as a system service so it never stops:**
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

---

## 🚀 First Time Use

1. Open your Nexus URL in a browser (or `http://localhost:3000` for local)
2. Click **Create Account**
3. Choose your avatar, enter a username and password
4. Enter the server WebSocket URL:
   - Local: `ws://localhost:3000/ws`
   - Cloudflare: `wss://your-tunnel-url.trycloudflare.com/ws`
5. Start chatting!

---

## 🖥️ Server Terminal Commands

Once the server is running you can type these commands directly in the terminal:

| Command | Description |
|---|---|
| `list` | Show all online players |
| `accounts` | List all registered accounts |
| `channels` | List all custom channels |
| `kick <name>` | Disconnect a player |
| `delaccount <name>` | Delete an account permanently |
| `delchannel <id>` | Delete a custom channel |
| `groups` | List all voice groups |
| `force <player> <group>` | Move a player to a group |
| `broadcast <message>` | Send a system message to all channels |
| `history <channel-id>` | Print last 20 messages in a channel |
| `clear <channel-id>` | Wipe a channel's chat history |
| `help` | Show all commands |

Built-in channel IDs: `general`, `off-topic`, `help`, `media`

---

## 📁 File Structure

```
nexus/
├── index.html       # Frontend client (everything in one file)
├── server.js        # Bun relay server
├── accounts.json    # User accounts (auto-created on first register)
├── channels.json    # Custom channels (auto-created when you create a channel)
└── README.md
```

---

## 🔑 Setting Up the AI Chatbot (Gemini API Key)

The chatbot requires a free Gemini API key. There is **no key pre-installed** — each user adds their own.

### Get a free key
1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API Key** — it's completely free

### Add your key to Nexus
1. Open Nexus in your browser and sign in
2. Click **⚙️ Settings** (bottom left of the screen)
3. Find the **🤖 Chatbot API Key** section
4. Paste your API key and click **Save**

The key is stored in your browser locally — it is never sent to the Nexus server and stays private to your device. Each person who uses your Nexus server needs to add their own key to use the chatbot.

> If no key is set, the chatbot will display a message explaining how to add one instead of showing an error.

---

## 📋 Requirements

| Tool | Version |
|---|---|
| [Bun](https://bun.sh) | Latest |
| A modern browser | Chrome, Firefox, Edge, Safari |
| Microphone | Required for voice channels only |

---

## ⚡ Quick Start (copy-paste)

**Windows:**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
# reopen PowerShell then:
bun run server.js
```

**Linux:**
```bash
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc && bun run server.js
```

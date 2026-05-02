#!/bin/bash

# ── Nexus Server Startup Script ──────────────────────────────────────────────

echo "🚀 Starting Nexus..."

# Kill any existing instances
pkill -f "bun" 2>/dev/null
pkill -f "cloudflared" 2>/dev/null

# Wait for port to be fully released
sleep 3

# Check if port 3000 is still in use and force kill
PORT_PID=$(lsof -ti :3000 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
  echo "⚠️  Force killing process on port 3000 (PID $PORT_PID)"
  kill -9 $PORT_PID 2>/dev/null
  sleep 1
fi

# Start Bun server in background
nohup bun run ~/server.js > ~/nexus.log 2>&1 &
echo "✅ Bun server started (PID $!)"

sleep 2

# Start Cloudflare tunnel in background
nohup cloudflared tunnel run --url http://localhost:3000 nexus > ~/tunnel.log 2>&1 &
echo "✅ Cloudflare tunnel started (PID $!)"

echo ""
echo "🟢 Nexus is running! You can close SSH now."
echo ""
echo "Useful commands:"
echo "  tail -f ~/nexus.log     — view server logs"
echo "  tail -f ~/tunnel.log    — view tunnel logs"
echo "  pkill -f 'bun'          — stop the server"
echo "  pkill -f 'cloudflared'  — stop the tunnel"
echo "  ~/start-nexus.sh        — restart everything"

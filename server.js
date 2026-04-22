/**
 * Nexus — Relay Server (Bun)
 * Usage:  bun run server.js
 *
 * Accounts are stored in ./accounts.json (auto-created).
 * Passwords are hashed with Bun.password (bcrypt).
 * No auth codes. Users register once and sign in every time.
 */

import { join, dirname } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

const PORT   = 3000;
const __dir  = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE  = join(__dir, "accounts.json");
const CHANNELS_FILE  = join(__dir, "channels.json");
const BANS_FILE      = join(__dir, "bans.json");

// ── Tunables ───────────────────────────────────────────────────────────────
const MAX_MSG_HISTORY  = 200;
const MAX_MSG_LENGTH   = 2000;
const TYPING_DEBOUNCE  = 4000;
const NAME_REGEX       = /^[a-zA-Z0-9_\- ]{2,32}$/;
const CHANNEL_REGEX    = /^[a-zA-Z0-9\-_]{2,32}$/;

// ── Voice channel groups (pre-created, never auto-deleted) ─────────────────
const BUILTIN_GROUPS   = new Set(["global","vc-general","vc-gaming","vc-study","vc-private"]);
const TEXT_CHANNEL_IDS = ["general","off-topic","help","media"];

// ── Accounts: name (lowercase) → { name, passwordHash, emoji, createdAt } ─
const accounts = new Map();

// ── Bans: name (lowercase) → { name, reason, bannedAt, bannedBy } ──────────
const bans = new Map();

// ── Custom channels: id → { id, name, kind, passwordHash|null, createdBy, createdAt }
const customChannels = new Map();

// ── Runtime state ──────────────────────────────────────────────────────────
const wsClients      = new Map();
const playerGroups   = new Map();
const playerBroadcast= new Map();
const playerPubKeys  = new Map(); // name → base64 SPKI public key
const groups         = new Map();
const typingTimers   = new Map();
const chatHistory    = new Map();

TEXT_CHANNEL_IDS.forEach(id => chatHistory.set(id, []));
BUILTIN_GROUPS.forEach(g  => groups.set(g, { password:null, members:new Set() }));

// ── Persist accounts ───────────────────────────────────────────────────────
async function loadAccounts() {
  try {
    const file = Bun.file(ACCOUNTS_FILE);
    if (!(await file.exists())) return;
    const data = await file.json();
    for (const acc of data) accounts.set(acc.name.toLowerCase(), acc);
    console.log(`[ACC]  Loaded ${accounts.size} account(s) from ${ACCOUNTS_FILE}`);
  } catch (e) {
    console.warn("[ACC]  Could not load accounts.json:", e.message);
  }
}

async function saveAccounts() {
  try {
    await Bun.write(ACCOUNTS_FILE, JSON.stringify([...accounts.values()], null, 2));
  } catch (e) {
    console.warn("[ACC]  Could not save accounts.json:", e.message);
  }
}

// ── Persist bans ───────────────────────────────────────────────────────────
async function loadBans() {
  try {
    const file = Bun.file(BANS_FILE);
    if (!(await file.exists())) return;
    const data = await file.json();
    for (const b of data) bans.set(b.name.toLowerCase(), b);
    console.log(`[BAN]  Loaded ${bans.size} ban(s) from ${BANS_FILE}`);
  } catch (e) {
    console.warn("[BAN]  Could not load bans.json:", e.message);
  }
}

async function saveBans() {
  try {
    await Bun.write(BANS_FILE, JSON.stringify([...bans.values()], null, 2));
  } catch (e) {
    console.warn("[BAN]  Could not save bans.json:", e.message);
  }
}

// ── Persist custom channels ────────────────────────────────────────────────
async function loadChannels() {
  try {
    const file = Bun.file(CHANNELS_FILE);
    if (!(await file.exists())) return;
    const data = await file.json();
    for (const ch of data) {
      customChannels.set(ch.id, ch);
      // Restore group for voice channels
      if (ch.kind === "voice") {
        groups.set(ch.id, { password: ch.passwordHash || null, members: new Set() });
        BUILTIN_GROUPS.add(ch.id);
      }
      // Restore chat history slot for text channels
      if (ch.kind === "text" && !chatHistory.has(ch.id)) {
        chatHistory.set(ch.id, []);
      }
    }
    console.log(`[CH]   Loaded ${customChannels.size} custom channel(s)`);
  } catch (e) {
    console.warn("[CH]   Could not load channels.json:", e.message);
  }
}

async function saveChannels() {
  try {
    await Bun.write(CHANNELS_FILE, JSON.stringify([...customChannels.values()], null, 2));
  } catch (e) {
    console.warn("[CH]   Could not save channels.json:", e.message);
  }
}

// ── Build channel list payload (safe — no password hashes) ─────────────────
function buildChannelListPayload() {
  const textChannels  = [];
  const voiceChannels = [];
  for (const ch of customChannels.values()) {
    const safe = { id: ch.id, name: ch.name, topic: ch.topic||`#${ch.name} channel`, hasPassword: !!ch.passwordHash };
    if (ch.kind === "text")  textChannels.push(safe);
    if (ch.kind === "voice") voiceChannels.push(safe);
  }
  return { textChannels, voiceChannels };
}

// ── Helpers ────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }

function broadcast(msg, excludeName=null) {
  const raw = typeof msg==="string" ? msg : JSON.stringify(msg);
  for (const [name, ws] of wsClients.entries()) {
    if (name===excludeName) continue;
    try { ws.send(raw); } catch {}
  }
}

function broadcastToGroup(groupName, msg, excludeName=null) {
  const group = groups.get(groupName); if (!group) return;
  const raw = typeof msg==="string" ? msg : JSON.stringify(msg);
  for (const member of group.members) {
    if (member===excludeName) continue;
    const ws = wsClients.get(member);
    if (ws) try { ws.send(raw); } catch {}
  }
}

function getGroup(name) { return playerGroups.get(name) || "global"; }

function broadcastPlayerList() {
  const keys = [...wsClients.keys()];
  const host  = keys[0] ?? "";
  const players = keys.map(name => ({
    id: name, name,
    emoji:  accounts.get(name.toLowerCase())?.emoji || "",
    isHost: name===host,
    group:  getGroup(name),
    pubkey: playerPubKeys.get(name) || null,
  }));
  const msg = JSON.stringify({ type:"player-list", players });
  for (const ws of wsClients.values()) try { ws.send(msg); } catch {}
}

function joinGroup(playerName, groupName) {
  const cur = getGroup(playerName);
  if (cur && groups.has(cur)) {
    groups.get(cur).members.delete(playerName);
    broadcastToGroup(cur, { type:"player-left-group", playerName, group:cur });
  }
  if (!groups.has(groupName)) return false;
  groups.get(groupName).members.add(playerName);
  playerGroups.set(playerName, groupName);
  const ws = wsClients.get(playerName);
  if (ws) send(ws, { type:"group-joined", group:groupName });
  broadcastToGroup(groupName, { type:"player-joined-group", playerName, group:groupName }, playerName);
  broadcastPlayerList();
  return true;
}

function cleanupPlayer(name) {
  if (!wsClients.has(name)) return;
  wsClients.delete(name);
  playerBroadcast.delete(name);
  playerPubKeys.delete(name);
  for (const key of [...typingTimers.keys()]) {
    if (key.startsWith(`${name}:`)) { clearTimeout(typingTimers.get(key)); typingTimers.delete(key); }
  }
  const grp = getGroup(name);
  if (grp && groups.has(grp)) groups.get(grp).members.delete(name);
  playerGroups.delete(name);
  if (!BUILTIN_GROUPS.has(grp) && groups.has(grp) && groups.get(grp).members.size===0) {
    groups.delete(grp);
    console.log(`[GRP]  "${grp}" deleted (empty after ${name} left)`);
  }
  console.log(`[WS]   ${name} disconnected`);
  broadcastPlayerList();
  broadcast({ type:"player-left", playerName:name });
}

function storeMessage(channelId, msg) {
  if (!chatHistory.has(channelId)) chatHistory.set(channelId, []);
  const arr = chatHistory.get(channelId);
  arr.push(msg);
  if (arr.length > MAX_MSG_HISTORY) arr.shift();
}

function sendChatHistory(ws) {
  const channels = {};
  for (const [id, msgs] of chatHistory.entries()) channels[id] = msgs.slice(-50);
  send(ws, { type:"chat-history", channels });
}

function clearTyping(name, channel) {
  const key = `${name}:${channel}`;
  const t   = typingTimers.get(key);
  if (t) { clearTimeout(t); typingTimers.delete(key); }
}

// ── Message handler ────────────────────────────────────────────────────────
async function handleMessage(ws, data) {
  const { type } = data;

  // PTT controller (external hardware/app)
  if (type==="ptt-controller") { ws.data = { ...ws.data, isPttController:true }; return; }
  if (type==="ptt") {
    const msg = JSON.stringify({ type:"ptt-command", active:data.active });
    for (const client of wsClients.values()) try { client.send(msg); } catch {}
    return;
  }

  // ── Register (create account) ────────────────────────────────────────────
  if (type==="register") {
    const name     = data.name?.trim();
    const password = data.password;
    const emoji    = data.emoji || "🧑";

    if (!name || !NAME_REGEX.test(name)) {
      send(ws, { type:"auth-fail", reason:"Invalid username. 2–32 chars, letters/numbers/spaces/_ or -." });
      return;
    }
    if (!password || password.length < 4) {
      send(ws, { type:"auth-fail", reason:"Password must be at least 4 characters." });
      return;
    }
    if (accounts.has(name.toLowerCase())) {
      send(ws, { type:"auth-fail", reason:`Username "${name}" is already taken. Please sign in or choose another name.` });
      return;
    }
    // Check if this name is banned
    if (bans.has(name.toLowerCase())) {
      const ban = bans.get(name.toLowerCase());
      send(ws, { type:"banned", reason:ban.reason, bannedAt:ban.bannedAt });
      return;
    }

    const passwordHash = await Bun.password.hash(password);
    const acc = { name, passwordHash, emoji, createdAt: Date.now() };
    accounts.set(name.toLowerCase(), acc);
    await saveAccounts();
    console.log(`[ACC]  Registered: ${name} ${emoji}`);

    completeLogin(ws, name, emoji);
    return;
  }

  // ── Login ────────────────────────────────────────────────────────────────
  if (type==="login") {
    const name     = data.name?.trim();
    const password = data.password;

    if (!name) { send(ws, { type:"auth-fail", reason:"Username is required." }); return; }

    // Check ban BEFORE checking account — banned users see ban screen immediately
    if (bans.has(name.toLowerCase())) {
      const ban = bans.get(name.toLowerCase());
      console.log(`[BAN]  Blocked login attempt from banned user "${name}"`);
      send(ws, { type:"banned", reason:ban.reason, bannedAt:ban.bannedAt });
      return;
    }

    const acc = accounts.get(name.toLowerCase());
    if (!acc) {
      send(ws, { type:"auth-fail", reason:`No account found for "${name}". Please create an account first.` });
      return;
    }

    const ok = await Bun.password.verify(password || "", acc.passwordHash);
    if (!ok) {
      console.log(`[AUTH] Failed login for "${name}"`);
      send(ws, { type:"auth-fail", reason:"Incorrect password." });
      return;
    }

    // Kick existing session for same account (reconnect from new tab/device)
    if (wsClients.has(acc.name)) {
      const old = wsClients.get(acc.name);
      try { send(old, { type:"kicked", reason:"You signed in from another location." }); old.close(); } catch {}
      cleanupPlayer(acc.name);
    }

    console.log(`[AUTH] ✓ ${acc.name} signed in`);
    completeLogin(ws, acc.name, acc.emoji);
    return;
  }

  // ── Only authenticated past here ─────────────────────────────────────────
  const senderName = ws.data?.playerName;
  if (!senderName || !wsClients.has(senderName)) return;

  // ── Chat message ─────────────────────────────────────────────────────────
  if (type==="chat-message") {
    const channelId = data.channel;
    const isBuiltIn = TEXT_CHANNEL_IDS.includes(channelId);
    const isCustom  = customChannels.has(channelId) && customChannels.get(channelId).kind === "text";
    if (!isBuiltIn && !isCustom) return;
    const raw = String(data.content||"").trim().slice(0,MAX_MSG_LENGTH);
    if (!raw && !data.attachment) return;
    const acc = accounts.get(senderName.toLowerCase());
    const msg = {
      type:"chat-message", channel:channelId,
      from:senderName, emoji:acc?.emoji||"",
      content:raw, timestamp:Date.now(),
      ...(data.attachment  ? { attachment:  data.attachment  } : {}),
      ...(data.e2e         ? { e2e:         true,
                               recipient:   data.recipient,
                               iv:          data.iv,
                               senderPub:   data.senderPub   } : {}),
    };
    // Only store E2E messages as ciphertext (server can't read them anyway)
    storeMessage(channelId, { from:msg.from, emoji:msg.emoji, content:msg.content, timestamp:msg.timestamp, attachment:msg.attachment||null, e2e:msg.e2e||false });
    broadcast(msg);
    clearTyping(senderName, channelId);
    broadcast({ type:"typing-stop", from:senderName, channel:channelId }, senderName);
    return;
  }

  // ── Typing ───────────────────────────────────────────────────────────────
  if (type==="typing") {
    const channelId = data.channel;
    const isBuiltIn = TEXT_CHANNEL_IDS.includes(channelId);
    const isCustom  = customChannels.has(channelId) && customChannels.get(channelId).kind === "text";
    if (!isBuiltIn && !isCustom) return;
    const key = `${senderName}:${channelId}`;
    if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
    const t = setTimeout(()=>{ typingTimers.delete(key); }, TYPING_DEBOUNCE);
    typingTimers.set(key, t);
    broadcast({ type:"typing", from:senderName, channel:channelId }, senderName);
    return;
  }

  // ── WebRTC signaling ─────────────────────────────────────────────────────
  if (type==="offer"||type==="answer"||type==="ice-candidate") {
    const targetName  = data.targetId;
    const senderGroup = getGroup(senderName);
    const targetGroup = getGroup(targetName);
    const allowed = senderGroup===targetGroup||senderGroup==="global"||targetGroup==="global"||playerBroadcast.get(senderName)||playerBroadcast.get(targetName);
    if (allowed) {
      const target = wsClients.get(targetName);
      if (target) try { target.send(JSON.stringify({...data,fromId:data.fromId??senderName})); } catch {}
    }
    return;
  }

  // ── Group management ─────────────────────────────────────────────────────
  if (type==="create-group") {
    const { groupName, password } = data;
    if (!groupName) return;
    if (groups.has(groupName)) { /* silently succeed for voice channels */ return; }
    groups.set(groupName, { password:password||null, members:new Set() });
    console.log(`[GRP]  "${groupName}" created by ${senderName}`);
    joinGroup(senderName, groupName);
    return;
  }

  if (type==="join-group") {
    const { groupName, password } = data;
    if (!groupName||!groups.has(groupName)) { send(ws, { type:"group-error", msg:`"${groupName}" does not exist.` }); return; }
    const g = groups.get(groupName);
    // For custom voice channels, password is a bcrypt hash — compare properly
    const ch = customChannels.get(groupName);
    if (ch?.passwordHash) {
      const ok = password ? await Bun.password.verify(password, ch.passwordHash) : false;
      if (!ok) { send(ws, { type:"group-error", msg:"Wrong password." }); return; }
    } else if (g.password && g.password !== password) {
      send(ws, { type:"group-error", msg:"Wrong password." }); return;
    }
    joinGroup(senderName, groupName);
    return;
  }

  if (type==="leave-group") { joinGroup(senderName,"global"); return; }
  if (type==="set-broadcast") { playerBroadcast.set(senderName,!!data.active); return; }

  // ── Floor control (host only) ─────────────────────────────────────────────
  if (type==="floor-control") {
    const host = [...wsClients.keys()][0];
    if (senderName!==host) return;
    const msg = JSON.stringify({ type:"floor-mute", active:data.active });
    for (const [name, client] of wsClients.entries()) if(name!==senderName) try{client.send(msg);}catch{}
    return;
  }

  if (type==="ping") { send(ws, { type:"pong" }); return; }

  // ── Public key registration (E2E encryption) ──────────────────────────────
  if (type==="set-pubkey") {
    if (!data.pubkey) return;
    playerPubKeys.set(senderName, data.pubkey);
    // Broadcast to all so everyone can encrypt to this user
    broadcast({ type:"pubkey-update", name:senderName, pubkey:data.pubkey }, senderName);
    // Trigger player list refresh so new joiners get the key
    broadcastPlayerList();
    return;
  }

  // ── Get channel list ─────────────────────────────────────────────────────
  if (type==="get-channel-list") {
    send(ws, { type:"channel-list", ...buildChannelListPayload() });
    return;
  }

  // ── Create custom channel ─────────────────────────────────────────────────
  if (type==="create-custom-channel") {
    const { kind, channelName, channelId, password } = data;
    if (!kind || !channelName || !channelId) return;
    if (!CHANNEL_REGEX.test(channelName)) {
      send(ws, { type:"channel-created-error", reason:"Invalid channel name." });
      return;
    }
    if (customChannels.has(channelId)) {
      send(ws, { type:"channel-created-error", reason:"Channel already exists." });
      return;
    }

    let passwordHash = null;
    if (password) passwordHash = await Bun.password.hash(password);

    const ch = {
      id: channelId, name: channelName, kind,
      topic: kind === "text" ? `#${channelName} channel` : null,
      passwordHash, createdBy: senderName, createdAt: Date.now(),
    };
    customChannels.set(channelId, ch);
    await saveChannels();

    // Set up runtime structures
    if (kind === "voice") {
      groups.set(channelId, { password: passwordHash, members: new Set() });
      BUILTIN_GROUPS.add(channelId);
    } else {
      if (!chatHistory.has(channelId)) chatHistory.set(channelId, []);
    }

    const safe = { id: ch.id, name: ch.name, topic: ch.topic, hasPassword: !!passwordHash };
    broadcast({ type:"channel-created", kind, channel: safe });
    console.log(`[CH]   ${kind} channel "${channelName}" created by ${senderName}${passwordHash?" (🔒 locked)":""}`);
    return;
  }

  // ── Verify channel password ───────────────────────────────────────────────
  if (type==="verify-channel-pass") {
    const { channelId, kind, password } = data;
    const ch = customChannels.get(channelId);
    if (!ch) { send(ws, { type:"channel-access-denied", reason:"Channel not found." }); return; }
    if (!ch.passwordHash) {
      send(ws, { type:"channel-access-ok", channelId, kind }); return;
    }
    const ok = await Bun.password.verify(password || "", ch.passwordHash);
    if (ok) {
      send(ws, { type:"channel-access-ok", channelId, kind });
    } else {
      send(ws, { type:"channel-access-denied", reason:"Wrong password. Try again." });
    }
    return;
  }
}

// ── Complete login flow ────────────────────────────────────────────────────
function completeLogin(ws, name, emoji) {
  wsClients.set(name, ws);
  ws.data = { ...ws.data, playerName:name };
  groups.get("global").members.add(name);
  playerGroups.set(name, "global");

  send(ws, { type:"auth-ok", emoji });

  setTimeout(() => {
    broadcastPlayerList();
    sendChatHistory(ws);
    // Send the full custom channel list so new user sees all channels immediately
    send(ws, { type:"channel-list", ...buildChannelListPayload() });
    broadcast({ type:"player-joined", playerName:name, emoji }, name);
  }, 100);
}

// ── Static file server ────────────────────────────────────────────────────
async function serveFile(pathname) {
  const filename = (pathname==="/"||pathname==="") ? "index.html" : pathname.replace(/^\//,"");
  const filepath = join(__dir, filename);
  const file = Bun.file(filepath);
  const exists = await file.exists();
  if (exists) return new Response(file);
  return null;
}

// ── Bun server ─────────────────────────────────────────────────────────────
await loadAccounts();
await loadChannels();
await loadBans();

Bun.serve({
  port: PORT,

  async fetch(req, srv) {
    const url = new URL(req.url);
    if (req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});

    if (url.pathname==="/ws") {
      const ok = srv.upgrade(req,{data:{}});
      if (!ok) return new Response("WebSocket upgrade failed",{status:400});
      return;
    }

    if (url.pathname==="/api/online"&&req.method==="GET")
      return new Response(JSON.stringify({count:wsClients.size,players:[...wsClients.keys()]}),{headers:{...CORS,"Content-Type":"application/json"}});

    if (url.pathname==="/api/history"&&req.method==="GET") {
      const ch   = url.searchParams.get("channel");
      const msgs = ch ? (chatHistory.get(ch)||[]) : Object.fromEntries(chatHistory);
      return new Response(JSON.stringify({channel:ch,messages:msgs}),{headers:{...CORS,"Content-Type":"application/json"}});
    }

    if (req.method==="GET") {
      const res = await serveFile(url.pathname);
      if (res) return res;
    }

    return new Response(JSON.stringify({error:"Not found"}),{status:404,headers:{...CORS,"Content-Type":"application/json"}});
  },

  websocket: {
    sendPings:   true,   // protocol-level pings keep Cloudflare tunnel alive
    idleTimeout: 120,    // drop truly dead connections after 120s
    open(ws)  { console.log("[WS]   New connection"); },
    message(ws, raw) { let d; try{d=JSON.parse(raw);}catch{return;} handleMessage(ws,d).catch(console.error); },
    close(ws) {
      const name = ws.data?.playerName;
      if (name && wsClients.get(name)===ws) cleanupPlayer(name);
      else console.log("[WS]   Unauthenticated client disconnected");
    },
  },
});

// ── Startup banner ─────────────────────────────────────────────────────────
console.log(`
╔════════════════════════════════════════════════╗
║            Nexus — Relay Server                ║
╠════════════════════════════════════════════════╣
║  WebSocket  →  ws://localhost:${PORT}/ws         ║
║  Web UI     →  http://localhost:${PORT}/          ║
╠════════════════════════════════════════════════╣
║  Accounts stored in: accounts.json             ║
║  Type "help" for terminal commands             ║
╚════════════════════════════════════════════════╝
`);

// ── Terminal REPL ──────────────────────────────────────────────────────────
const rl = createInterface({ input:process.stdin, terminal:false });

const HELP = `
Commands:
  list                    — show online players
  accounts                — list all registered accounts
  channels                — list all custom channels
  delchannel <id>         — delete a custom channel
  ban <n>              — ban an account (prompts for reason + CONFIRM)
  unban <n>            — remove a ban
  bans                    — list all banned accounts
  kick <n>             — disconnect a player
  delaccount <n>       — delete an account permanently
  groups                  — list voice groups
  force <player> <group>  — move player to group
  broadcast <message>     — system message to all channels
  history <channel-id>    — print last 20 messages
  clear <channel-id>      — wipe channel history
  help                    — show this list
`.trim();

// ── Ban flow state machine ─────────────────────────────────────────────────────────────────────────────────
let banPending = null; // null | { step:"reason"|"confirm", name, reason }

rl.on("line", async line => {
  const raw   = line.trim();
  const parts = raw.split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();

  // Handle pending ban flow
  if (banPending) {
    if (banPending.step === "reason") {
      const presets = {
        "1": "Bad behaviour / abuse in regular channels",
        "2": "Harassment of other users",
        "3": "Spamming or flooding channels",
        "4": "Sharing inappropriate or offensive content",
        "5": "Violation of community guidelines",
      };
      banPending.reason = presets[raw] || raw || "Violation of community guidelines.";
      banPending.step   = "confirm";
      console.log("\n[BAN]  Account  : " + banPending.name);
      console.log("[BAN]  Reason   : " + banPending.reason);
      console.log("[BAN]  Type CONFIRM to proceed or anything else to cancel:");
      return;
    }
    if (banPending.step === "confirm") {
      if (raw !== "CONFIRM") {
        console.log("[BAN]  Cancelled — ban was not applied.");
        banPending = null;
        return;
      }
      const { name, reason } = banPending;
      banPending = null;
      const nameLower = name.toLowerCase();
      const bannedAt  = Date.now();
      bans.set(nameLower, { name, reason, bannedAt, bannedBy:"Server Admin" });
      await saveBans();
      const targetWs = wsClients.get(name);
      if (targetWs) {
        try { send(targetWs, { type:"banned", reason, bannedAt }); targetWs.close(); } catch {}
        cleanupPlayer(name);
      }
      console.log("[BAN]  ✅ \"" + name + "\" has been banned. Reason: " + reason);
      return;
    }
  }

  if (!cmd) return;

  if (cmd==="ban") {
    const name = parts.slice(1).join(" ").trim();
    if (!name) { console.log("[BAN]  Usage: ban <n>"); return; }
    if (!accounts.has(name.toLowerCase()) && !wsClients.has(name)) {
      console.log(`[BAN]  No account or online player found for "${name}".`); return;
    }
    if (bans.has(name.toLowerCase())) {
      console.log(`[BAN]  "${name}" is already banned. Use unban first.`); return;
    }
    banPending = { step:"reason", name, reason:"" };
    console.log(`\n[BAN]  Banning: ${name}`);
    console.log(`[BAN]  Select a reason or type your own:\n`);
    console.log(`         1. Bad behaviour / abuse in regular channels`);
    console.log(`         2. Harassment of other users`);
    console.log(`         3. Spamming or flooding channels`);
    console.log(`         4. Sharing inappropriate or offensive content`);
    console.log(`         5. Violation of community guidelines`);
    console.log(`\n         Or type a custom reason and press Enter:`);
    return;
  }

  if (cmd==="unban") {
    const name = parts.slice(1).join(" ").trim().toLowerCase();
    if (!name) { console.log("[BAN]  Usage: unban <n>"); return; }
    if (!bans.has(name)) { console.log(`[BAN]  No ban found for "${name}".`); return; }
    const ban = bans.get(name);
    bans.delete(name);
    await saveBans();
    console.log(`[BAN]  ✅ "${ban.name}" has been unbanned.`);
    return;
  }

  if (cmd==="bans") {
    if (!bans.size) { console.log("[BAN]  No banned accounts."); return; }
    console.log(`[BAN]  ${bans.size} banned account(s):`);
    for (const [, b] of bans) {
      console.log(`         🔨 ${b.name}  —  ${b.reason}  (${new Date(b.bannedAt).toLocaleDateString()})`);
    }
    return;
  }

  if (cmd==="list") {
    if (!wsClients.size) { console.log("[CMD]  No players online."); return; }
    console.log(`[CMD]  ${wsClients.size} online:`);
    for (const [name] of wsClients) console.log(`         • ${name}  (group: ${getGroup(name)})`);
    return;
  }

  if (cmd==="accounts") {
    if (!accounts.size) { console.log("[CMD]  No accounts registered."); return; }
    console.log(`[CMD]  ${accounts.size} account(s):`);
    for (const [, acc] of accounts) {
      const online = wsClients.has(acc.name) ? " 🟢" : "";
      console.log(`         ${acc.emoji} ${acc.name}${online}  (created ${new Date(acc.createdAt).toLocaleDateString()})`);
    }
    return;
  }

  if (cmd==="channels") {
    if (!customChannels.size) { console.log("[CMD]  No custom channels yet."); return; }
    console.log(`[CMD]  ${customChannels.size} custom channel(s):`);
    for (const [, ch] of customChannels) {
      const lock = ch.passwordHash ? "🔒" : "🔓";
      const icon = ch.kind === "voice" ? "🔊" : "#";
      console.log(`         ${lock} ${icon} ${ch.name}  (id: ${ch.id}, by: ${ch.createdBy})`);
    }
    return;
  }

  if (cmd==="delchannel") {
    const id = parts[1];
    if (!id) { console.log("[CMD]  Usage: delchannel <channel-id>"); return; }
    if (!customChannels.has(id)) { console.log(`[CMD]  No custom channel "${id}".`); return; }
    const ch = customChannels.get(id);
    customChannels.delete(id);
    chatHistory.delete(id);
    if (ch.kind === "voice") {
      const g = groups.get(id);
      if (g) {
        for (const member of g.members) {
          const mws = wsClients.get(member);
          if (mws) try { send(mws, { type:"group-error", msg:`Channel "${ch.name}" was deleted.` }); } catch {}
          playerGroups.set(member, "global");
          groups.get("global")?.members.add(member);
        }
        groups.delete(id);
        BUILTIN_GROUPS.delete(id);
      }
    }
    await saveChannels();
    broadcast({ type:"channel-deleted", channelId:id, kind:ch.kind });
    console.log(`[CMD]  Channel "${ch.name}" deleted ✓`);
    return;
  }

  if (cmd==="kick") {
    const name=parts.slice(1).join(" ").trim();
    if(!name){console.log("[CMD]  Usage: kick <name>");return;}
    const ws=wsClients.get(name);
    if(!ws){console.log(`[CMD]  "${name}" is not online.`);return;}
    try{send(ws,{type:"kicked",reason:"You were kicked by the host."});ws.close();}catch{}
    cleanupPlayer(name);
    console.log(`[CMD]  Kicked "${name}" ✓`);
    return;
  }

  if (cmd==="delaccount") {
    const name=parts.slice(1).join(" ").trim().toLowerCase();
    if(!name){console.log("[CMD]  Usage: delaccount <name>");return;}
    if(!accounts.has(name)){console.log(`[CMD]  No account "${name}".`);return;}
    const realName=accounts.get(name).name;
    accounts.delete(name);
    await saveAccounts();
    const ws=wsClients.get(realName);
    if(ws){try{send(ws,{type:"kicked",reason:"Your account was deleted by the host."});ws.close();}catch{}cleanupPlayer(realName);}
    console.log(`[CMD]  Account "${realName}" deleted ✓`);
    return;
  }

  if (cmd==="groups") {
    for(const [name,g] of groups.entries()){
      const members=[...g.members].join(", ")||"(empty)";
      console.log(`[CMD]  ${BUILTIN_GROUPS.has(name)?"📌":"🔒"} "${name}" — ${g.members.size} member(s): ${members}`);
    }
    return;
  }

  if (cmd==="force") {
    const [,playerName,groupName]=parts;
    if(!playerName||!groupName){console.log("[CMD]  Usage: force <player> <group>");return;}
    if(!wsClients.has(playerName)){console.log(`[CMD]  "${playerName}" not online.`);return;}
    if(!groups.has(groupName))groups.set(groupName,{password:null,members:new Set()});
    joinGroup(playerName,groupName);
    console.log(`[CMD]  Moved "${playerName}" → "${groupName}" ✓`);
    return;
  }

  if (cmd==="broadcast") {
    const text=parts.slice(1).join(" ").trim();
    if(!text){console.log("[CMD]  Usage: broadcast <message>");return;}
    const ts=Date.now();
    const allTextIds=[...TEXT_CHANNEL_IDS,...[...customChannels.values()].filter(c=>c.kind==="text").map(c=>c.id)];
    for(const chId of allTextIds){
      const msg={type:"chat-message",channel:chId,from:"System",emoji:"📢",content:text,timestamp:ts,system:true};
      storeMessage(chId,{from:"System",emoji:"📢",content:text,timestamp:ts,system:true});
      broadcast(msg);
    }
    console.log("[CMD]  Broadcast sent ✓");
    return;
  }

  if (cmd==="history") {
    const chId=parts[1];
    if(!chId){console.log("[CMD]  Usage: history <channel-id>");return;}
    if(!chatHistory.has(chId)){console.log(`[CMD]  No history for "${chId}"`);return;}
    const msgs=chatHistory.get(chId).slice(-20);
    if(!msgs.length){console.log(`[CMD]  #${chId} is empty.`);return;}
    console.log(`[CMD]  Last ${msgs.length} in #${chId}:`);
    for(const m of msgs)console.log(`         [${new Date(m.timestamp).toLocaleTimeString()}] ${m.from}: ${m.content}`);
    return;
  }

  if (cmd==="clear") {
    const chId=parts[1];
    if(!chId||!chatHistory.has(chId)){console.log("[CMD]  Usage: clear <channel-id>");return;}
    chatHistory.set(chId,[]);
    broadcast({type:"chat-history",channels:{[chId]:[]}});
    console.log(`[CMD]  #${chId} cleared ✓`);
    return;
  }

  if (cmd==="help") { console.log(HELP); return; }

  console.log(`[CMD]  Unknown command "${cmd}". Type "help".`);
});


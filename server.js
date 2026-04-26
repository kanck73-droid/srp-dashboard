// ═══════════════════════════════════════════════════
//  SamboRP Backend – server.js
//  Handles: Roblox OAuth, Discord Webhook Proxy, WebRTC Signaling
// ═══════════════════════════════════════════════════
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const fetch   = require('node-fetch');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── ENV VARS (set these in Railway dashboard) ──────
const ROBLOX_CLIENT_ID     = process.env.ROBLOX_CLIENT_ID     || '6061649599616552690';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET || 'DEIN_SECRET_HIER';
const DISCORD_WEBHOOK      = process.env.DISCORD_WEBHOOK      || 'https://discord.com/api/webhooks/1493243647657902241/C6zCNVM34MRP9tkqtlO3qDHnW1vXYtwh9inM579CzSF69bno0OMrqozj-9AAbOfKosvk';
const PORT                 = process.env.PORT                 || 3000;

// ── ROBLOX OAUTH: Token Exchange ───────────────────
// Called by frontend after redirect with ?code=...
app.post('/api/roblox-token', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    // 1) Exchange code for tokens
    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     ROBLOX_CLIENT_ID,
        client_secret: ROBLOX_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri,
      })
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) return res.status(400).json({ error: tokens.error_description || 'Token exchange failed' });

    // 2) Fetch user info
    const userRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userRes.json();

    // 3) Fetch thumbnail (optional, best effort)
    let thumbnail = null;
    try {
      const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userInfo.sub}&size=150x150&format=Png&isCircular=true`);
      const thumbData = await thumbRes.json();
      thumbnail = thumbData?.data?.[0]?.imageUrl || null;
    } catch (_) {}

    res.json({
      robloxId:  userInfo.sub,
      username:  userInfo.preferred_username || userInfo.name || ('User_' + userInfo.sub),
      thumbnail,
    });
  } catch (e) {
    console.error('Roblox token error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── DISCORD WEBHOOK PROXY ──────────────────────────
// Frontend posts here → we forward to Discord (avoids CORS)
app.post('/api/discord-log', async (req, res) => {
  const { type, text, time } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });

  const colorMap = { voice:0x3ecf8e, ticket:0xf5a623, panic:0xe8454a, role:0xae7ef5, mod:0x4dabf7, system:0x888899 };
  const emojiMap = { voice:'🎤', ticket:'🎫', panic:'🚨', role:'🎭', mod:'📡', system:'⚙️' };

  // Strip HTML tags
  const clean = text.replace(/<[^>]+>/g, '');

  const payload = {
    embeds: [{
      color:  colorMap[type] || 0x888899,
      author: { name: `${emojiMap[type]||'📋'} SamboRP Logs` },
      description: clean,
      footer: { text: `SamboRP · Emergency Emden · ${time || new Date().toLocaleTimeString('de-DE')}` },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const r = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(500).json({ error: err });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Discord webhook error:', e);
    res.status(500).json({ error: 'Webhook failed' });
  }
});

// ── WEBRTC SIGNALING (Socket.IO) ───────────────────
// Rooms = voice channels. Peers exchange SDP/ICE through here.
const voiceRooms = {}; // roomId → Set of socket.ids with { username }

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Join a voice channel
  socket.on('voice:join', ({ room, username }) => {
    // Leave any current room first
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
      const r = voiceRooms[socket.currentRoom];
      if (r) { r.delete(socket.id); }
      socket.to(socket.currentRoom).emit('voice:user-left', { socketId: socket.id, username: socket.username });
    }

    socket.currentRoom = room;
    socket.username    = username;
    socket.join(room);

    if (!voiceRooms[room]) voiceRooms[room] = new Map();
    voiceRooms[room].set(socket.id, username);

    // Tell new peer who is already in the room
    const existing = [...voiceRooms[room].entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, name]) => ({ socketId: id, username: name }));
    socket.emit('voice:room-users', existing);

    // Tell others someone joined
    socket.to(room).emit('voice:user-joined', { socketId: socket.id, username });

    console.log(`${username} joined voice room: ${room}`);
  });

  // WebRTC offer
  socket.on('voice:offer', ({ to, offer }) => {
    io.to(to).emit('voice:offer', { from: socket.id, offer, username: socket.username });
  });

  // WebRTC answer
  socket.on('voice:answer', ({ to, answer }) => {
    io.to(to).emit('voice:answer', { from: socket.id, answer });
  });

  // ICE candidate
  socket.on('voice:ice', ({ to, candidate }) => {
    io.to(to).emit('voice:ice', { from: socket.id, candidate });
  });

  // Speaking indicator
  socket.on('voice:speaking', ({ speaking }) => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('voice:speaking', { socketId: socket.id, username: socket.username, speaking });
    }
  });

  // Leave voice
  socket.on('voice:leave', () => {
    leaveVoiceRoom(socket);
  });

  // Text funk
  socket.on('funk:message', ({ channel, text, username, colorClass }) => {
    io.emit('funk:message', { channel, text, username, colorClass, time: new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}) });
  });

  // Ticket updates (broadcast to all mods)
  socket.on('ticket:new', (ticket) => {
    socket.broadcast.emit('ticket:new', ticket);
  });

  socket.on('ticket:update', (ticket) => {
    socket.broadcast.emit('ticket:update', ticket);
  });

  // Admin call
  socket.on('admincall:new', (call) => {
    socket.broadcast.emit('admincall:new', call);
  });

  socket.on('admincall:resolve', (data) => {
    socket.broadcast.emit('admincall:resolve', data);
  });

  // Disconnect
  socket.on('disconnect', () => {
    leaveVoiceRoom(socket);
    console.log('Socket disconnected:', socket.id);
  });

  function leaveVoiceRoom(socket) {
    if (socket.currentRoom) {
      const r = voiceRooms[socket.currentRoom];
      if (r) r.delete(socket.id);
      socket.to(socket.currentRoom).emit('voice:user-left', { socketId: socket.id, username: socket.username });
      socket.leave(socket.currentRoom);
      socket.currentRoom = null;
    }
  }
});

server.listen(PORT, () => console.log(`SamboRP Server läuft auf Port ${PORT}`));

// ═══════════════════════════════════════════════════
//  SamboRP Backend – server.js (FIXED VERSION)
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

// --- WICHTIGE FIXES FÜR DIE DATEI-PFADE ---
app.use(express.json());

// Ermöglicht den Zugriff auf die index.html und andere Dateien im Hauptordner
app.use(express.static(__dirname)); 

// Die Haupt-Route: Sendet die index.html, wenn man die Domain aufruft
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── ENV VARS (Setze diese im Railway Dashboard unter Variables) ──────
const ROBLOX_CLIENT_ID     = process.env.ROBLOX_CLIENT_ID     || '6061649599616552690';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET || 'DEIN_SECRET_HIER';
const DISCORD_WEBHOOK      = process.env.DISCORD_WEBHOOK      || 'https://discord.com';
const PORT                 = process.env.PORT                 || 3000;

// ── ROBLOX OAUTH: Token Exchange ───────────────────
app.post('/api/roblox-token', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const tokenRes = await fetch('https://roblox.com', {
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

    const userRes = await fetch('https://roblox.com', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userRes.json();

    let thumbnail = null;
    try {
      const thumbRes = await fetch(`https://roblox.com{userInfo.sub}&size=150x150&format=Png&isCircular=true`);
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
app.post('/api/discord-log', async (req, res) => {
  const { type, text, time } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });

  const colorMap = { voice:0x3ecf8e, ticket:0xf5a623, panic:0xe8454a, role:0xae7ef5, mod:0x4dabf7, system:0x888899 };
  const emojiMap = { voice:'🎤', ticket:'🎫', panic:'🚨', role:'🎭', mod:'📡', system:'⚙️' };

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
const voiceRooms = {}; 

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('voice:join', ({ room, username }) => {
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

    const existing = [...voiceRooms[room].entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, name]) => ({ socketId: id, username: name }));
    socket.emit('voice:room-users', existing);

    socket.to(room).emit('voice:user-joined', { socketId: socket.id, username });
    console.log(`${username} joined voice room: ${room}`);
  });

  socket.on('voice:offer', ({ to, offer }) => {
    io.to(to).emit('voice:offer', { from: socket.id, offer, username: socket.username });
  });

  socket.on('voice:answer', ({ to, answer }) => {
    io.to(to).emit('voice:answer', { from: socket.id, answer });
  });

  socket.on('voice:ice', ({ to, candidate }) => {
    io.to(to).emit('voice:ice', { from: socket.id, candidate });
  });

  socket.on('voice:speaking', ({ speaking }) => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('voice:speaking', { socketId: socket.id, username: socket.username, speaking });
    }
  });

  socket.on('voice:leave', () => {
    leaveVoiceRoom(socket);
  });

  socket.on('funk:message', ({ channel, text, username, colorClass }) => {
    io.emit('funk:message', { channel, text, username, colorClass, time: new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}) });
  });

  socket.on('ticket:new', (ticket) => {
    socket.broadcast.emit('ticket:new', ticket);
  });

  socket.on('ticket:update', (ticket) => {
    socket.broadcast.emit('ticket:update', ticket);
  });

  socket.on('admincall:new', (call) => {
    socket.broadcast.emit('admincall:new', call);
  });

  socket.on('admincall:resolve', (data) => {
    socket.broadcast.emit('admincall:resolve', data);
  });

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

// WICHTIG: Nutzt 0.0.0.0 für Railway-Erreichbarkeit
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SamboRP Server läuft auf Port ${PORT}`);
});


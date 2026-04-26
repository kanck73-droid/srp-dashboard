// ═══════════════════════════════════════════════════
//  SamboRP Backend – server.js (KOMPLETT-VERSION)
//  Features: Zivilisten-Login, Roblox-Proxy, Discord-Proxy, WebRTC
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

// --- DATEI-PFADE FIX ---
// Erlaubt Zugriff auf die index.html im Hauptverzeichnis
app.use(express.static(__dirname)); 

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── ENV VARS (Aus dem Dashboard geladen) ──────
const ROBLOX_CLIENT_ID     = process.env.ROBLOX_CLIENT_ID     || '6061649599616552690';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET || 'DEIN_SECRET_HIER';
const DISCORD_WEBHOOK      = process.env.DISCORD_WEBHOOK      || 'https://discord.com';
const PORT                 = process.env.PORT                 || 3000;

// ── NEU: ZIVILISTEN LOGIN (Nur via Name) ───────────────────
app.post('/api/login-civ', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Bitte Namen eingeben.' });

  try {
    // 1. Suche die Roblox-ID zum Namen
    const userSearch = await fetch(`https://roblox.com{username}&limit=1`);
    const userData = await userSearch.json();
    
    if (!userData.data || userData.data.length === 0) {
      return res.status(404).json({ error: 'Dieser Roblox-Name wurde nicht gefunden.' });
    }

    const robloxUser = userData.data[0];

    // 2. Hol das Profilbild
    const thumbRes = await fetch(`https://roblox.com{robloxUser.id}&size=150x150&format=Png&isCircular=true`);
    const thumbData = await thumbRes.json();
    const thumbnail = thumbData?.data?.[0]?.imageUrl || null;

    res.json({
      robloxId:  robloxUser.id,
      username:  robloxUser.name,
      thumbnail: thumbnail,
      role: 'Zivilist'
    });
  } catch (e) {
    console.error('Login Fehler:', e);
    res.status(500).json({ error: 'Server-Fehler beim Login.' });
  }
});

// ── DISCORD WEBHOOK PROXY ──────────────────────────
app.post('/api/discord-log', async (req, res) => {
  const { type, text, time } = req.body;
  if (!text) return res.status(400).json({ error: 'Kein Text' });

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
    res.json({ ok: r.ok });
  } catch (e) {
    res.status(500).json({ error: 'Webhook fehlgeschlagen' });
  }
});

// ── WEBRTC SIGNALING (Socket.IO) ───────────────────
const voiceRooms = {}; 

io.on('connection', (socket) => {
  console.log('User verbunden:', socket.id);

  socket.on('voice:join', ({ room, username }) => {
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
      const r = voiceRooms[socket.currentRoom];
      if (r) r.delete(socket.id);
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

  socket.on('funk:message', ({ channel, text, username, colorClass }) => {
    io.emit('funk:message', { 
        channel, text, username, colorClass, 
        time: new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'}) 
    });
  });

  socket.on('disconnect', () => {
    if (socket.currentRoom) {
      const r = voiceRooms[socket.currentRoom];
      if (r) r.delete(socket.id);
      socket.to(socket.currentRoom).emit('voice:user-left', { socketId: socket.id, username: socket.username });
    }
  });
});

// Server auf 0.0.0.0 binden für externe Erreichbarkeit
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SamboRP Server läuft auf Port ${PORT}`);
});

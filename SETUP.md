# SamboRP Panel – Setup & Hosting Anleitung

## Projektstruktur
```
sambo_rp/
├── server.js          ← Node.js Backend (Roblox OAuth, Discord, WebRTC Signaling)
├── package.json
├── railway.json       ← Railway Deployment Config
└── public/
    └── index.html     ← Das komplette Frontend
```

---

## Schritt 1: Roblox OAuth App einrichten

1. Gehe zu: https://create.roblox.com/dashboard/credentials
2. Klicke "Create OAuth App"
3. Name: "SamboRP Panel"
4. Redirect URI: `https://DEINE-RAILWAY-URL.up.railway.app/`
   (du bekommst die URL nach dem Deployment in Schritt 3)
5. Scopes: `openid`, `profile`
6. Speichern → du bekommst:
   - **Client ID** (schon eingetragen: 6061649599616552690)
   - **Client Secret** ← das brauchst du für Railway!

---

## Schritt 2: GitHub Repo erstellen

1. Gehe zu https://github.com/new
2. Repository Name: `sambo-rp-panel`
3. Private Repository (empfohlen)
4. Erstelle das Repo, dann lade diese Dateien hoch:
   - `server.js`
   - `package.json`
   - `railway.json`
   - Ordner `public/` mit `index.html`

---

## Schritt 3: Railway Hosting (kostenlos)

1. Gehe zu https://railway.app
2. "Sign in with GitHub"
3. "New Project" → "Deploy from GitHub repo"
4. Wähle dein `sambo-rp-panel` Repo
5. Railway deployt automatisch!

### Environment Variables in Railway einstellen:
Gehe zu deinem Projekt → "Variables" → folgende eintragen:

| Variable              | Wert                          |
|-----------------------|-------------------------------|
| `ROBLOX_CLIENT_ID`    | `6061649599616552690`         |
| `ROBLOX_CLIENT_SECRET`| Dein Client Secret von Schritt 1 |
| `DISCORD_WEBHOOK`     | Deine Webhook URL             |

6. Nach dem Deployment → kopiere deine URL (z.B. `sambo-rp.up.railway.app`)
7. Gehe zurück zu Roblox OAuth App → trage die Railway URL als Redirect URI ein

---

## Schritt 4: Roblox Redirect URI updaten

In deiner Roblox OAuth App:
- Redirect URI: `https://sambo-rp.up.railway.app/`
  (ersetze mit deiner echten Railway URL)

---

## Login-Codes (Demo / bis Roblox OAuth läuft)
- `OWNER1` → Owner-Login als "sambo"
- `MOD001` → Mod-Login
- `TRAIL1` → Trail Mod Login

Diese kannst du in `server.js` unter `DEMO_CODES` anpassen.

---

## Was jetzt alles funktioniert:
✅ Roblox OAuth Login → echter Roblox-Name wird übernommen
✅ Discord Webhook → alle Logs gehen automatisch an deinen Discord Channel
✅ Sprachfunk → echtes WebRTC zwischen allen Nutzern
✅ Textfunk → Echtzeit via Socket.IO
✅ Admin Calls → erscheinen sofort bei allen Mods
✅ Tickets → erscheinen sofort bei allen Mods  
✅ Server Logo hochladen
✅ Owner heißt "sambo"
✅ Trail Mod Rolle
✅ Mod Logs Channel im Dashboard

---

## Technischer Überblick
- **Frontend**: Reines HTML/CSS/JS in `public/index.html`
- **Backend**: Node.js + Express + Socket.IO
- **Voice**: WebRTC (Peer-to-Peer, STUN via Google)
- **Signaling**: Socket.IO Rooms
- **Auth**: Roblox OAuth 2.0 (PKCE-ready)
- **Discord**: Webhook via Backend-Proxy (kein CORS Problem)

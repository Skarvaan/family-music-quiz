/* =========================================================
   Family Music Quiz · lokaler Mehrgeräte-Server
   ---------------------------------------------------------
   Wichtigste Änderungen gegenüber v1:
   - Der Raumcode bleibt stabil. Er wechselt nur, wenn der
     Host aktiv eine neue Sitzung startet. Ein Reload des
     Host-Tabs oder ein kurzer WLAN-Aussetzer wirft niemanden
     mehr aus dem Raum.
   - Host-Trennung hat eine Karenzzeit (HOST_GRACE_MS).
     Solange bleibt der Raum offen, Handys warten geduldig.
   - Spieler bekommen ein playerToken. Rejoin läuft darüber
     statt über exakte Namensgleichheit. Tippfehler erzeugen
     keine Geisterspieler mehr.
   - LAN-Adressen werden sortiert und gefiltert, damit der
     QR-Code nicht auf eine VPN- oder Docker-Adresse zeigt,
     die im WLAN niemand erreicht.
   ========================================================= */

const crypto = require("crypto");
const os = require("os");
const path = require("path");
const express = require("express");
const http = require("http");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const ROOT = __dirname;
const ROOM_CODE_LENGTH = 6;
const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HOST_GRACE_MS = 90 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 20000,
  pingTimeout: 40000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 }
});

// ---------------------------------------------------------
// Raum-Zustand
// ---------------------------------------------------------
const room = {
  code: makeRoomCode(),
  hostSocketId: null,
  hostSeenAt: null,
  hostGraceTimer: null,
  playersById: new Map(),
  playerIdByToken: new Map(),
  prompt: null,
  answers: new Map(),
  controllerId: null,
  controllerActions: [],
  open: false
};

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
  return code;
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
}
function normalizeName(name) {
  return cleanName(name).toLowerCase();
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    active: player.active !== false,
    connected: !!player.socketId,
    lastSeenAt: player.lastSeenAt
  };
}

function hostOnline() {
  return !!room.hostSocketId;
}

function clearHostGrace() {
  if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
  room.hostGraceTimer = null;
}

/** Setzt Spielinhalte zurück, behält aber Code und Spieler, wenn gewünscht. */
function resetRoundState() {
  room.prompt = null;
  room.answers = new Map();
}

/** Komplett neue Sitzung: neuer Code, alle Spieler raus. */
function startNewSession() {
  clearHostGrace();
  room.code = makeRoomCode();
  room.playersById = new Map();
  room.playerIdByToken = new Map();
  room.controllerId = null;
  room.controllerActions = [];
  resetRoundState();
}

function slimPrompt(prompt) {
  if (!prompt) return null;
  return { id: prompt.id, type: prompt.type, title: prompt.title, text: prompt.text, kind: prompt.kind, createdAt: prompt.createdAt };
}

/** Jedes Handy bekommt nur seine eigenen Tracks/Zuweisungen, nicht die aller anderen. */
function promptForPlayer(playerId) {
  if (!room.prompt) return null;
  const prompt = { ...room.prompt };
  if (prompt.tracksByPlayer) prompt.tracksByPlayer = { [playerId]: prompt.tracksByPlayer[playerId] || [] };
  if (prompt.assignmentsByPlayer) prompt.assignmentsByPlayer = { [playerId]: prompt.assignmentsByPlayer[playerId] || [] };
  if (prompt.voteDuelsByPlayer) prompt.voteDuelsByPlayer = { [playerId]: prompt.voteDuelsByPlayer[playerId] || [] };
  return prompt;
}

function emitPromptToPlayers() {
  for (const player of room.playersById.values()) {
    if (player.socketId) io.to(player.socketId).emit("player:prompt", promptForPlayer(player.id));
  }
}

function roomSnapshot() {
  return {
    roomCode: room.code,
    players: [...room.playersById.values()].map(publicPlayer),
    prompt: slimPrompt(room.prompt),
    answeredPlayerIds: [...room.answers.keys()],
    hostUrls: getHostUrls(),
    controllerId: room.controllerId,
    controllerActions: room.controllerActions,
    open: room.open,
    hostOnline: hostOnline()
  };
}

function emitRoomState() {
  const snapshot = roomSnapshot();
  io.to(room.code).emit("room:state", snapshot);
  if (room.hostSocketId) io.to(room.hostSocketId).emit("host:players", snapshot);
}

// ---------------------------------------------------------
// Netzwerkadressen
// ---------------------------------------------------------
const VIRTUAL_ADAPTER = /(vmnet|vboxnet|virtualbox|docker|br-|veth|utun|tailscale|zt|wg\d|tun\d|Hyper-V|WSL|Loopback|VPN)/i;

function isPrivateV4(address) {
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  const m = /^172\.(\d+)\./.exec(address);
  if (m) { const n = Number(m[1]); return n >= 16 && n <= 31; }
  return false;
}

/** Sortiert: typische WLAN-Netze zuerst, virtuelle Adapter ganz nach hinten. */
function getLanCandidates() {
  const out = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (!net) continue;
      const family = net.family === "IPv4" || net.family === 4;
      if (!family || net.internal) continue;
      if (/^169\.254\./.test(net.address)) continue; // Link-local, im WLAN nutzlos
      out.push({ name, address: net.address, virtual: VIRTUAL_ADAPTER.test(name), private: isPrivateV4(net.address) });
    }
  }
  const score = (n) => (n.virtual ? 100 : 0) + (n.private ? 0 : 50) + (/^192\.168\./.test(n.address) ? 0 : 5);
  return out.sort((a, b) => score(a) - score(b));
}

function getLanAddresses() {
  return getLanCandidates().map(n => `http://${n.address}:${PORT}`);
}

function getHostUrls() {
  return [...new Set([...getLanAddresses(), `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`])];
}

// ---------------------------------------------------------
// HTTP
// ---------------------------------------------------------
// Beim lokalen Partyspiel ist Caching nur ein Risiko: das iPad
// hält sonst an einer alten JS-Version fest.
const staticOptions = {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader("Cache-Control", "no-store"); }
};

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use("/family-music-quiz", express.static(ROOT, staticOptions));
app.use("/public", express.static(path.join(ROOT, "public"), staticOptions));
app.use("/data", express.static(path.join(ROOT, "data"), staticOptions));
app.use("/js", express.static(path.join(ROOT, "js"), staticOptions));
app.use(express.static(ROOT, { ...staticOptions, index: false }));

app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/player", (_req, res) => res.sendFile(path.join(ROOT, "public", "player.html")));
app.get("/room-info", (_req, res) => res.json(roomSnapshot()));
app.get("/health", (_req, res) => res.json({ ok: true, roomCode: room.code, open: room.open, hostOnline: hostOnline(), players: room.playersById.size }));

app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.url || "").trim();
  if (!text) { res.status(400).send("Missing url"); return; }
  try {
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, width: 300 });
    res.type("image/svg+xml").setHeader("Cache-Control", "no-store").send(svg);
  } catch {
    res.status(500).send("QR konnte nicht erzeugt werden.");
  }
});

// ---------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------
io.on("connection", socket => {

  // ---- Host --------------------------------------------
  socket.on("host:createRoom", (payload = {}, ack) => {
    // Ein Reload des Host-Tabs übernimmt den bestehenden Raum,
    // statt alle Handys rauszuwerfen.
    if (payload.newSession) startNewSession();
    clearHostGrace();
    room.hostSocketId = socket.id;
    room.hostSeenAt = Date.now();
    room.open = true;
    socket.data.isHost = true;
    socket.join(room.code);
    if (payload.newSession) resetRoundState();
    ack?.(roomSnapshot());
    io.to(room.code).emit("player:hostBack", { roomCode: room.code });
    emitRoomState();
  });

  socket.on("host:closeRoom", (_payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann den Raum schließen." }); return; }
    const oldCode = room.code;
    io.to(oldCode).emit("player:roomClosed", { error: "Der Host hat die Sitzung beendet. Für eine neue Runde bitte den neuen Code scannen." });
    room.open = false;
    startNewSession();
    socket.leave(oldCode);
    socket.join(room.code);
    ack?.({ ok: true, roomCode: room.code });
    emitRoomState();
  });

  socket.on("host:startPrompt", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann Prompts starten." }); return; }
    room.prompt = {
      id: payload.id || crypto.randomUUID(),
      type: payload.type || "generic",
      title: payload.title || "Neue Frage",
      text: payload.text || "Bitte antworten.",
      options: Array.isArray(payload.options) ? payload.options : [],
      recipientIds: Array.isArray(payload.recipientIds) ? payload.recipientIds : null,
      excludedPlayerIds: Array.isArray(payload.excludedPlayerIds) ? payload.excludedPlayerIds : [],
      waitingText: payload.waitingText || "",
      sentText: payload.sentText || "",
      kind: payload.kind || "",
      tracksByPlayer: payload.tracksByPlayer && typeof payload.tracksByPlayer === "object" ? payload.tracksByPlayer : null,
      assignmentsByPlayer: payload.assignmentsByPlayer && typeof payload.assignmentsByPlayer === "object" ? payload.assignmentsByPlayer : null,
      voteDuelsByPlayer: payload.voteDuelsByPlayer && typeof payload.voteDuelsByPlayer === "object" ? payload.voteDuelsByPlayer : null,
      meta: payload.meta && typeof payload.meta === "object" ? payload.meta : null,
      createdAt: Date.now()
    };
    room.answers = new Map();
    emitPromptToPlayers();
    emitRoomState();
    ack?.({ ok: true, prompt: slimPrompt(room.prompt) });
  });

  socket.on("host:reveal", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann auflösen." }); return; }
    io.to(room.code).emit("player:reveal", payload);
    ack?.({ ok: true });
  });

  socket.on("host:resetRound", (_payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann Runden zurücksetzen." }); return; }
    resetRoundState();
    io.to(room.code).emit("player:resetRound");
    emitRoomState();
    ack?.({ ok: true });
  });

  socket.on("host:setController", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann die Steuerung vergeben." }); return; }
    room.controllerId = payload.playerId || null;
    if (!room.controllerId) room.controllerActions = [];
    emitRoomState();
    ack?.({ ok: true, controllerId: room.controllerId });
  });

  socket.on("host:setControllerActions", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) { ack?.({ ok: false, error: "Nur der Host kann Handy-Buttons setzen." }); return; }
    room.controllerActions = Array.isArray(payload.actions)
      ? payload.actions.filter(a => a && a.id && a.label).slice(0, 18).map(a => ({
        id: String(a.id),
        label: String(a.label),
        options: Array.isArray(a.options)
          ? a.options.filter(o => o && o.id && o.label).slice(0, 4).map(o => ({ id: String(o.id), label: String(o.label) }))
          : []
      }))
      : [];
    emitRoomState();
    ack?.({ ok: true, controllerActions: room.controllerActions });
  });

  // ---- Spieler -----------------------------------------
  socket.on("player:join", (payload = {}, ack) => {
    const requestedCode = String(payload.roomCode || "").trim().toLowerCase();
    if (requestedCode && requestedCode !== room.code) {
      ack?.({ ok: false, code: "WRONG_ROOM", error: "Dieser Raumcode passt nicht. Bitte den Code auf dem großen Bildschirm prüfen." });
      return;
    }
    if (!room.open) {
      ack?.({ ok: false, code: "CLOSED", error: "Der Raum ist noch nicht offen. Der Host muss zuerst den Mehrgeräte-Modus starten." });
      return;
    }

    const name = cleanName(payload.name);
    if (!name) { ack?.({ ok: false, code: "NO_NAME", error: "Bitte einen Namen eingeben." }); return; }

    const token = String(payload.playerToken || "").trim() || null;

    // Reihenfolge: bekanntes Token > gleicher Name > neuer Spieler.
    let player = token ? room.playersById.get(room.playerIdByToken.get(token)) : null;
    if (!player) {
      const normalized = normalizeName(name);
      player = [...room.playersById.values()].find(p => normalizeName(p.name) === normalized && !p.socketId) || null;
    }

    if (!player) {
      player = {
        id: crypto.randomUUID(),
        token: token || crypto.randomUUID(),
        name,
        active: true,
        socketId: socket.id,
        lastSeenAt: Date.now()
      };
      room.playersById.set(player.id, player);
    } else {
      player.name = name;
      player.socketId = socket.id;
      player.lastSeenAt = Date.now();
      if (typeof payload.active === "boolean") player.active = payload.active;
      if (token) player.token = token;
    }
    room.playerIdByToken.set(player.token, player.id);

    socket.data.playerId = player.id;
    socket.join(room.code);

    ack?.({
      ok: true,
      roomCode: room.code,
      playerToken: player.token,
      player: publicPlayer(player),
      prompt: promptForPlayer(player.id),
      alreadyAnswered: room.answers.has(player.id),
      controllerId: room.controllerId,
      controllerActions: room.controllerActions,
      hostOnline: hostOnline()
    });
    emitRoomState();
  });

  socket.on("player:setActive", (payload = {}, ack) => {
    const player = room.playersById.get(payload.playerId || socket.data.playerId);
    if (!player) { ack?.({ ok: false, error: "Spieler nicht gefunden." }); return; }
    player.active = payload.active !== false;
    player.lastSeenAt = Date.now();
    ack?.({ ok: true, player: publicPlayer(player) });
    emitRoomState();
  });

  socket.on("player:submitAnswer", (payload = {}, ack) => {
    const playerId = payload.playerId || socket.data.playerId;
    const player = room.playersById.get(playerId);
    if (!player) { ack?.({ ok: false, code: "NO_PLAYER", error: "Verbindung verloren. Bitte kurz neu beitreten." }); return; }
    if (!room.prompt) { ack?.({ ok: false, code: "NO_PROMPT", error: "Gerade läuft keine Frage." }); return; }
    if (payload.promptId !== room.prompt.id) { ack?.({ ok: false, code: "STALE", error: "Diese Frage ist schon vorbei." }); return; }
    if (room.answers.has(playerId)) { ack?.({ ok: true, duplicate: true }); return; }

    const answerPayload = {
      playerId,
      playerName: player.name,
      promptId: payload.promptId,
      type: room.prompt.type,
      answer: payload.answer,
      submittedAt: Date.now()
    };
    room.answers.set(playerId, answerPayload);
    if (room.hostSocketId) io.to(room.hostSocketId).emit("host:answerSubmitted", answerPayload);
    emitRoomState();
    ack?.({ ok: true });
  });

  socket.on("player:controlAction", (payload = {}, ack) => {
    const playerId = payload.playerId || socket.data.playerId;
    if (!playerId || playerId !== room.controllerId) { ack?.({ ok: false, error: "Du hast gerade keine Steuerung." }); return; }
    const allowed = new Set((room.controllerActions || []).flatMap(a => [a.id, ...((a.options || []).map(o => o.id))]));
    if (!allowed.has(payload.action)) { ack?.({ ok: false, error: "Diese Steuerung ist gerade nicht verfügbar." }); return; }
    if (!room.hostSocketId) { ack?.({ ok: false, error: "Der Host ist gerade offline." }); return; }
    io.to(room.hostSocketId).emit("host:controlAction", { playerId, action: payload.action });
    ack?.({ ok: true });
  });

  // ---- Trennung ----------------------------------------
  socket.on("disconnect", () => {
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null;
      // Karenzzeit: Reload oder kurzer Funkloch-Moment darf die
      // Runde nicht beenden. Handys bekommen nur einen Hinweis.
      io.to(room.code).emit("player:hostAway", { graceMs: HOST_GRACE_MS });
      clearHostGrace();
      room.hostGraceTimer = setTimeout(() => {
        if (room.hostSocketId) return;
        room.open = false;
        io.to(room.code).emit("player:roomClosed", { error: "Der Host ist nicht zurückgekommen. Bitte später erneut beitreten." });
        emitRoomState();
      }, HOST_GRACE_MS);
    }
    if (socket.data.playerId) {
      const player = room.playersById.get(socket.data.playerId);
      if (player && player.socketId === socket.id) {
        player.socketId = null;
        player.lastSeenAt = Date.now();
      }
    }
    emitRoomState();
  });
});

// ---------------------------------------------------------
// Start
// ---------------------------------------------------------
server.listen(PORT, BIND_HOST, () => {
  const lan = getLanCandidates();
  const line = "─".repeat(52);
  console.log(line);
  console.log("  Family Music Quiz läuft");
  console.log(line);
  console.log(`  Host-Bildschirm:  http://localhost:${PORT}`);
  console.log(`  Raumcode:         ${room.code}`);
  console.log("");
  if (lan.length) {
    console.log("  Für Handys und iPads im selben WLAN:");
    lan.forEach((n, i) => {
      const tag = i === 0 ? " ← diese zuerst probieren" : n.virtual ? "  (virtueller Adapter, meist falsch)" : "";
      console.log(`    http://${n.address}:${PORT}/player${tag}`);
    });
  } else {
    console.log("  Keine WLAN-Adresse gefunden. Ist der Rechner im WLAN?");
    console.log(`  Notfalls manuell: http://<deine-wlan-ip>:${PORT}/player`);
  }
  console.log("");
  console.log("  Klappt die Verbindung nicht, blockiert meist die Firewall.");
  console.log("  Windows: Node.js für private Netzwerke freigeben.");
  console.log("  macOS:   Systemeinstellungen → Netzwerk → Firewall → Node erlauben.");
  console.log(line);
});

server.on("error", err => {
  console.error("Server konnte nicht gestartet werden:", err.message);
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} ist belegt. Anderen Port setzen: PORT=3001 npm start`);
  if (err.code === "EACCES") console.error(`Keine Berechtigung für ${BIND_HOST}:${PORT}. Bitte anderen Port wählen.`);
});

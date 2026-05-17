const crypto = require("crypto");
const os = require("os");
const path = require("path");
const express = require("express");
const http = require("http");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const ROOM_CODE_LENGTH = 6;
const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const room = {
  code: makeRoomCode(),
  hostSocketId: null,
  playersById: new Map(),
  playerIdByName: new Map(),
  prompt: null,
  answers: new Map(),
  controllerId: null,
  controllerActions: [],
  open: false
};

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
  }
  return code;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
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

function resetRoomForNewSession({ keepHostSocketId = true, newCode = true } = {}) {
  const hostSocketId = keepHostSocketId ? room.hostSocketId : null;
  if (newCode) room.code = makeRoomCode();
  room.hostSocketId = hostSocketId;
  room.playersById = new Map();
  room.playerIdByName = new Map();
  room.prompt = null;
  room.answers = new Map();
  room.controllerId = null;
  room.controllerActions = [];
  room.open = false;
}

function slimPrompt(prompt) {
  if (!prompt) return null;
  return {
    id: prompt.id,
    type: prompt.type,
    title: prompt.title,
    text: prompt.text,
    kind: prompt.kind,
    createdAt: prompt.createdAt
  };
}

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
    open: room.open
  };
}

function emitRoomState() {
  io.to(room.code).emit("room:state", roomSnapshot());
  if (room.hostSocketId) io.to(room.hostSocketId).emit("host:players", roomSnapshot());
}

function resolveRoomCode(inputCode) {
  const code = String(inputCode || room.code).trim().toLowerCase();
  return code || room.code;
}

function getHostUrls() {
  const urls = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, ...getLanAddresses()];
  return [...new Set(urls)];
}

app.use("/family-music-quiz", express.static(ROOT));
app.use("/public", express.static(path.join(ROOT, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/player", (_req, res) => res.sendFile(path.join(ROOT, "public", "player.html")));
app.get("/room-info", (_req, res) => res.json(roomSnapshot()));
app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.url || "").trim();
  if (!text) {
    res.status(400).send("Missing url");
    return;
  }
  const svg = await QRCode.toString(text, { type: "svg", margin: 1, width: 260 });
  res.type("image/svg+xml").send(svg);
});

io.on("connection", socket => {
  socket.on("host:createRoom", (payload = {}, ack) => {
    if (payload.newSession || !room.open) {
      resetRoomForNewSession({ keepHostSocketId: false, newCode: payload.newSession || !room.open });
    }
    room.hostSocketId = socket.id;
    room.open = true;
    room.prompt = null;
    room.answers = new Map();
    room.controllerId = null;
    room.controllerActions = [];
    socket.data.isHost = true;
    socket.join(room.code);
    ack?.(roomSnapshot());
    emitRoomState();
  });

  socket.on("player:join", (payload = {}, ack) => {
    const requestedCode = resolveRoomCode(payload.roomCode);
    if (requestedCode !== room.code) {
      ack?.({ ok: false, error: "Raum nicht gefunden." });
      return;
    }
    if (!room.open || !room.hostSocketId) {
      ack?.({ ok: false, error: "Der Raum ist gerade geschlossen. Bitte Host auf Mehrgeräte-Modus stellen." });
      return;
    }

    const cleanName = String(payload.name || "").trim().replace(/\s+/g, " ");
    const normalized = normalizeName(cleanName);
    if (!normalized) {
      ack?.({ ok: false, error: "Bitte Namen eingeben." });
      return;
    }

    let player = room.playersById.get(room.playerIdByName.get(normalized));
    if (!player) {
      player = {
        id: crypto.randomUUID(),
        name: cleanName,
        active: true,
        socketId: socket.id,
        lastSeenAt: Date.now()
      };
      room.playersById.set(player.id, player);
      room.playerIdByName.set(normalized, player.id);
    } else {
      player.name = cleanName;
      player.socketId = socket.id;
      player.active = payload.active === false ? false : player.active !== false;
      player.lastSeenAt = Date.now();
    }

    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    ack?.({ ok: true, roomCode: room.code, player: publicPlayer(player), prompt: promptForPlayer(player.id), controllerId: room.controllerId, controllerActions: room.controllerActions });
    emitRoomState();
  });

  socket.on("host:closeRoom", (_payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann den Raum schließen." });
      return;
    }
    const oldCode = room.code;
    io.to(oldCode).emit("player:roomClosed", { error: "Der Host hat den Mehrgeräte-Modus beendet. Für eine neue Sitzung bitte mit neuem Code beitreten." });
    resetRoomForNewSession({ keepHostSocketId: true, newCode: true });
    socket.leave(oldCode);
    ack?.({ ok: true, roomCode: room.code });
    emitRoomState();
  });

  socket.on("player:setActive", (payload = {}, ack) => {
    const playerId = payload.playerId || socket.data.playerId;
    const player = room.playersById.get(playerId);
    if (!player) {
      ack?.({ ok: false, error: "Spieler nicht gefunden." });
      return;
    }
    player.active = payload.active !== false;
    player.lastSeenAt = Date.now();
    ack?.({ ok: true, player: publicPlayer(player) });
    emitRoomState();
  });

  socket.on("player:submitAnswer", (payload = {}, ack) => {
    const playerId = payload.playerId || socket.data.playerId;
    const player = room.playersById.get(playerId);
    if (!player) {
      ack?.({ ok: false, error: "Spieler nicht gefunden." });
      return;
    }
    if (!room.prompt || payload.promptId !== room.prompt.id) {
      ack?.({ ok: false, error: "Diese Frage ist nicht mehr aktiv." });
      return;
    }
    const answerPayload = {
      playerId,
      playerName: player.name,
      promptId: payload.promptId,
      type: room.prompt.type,
      answer: payload.answer,
      submittedAt: Date.now()
    };
    room.answers.set(playerId, answerPayload);
    io.to(room.code).emit("host:answerSubmitted", answerPayload);
    emitRoomState();
    ack?.({ ok: true });
  });

  socket.on("host:setController", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann die Steuerung vergeben." });
      return;
    }
    room.controllerId = payload.playerId || null;
    if (!room.controllerId) room.controllerActions = [];
    emitRoomState();
    ack?.({ ok: true, controllerId: room.controllerId });
  });

  socket.on("player:controlAction", (payload = {}, ack) => {
    const playerId = payload.playerId || socket.data.playerId;
    if (!playerId || playerId !== room.controllerId) {
      ack?.({ ok: false, error: "Du hast gerade keine Steuerung." });
      return;
    }
    const allowedActions = new Set((room.controllerActions || []).flatMap(action => [action.id, ...((action.options || []).map(option => option.id))]));
    if (!allowedActions.has(payload.action)) {
      ack?.({ ok: false, error: "Diese Steuerung ist gerade nicht verfügbar." });
      return;
    }
    io.to(room.hostSocketId).emit("host:controlAction", { playerId, action: payload.action });
    ack?.({ ok: true });
  });

  socket.on("host:setControllerActions", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann Handy-Buttons setzen." });
      return;
    }
    room.controllerActions = Array.isArray(payload.actions)
      ? payload.actions.filter(action => action && action.id && action.label).slice(0, 18).map(action => ({
        id: String(action.id),
        label: String(action.label),
        options: Array.isArray(action.options)
          ? action.options.filter(option => option && option.id && option.label).slice(0, 4).map(option => ({ id: String(option.id), label: String(option.label) }))
          : []
      }))
      : [];
    emitRoomState();
    ack?.({ ok: true, controllerActions: room.controllerActions });
  });

  socket.on("host:startPrompt", (payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann Prompts starten." });
      return;
    }
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
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann Reveal starten." });
      return;
    }
    io.to(room.code).emit("player:reveal", payload);
    ack?.({ ok: true });
  });

  socket.on("host:resetRound", (_payload = {}, ack) => {
    if (socket.id !== room.hostSocketId) {
      ack?.({ ok: false, error: "Nur der Host kann Runden zurücksetzen." });
      return;
    }
    room.prompt = null;
    room.answers = new Map();
    io.to(room.code).emit("player:resetRound");
    emitRoomState();
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (room.hostSocketId === socket.id) {
      const oldCode = room.code;
      io.to(oldCode).emit("player:roomClosed", { error: "Host-Verbindung getrennt. Raum geschlossen." });
      resetRoomForNewSession({ keepHostSocketId: false, newCode: true });
    }
    if (socket.data.playerId) {
      const player = room.playersById.get(socket.data.playerId);
      if (player) {
        player.socketId = null;
        player.lastSeenAt = Date.now();
      }
    }
    emitRoomState();
  });
});

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter(net => net.family === "IPv4" && !net.internal)
    .map(net => `http://${net.address}:${PORT}`);
}

server.listen(PORT, HOST, () => {
  console.log("Family Music Quiz local multi-device server läuft.");
  console.log(`Server lauscht auf: ${HOST}:${PORT}`);
  console.log(`Host lokal: http://localhost:${PORT}`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log("Im selben WLAN diese Adresse auf Handys verwenden:");
    lan.forEach(url => console.log(`  ${url}/player`));
  } else {
    console.log(`Hinweis: Für Handys bitte die lokale WLAN-IP dieses Rechners verwenden, z.B. http://<wlan-ip>:${PORT}/player`);
  }
  console.log(`Raumcode: ${room.code}`);
});

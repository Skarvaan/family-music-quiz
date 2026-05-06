window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: multiplayer.js ist nur die lokale Socket.IO-Ergänzung. Single-Device bleibt ohne Socket nutzbar.

FMQ.multiplayer = {
  enabled: false,
  connected: false,
  socket: null,
  roomCode: null,
  joinUrl: null,
  players: [],
  prompt: null,
  answeredPlayerIds: new Set(),
  hostUrls: [],
  supportedMode: "bestFit",
  pendingScript: null
};

FMQ.isLocalMultiServer = () => ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname) || window.location.port === "3000";
FMQ.isMultiDevice = () => FMQ.multiplayer.enabled === true;
FMQ.normalizedPlayerName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

FMQ.loadSocketIoClient = () => {
  if (window.io) return Promise.resolve();
  if (FMQ.multiplayer.pendingScript) return FMQ.multiplayer.pendingScript;
  FMQ.multiplayer.pendingScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/socket.io/socket.io.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Socket.IO Client konnte nicht geladen werden. Bitte lokalen Server mit npm start verwenden."));
    document.head.appendChild(script);
  });
  return FMQ.multiplayer.pendingScript;
};

FMQ.setDeviceMode = (mode) => {
  FMQ.app.state.deviceMode = mode === "multi" ? "multi" : "single";
  FMQ.multiplayer.enabled = FMQ.app.state.deviceMode === "multi";
  FMQ.renderDeviceModePanel?.();
  FMQ.renderSetupWizard?.();
};

FMQ.setPlayerActive = (playerId, active, { notify = true } = {}) => {
  const p = FMQ.app.players.find(x => x.id === playerId || x.remoteId === playerId);
  if (!p) return false;
  p.active = active !== false;
  p.pendingActive = undefined;
  FMQ.ensureActiveTurnIndex?.();
  FMQ.renderPlayerSwitchPanel?.();
  FMQ.renderScoreTable?.();
  FMQ.renderMultiplayerPanel?.();
  if (notify && FMQ.isMultiDevice() && FMQ.multiplayer.socket) {
    FMQ.multiplayer.socket.emit("player:setActive", { playerId: p.remoteId || p.id, active: p.active });
  }
  return true;
};

FMQ.submitAnswer = (playerId, answer) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitAnswerToSession(session, playerId, answer);
  FMQ.renderMultiplayerPanel?.();
  return answer;
};

FMQ.submitVote = (playerId, vote) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitVoteToSession(session, playerId, vote);
  FMQ.renderMultiplayerPanel?.();
  return vote;
};

FMQ.submitMainAnswer = (playerId, answer) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitMainAnswerToSession(session, playerId, answer);
  FMQ.renderMultiplayerPanel?.();
  return answer;
};

FMQ.ensureRemotePlayer = (remotePlayer) => {
  if (!remotePlayer?.id) return null;
  const normalized = FMQ.normalizedPlayerName(remotePlayer.name);
  let player = FMQ.app.players.find(p => p.remoteId === remotePlayer.id || p.id === remotePlayer.id);
  if (!player && normalized) player = FMQ.app.players.find(p => !p.remoteId && FMQ.normalizedPlayerName(p.name) === normalized);
  if (!player) {
    player = {
      id: remotePlayer.id,
      remoteId: remotePlayer.id,
      name: remotePlayer.name,
      playlistId: "",
      playlistName: "",
      tracks: [],
      spanMin: null,
      spanMax: null,
      score: 0,
      active: remotePlayer.active !== false,
      pendingActive: undefined,
      remoteConnected: remotePlayer.connected !== false
    };
    FMQ.app.players.push(player);
  } else {
    const oldId = player.id;
    player.id = remotePlayer.id;
    player.remoteId = remotePlayer.id;
    player.name = remotePlayer.name || player.name;
    player.active = remotePlayer.active !== false;
    player.remoteConnected = remotePlayer.connected !== false;
    if (oldId !== player.id) FMQ.rebuildTrackUniverse?.();
  }
  return player;
};

FMQ.syncRemotePlayers = (remotePlayers = []) => {
  remotePlayers.forEach(FMQ.ensureRemotePlayer);
  const remoteIds = new Set(remotePlayers.map(p => p.id));
  FMQ.app.players.forEach(p => {
    if (p.remoteId && !remoteIds.has(p.remoteId)) p.remoteConnected = false;
  });
  const input = FMQ.$("playerCountInput");
  if (input && FMQ.isMultiDevice()) input.value = String(FMQ.app.players.length);
  FMQ.rebuildTrackUniverse?.();
  FMQ.buildPlayersConfig?.({ preserveCount: true });
  FMQ.renderMultiplayerPanel?.();
  FMQ.checkReadyToStart?.();
};

FMQ.playerUrlWithRoom = (baseUrl) => {
  const room = FMQ.multiplayer.roomCode || "";
  return `${baseUrl.replace(/\/$/, "")}/player${room ? `?room=${encodeURIComponent(room)}` : ""}`;
};

FMQ.buildJoinUrl = () => FMQ.playerUrlWithRoom(window.location.origin);

FMQ.getPhoneJoinUrl = () => {
  const current = window.location.origin;
  const urls = FMQ.multiplayer.hostUrls || [];
  const lan = urls.find(url => !url.includes("localhost") && !url.includes("127.0.0.1"));
  return FMQ.playerUrlWithRoom(lan || current);
};

FMQ.enableMultiDeviceMode = async () => {
  if (!FMQ.isLocalMultiServer()) {
    FMQ.setDeviceMode("single");
    FMQ.showMultiDeviceHint("Für Mehrgeräte-Modus bitte lokalen Server starten: npm start und dann die lokale Adresse öffnen.");
    return false;
  }
  await FMQ.loadSocketIoClient();
  FMQ.setDeviceMode("multi");
  FMQ.app.config.category = "social";
  FMQ.app.config.mode = FMQ.multiplayer.supportedMode;
  if (FMQ.$("modeSelect")) FMQ.$("modeSelect").value = FMQ.multiplayer.supportedMode;
  FMQ.app.players = [];
  if (FMQ.$("playerCountInput")) {
    FMQ.$("playerCountInput").min = "0";
    FMQ.$("playerCountInput").value = "0";
  }
  FMQ.buildPlayersConfig?.();
  FMQ.renderModeButtons?.();
  FMQ.renderSetupWizard?.();

  if (!FMQ.multiplayer.socket) {
    FMQ.multiplayer.socket = window.io();
    FMQ.bindMultiplayerSocket(FMQ.multiplayer.socket);
  }
  FMQ.multiplayer.socket.emit("host:createRoom", {}, snapshot => {
    FMQ.multiplayer.connected = true;
    FMQ.multiplayer.roomCode = snapshot.roomCode;
    FMQ.multiplayer.hostUrls = snapshot.hostUrls || [];
    FMQ.multiplayer.joinUrl = FMQ.getPhoneJoinUrl();
    FMQ.multiplayer.players = snapshot.players || [];
    FMQ.syncRemotePlayers(FMQ.multiplayer.players);
    FMQ.renderDeviceModePanel?.();
    FMQ.showMultiDeviceHint(`Mehrgeräte-Modus aktiv. Raumcode: ${FMQ.multiplayer.roomCode}`);
  });
  return true;
};

FMQ.bindMultiplayerSocket = (socket) => {
  socket.on("connect", () => {
    FMQ.multiplayer.connected = true;
    if (FMQ.isMultiDevice()) socket.emit("host:createRoom", {}, snapshot => {
      FMQ.multiplayer.roomCode = snapshot.roomCode;
      FMQ.multiplayer.hostUrls = snapshot.hostUrls || [];
      FMQ.multiplayer.joinUrl = FMQ.getPhoneJoinUrl();
      FMQ.multiplayer.players = snapshot.players || [];
      FMQ.syncRemotePlayers(FMQ.multiplayer.players);
    });
    FMQ.renderMultiplayerPanel?.();
  });
  socket.on("disconnect", () => {
    FMQ.multiplayer.connected = false;
    FMQ.renderMultiplayerPanel?.();
  });
  socket.on("host:players", snapshot => {
    FMQ.multiplayer.roomCode = snapshot.roomCode || FMQ.multiplayer.roomCode;
    FMQ.multiplayer.hostUrls = snapshot.hostUrls || FMQ.multiplayer.hostUrls || [];
    FMQ.multiplayer.joinUrl = FMQ.getPhoneJoinUrl();
    FMQ.multiplayer.players = snapshot.players || [];
    FMQ.multiplayer.prompt = snapshot.prompt || FMQ.multiplayer.prompt;
    FMQ.multiplayer.answeredPlayerIds = new Set(snapshot.answeredPlayerIds || []);
    FMQ.syncRemotePlayers(FMQ.multiplayer.players);
  });
  socket.on("host:answerSubmitted", payload => {
    if (!payload?.playerId) return;
    if (payload.type === "bestFitVote") FMQ.submitVote(payload.playerId, payload.answer);
    if (payload.type === "bestFitMain") FMQ.submitMainAnswer(payload.playerId, payload.answer);
    FMQ.multiplayer.answeredPlayerIds.add(payload.playerId);
    if (FMQ.app.config.mode === "bestFit") FMQ.modes.bestFit.renderArea();
  });
};

FMQ.showMultiDeviceHint = (message) => {
  const el = FMQ.$("multiDeviceStatus");
  if (el) el.textContent = message;
};

FMQ.renderDeviceModePanel = () => {
  const panel = FMQ.$("deviceModePanel");
  if (!panel) return;
  const local = FMQ.isLocalMultiServer();
  const active = FMQ.isMultiDevice();
  const room = FMQ.multiplayer.roomCode || "…";
  const phoneUrl = active ? FMQ.getPhoneJoinUrl() : "";
  const localUrl = active ? FMQ.buildJoinUrl() : "";
  const qrUrl = active && phoneUrl ? `/qr.svg?url=${encodeURIComponent(phoneUrl)}` : "";
  panel.innerHTML = `
    <div class="deviceModeCards">
      <button id="singleDeviceModeBtn" class="menu-card compact ${!active ? "active" : ""}"><span class="card-title">Ein-Gerät-Modus</span><span class="card-subtitle">Wie bisher: alle Eingaben am Host.</span></button>
      <button id="multiDeviceModeBtn" class="menu-card compact ${active ? "active" : ""}"><span class="card-title">Mehrgeräte-Modus</span><span class="card-subtitle">Lokal im WLAN mit Handys.</span></button>
    </div>
    <div id="multiDeviceStatus" class="muted multiDeviceStatus">${active ? `Mehrgeräte-Modus aktiv · Raum ${FMQ.escapeHtml(room)}` : local ? "Lokaler Server erkannt. Mehrgeräte-Modus ist möglich." : "Für Mehrgeräte-Modus bitte lokalen Server starten: npm start und dann die lokale Adresse öffnen."}</div>
    ${active ? `
      <section class="multiLobbyCard">
        <div class="section-title-row">
          <div><div class="eyebrow">Warteraum</div><h2>Raum ${FMQ.escapeHtml(room)}</h2></div>
          <span class="pill ${FMQ.multiplayer.connected ? "ok" : "bad"}">${FMQ.multiplayer.connected ? "online" : "offline"}</span>
        </div>
        <div class="multiLobbyGrid">
          <div class="qrBox">${qrUrl ? `<img alt="QR-Code zum Beitreten" src="${qrUrl}">` : ""}</div>
          <div class="joinInstructions">
            <b>Handys öffnen:</b>
            <div class="joinLink">${FMQ.escapeHtml(phoneUrl)}</div>
            ${localUrl !== phoneUrl ? `<div class="muted">Host lokal: ${FMQ.escapeHtml(localUrl)}</div>` : ""}
            <div class="muted">Raumcode: <b>${FMQ.escapeHtml(room)}</b> · Groß-/Kleinschreibung egal.</div>
            <div class="muted">Alle treten mit ihrem Namen bei. Gleicher Name verbindet nach Abbruch wieder denselben Spieler.</div>
          </div>
        </div>
        <div class="multiLobbyRoster">
          ${(FMQ.app.players || []).map(p => `<span class="pill ${p.remoteConnected ? "ok" : ""}">${FMQ.escapeHtml(p.name)} · ${p.remoteConnected ? "drin" : "offline"}</span>`).join("") || `<span class="muted">Noch niemand beigetreten.</span>`}
        </div>
      </section>` : ""}
  `;
  FMQ.$("singleDeviceModeBtn").onclick = () => {
    FMQ.setDeviceMode("single");
    FMQ.showMultiDeviceHint("Ein-Gerät-Modus aktiv.");
  };
  FMQ.$("multiDeviceModeBtn").onclick = () => FMQ.enableMultiDeviceMode().catch(e => FMQ.showMultiDeviceHint(e.message));
};

FMQ.getMultiplayerExpectedIds = ({ includeMain = false } = {}) => {
  const s = FMQ.app.state.social;
  const ids = FMQ.activePlayers()
    .filter(p => includeMain ? p.id === s?.mainPlayerId : p.id !== s?.mainPlayerId)
    .map(p => p.remoteId || p.id);
  return ids;
};

FMQ.hasAnsweredAll = (expectedIds, answersByPlayer = {}) => expectedIds.every(id => Object.prototype.hasOwnProperty.call(answersByPlayer, id));

FMQ.startMultiplayerPrompt = (payload) => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.prompt = payload;
  FMQ.multiplayer.answeredPlayerIds = new Set();
  FMQ.multiplayer.socket.emit("host:startPrompt", payload, res => {
    if (!res?.ok) FMQ.setGameDebug?.(res?.error || "Prompt konnte nicht gestartet werden.");
  });
};

FMQ.resetMultiplayerRound = () => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.prompt = null;
  FMQ.multiplayer.answeredPlayerIds = new Set();
  FMQ.multiplayer.socket.emit("host:resetRound", {});
};

FMQ.revealMultiplayerPrompt = (payload = {}) => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.socket.emit("host:reveal", payload);
};

FMQ.renderMultiplayerPanel = () => {
  const panels = [FMQ.$("multiplayerPanel"), FMQ.$("multiplayerSetupPanel")].filter(Boolean);
  if (!panels.length) return;
  const renderEmpty = () => {
    panels.forEach(panel => {
      panel.style.display = "none";
      panel.innerHTML = "";
    });
  };
  if (!FMQ.isMultiDevice()) {
    renderEmpty();
    return;
  }
  const joinUrl = FMQ.multiplayer.joinUrl || FMQ.getPhoneJoinUrl();
  const players = FMQ.app.players;
  const s = FMQ.app.state.social;
  const answers = s?.answersByPlayer || {};
  const html = `
    <div class="multiHostCard">
      <div class="section-title-row">
        <div><div class="eyebrow">Mehrgeräte-Modus</div><h3>Raum ${FMQ.escapeHtml(FMQ.multiplayer.roomCode || "…")}</h3></div>
        <span class="pill ${FMQ.multiplayer.connected ? "ok" : "bad"}">${FMQ.multiplayer.connected ? "verbunden" : "offline"}</span>
      </div>
      <div class="muted">Handys öffnen: <b>${FMQ.escapeHtml(joinUrl)}</b></div>
      <div class="muted">Wichtig: Jeder nutzt denselben Namen beim Rejoin. Gleicher Name = gleicher Spieler; Tippfehler erzeugen neue Spieler.</div>
      <div class="multiRoster">
        ${players.map(p => {
          const id = p.remoteId || p.id;
          const answered = Object.prototype.hasOwnProperty.call(answers, id) || Object.prototype.hasOwnProperty.call(answers, p.id);
          return `<div class="multiRosterRow ${p.active === false ? "paused" : ""}"><span><b>${FMQ.escapeHtml(p.name)}</b><small>${p.remoteConnected ? "online" : "offline"} · ${p.active === false ? "pausiert" : "aktiv"}${answered ? " · geantwortet" : ""}</small></span><label><input type="checkbox" data-role="multi-active" data-pid="${FMQ.escapeHtml(id)}" ${p.active !== false ? "checked" : ""}> aktiv</label></div>`;
        }).join("") || `<div class="muted">Noch keine Handy-Spieler verbunden.</div>`}
      </div>
    </div>
  `;
  panels.forEach(panel => {
    panel.style.display = "block";
    panel.innerHTML = html;
    panel.querySelectorAll('[data-role="multi-active"]').forEach(inp => inp.onchange = () => FMQ.setPlayerActive(inp.getAttribute("data-pid"), inp.checked));
  });
};

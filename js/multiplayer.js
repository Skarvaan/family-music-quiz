window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: multiplayer.js ist nur die lokale Socket.IO-Ergänzung. Single-Device bleibt ohne Socket nutzbar.

/* Verbindung zum lokalen Server: Socket, Raum öffnen und schließen, Beitrittslinks. */

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
  controllerId: null,
  controllerActions: [],
  supportedMode: null,
  pendingScript: null
};

FMQ.isLoopbackHost = (host = window.location.hostname) => ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(String(host || "").toLowerCase());

FMQ.isLocalMultiServer = () => FMQ.isLoopbackHost() || window.location.port === "3000";

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
  const nextMode = mode === "multi" ? "multi" : "single";
  const wasMulti = FMQ.multiplayer.enabled === true;
  FMQ.app.state.deviceMode = nextMode;
  FMQ.multiplayer.enabled = nextMode === "multi";
  document.body.classList.toggle("multi-device-active", FMQ.multiplayer.enabled);
  if (!FMQ.multiplayer.enabled && FMQ.app.config.category === "challenge") {
    FMQ.app.config.category = "self";
    FMQ.app.config.mode = "quick3";
    FMQ.app.config.songChallengeType = "storyPrompt";
    if (FMQ.$("modeSelect")) FMQ.$("modeSelect").value = "quick3";
  }

  if (!FMQ.multiplayer.enabled) {
    if (wasMulti) FMQ.closeMultiplayerRoom?.();
    if (FMQ.$("playerCountInput")) {
      FMQ.$("playerCountInput").min = "1";
      if (!FMQ.app.players.length) FMQ.$("playerCountInput").value = "1";
    }
    if (!FMQ.app.players.length) FMQ.buildPlayersConfig?.();
  }

  FMQ.renderDeviceModePanel?.();
  FMQ.renderSetupWizard?.();
};

FMQ.playerUrlWithRoom = (baseUrl) => {
  const room = FMQ.multiplayer.roomCode || "";
  return `${baseUrl.replace(/\/$/, "")}/player${room ? `?room=${encodeURIComponent(room)}` : ""}`;
};

FMQ.buildJoinUrl = () => FMQ.playerUrlWithRoom(window.location.origin);

FMQ.getPhoneJoinUrl = () => {
  const current = window.location.origin;
  if (!FMQ.isLoopbackHost()) return FMQ.playerUrlWithRoom(current);
  const urls = FMQ.multiplayer.hostUrls || [];
  const lan = urls.find(url => {
    try { return !FMQ.isLoopbackHost(new URL(url).hostname); } catch { return false; }
  });
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
  if (FMQ.$("modeSelect")) FMQ.app.config.mode = FMQ.$("modeSelect").value || "quick3";
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
    FMQ.multiplayer.controllerId = snapshot.controllerId || null;
    FMQ.multiplayer.controllerActions = Array.isArray(snapshot.controllerActions) ? snapshot.controllerActions : [];
    FMQ.syncRemotePlayers(FMQ.multiplayer.players);
    FMQ.renderDeviceModePanel?.();
    FMQ.renderMultiplayerPanel?.();
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
      FMQ.multiplayer.controllerId = snapshot.controllerId || null;
      FMQ.multiplayer.controllerActions = Array.isArray(snapshot.controllerActions) ? snapshot.controllerActions : [];
      FMQ.syncRemotePlayers(FMQ.multiplayer.players);
      FMQ.renderDeviceModePanel?.();
      FMQ.renderMultiplayerPanel?.();
    });
    FMQ.renderDeviceModePanel?.();
    FMQ.renderMultiplayerPanel?.();
  });
  socket.on("disconnect", () => {
    FMQ.multiplayer.connected = false;
    FMQ.renderMultiplayerPanel?.();
  });
  socket.on("host:players", snapshot => {
    if (!FMQ.isMultiDevice()) return;
    FMQ.multiplayer.roomCode = snapshot.roomCode || FMQ.multiplayer.roomCode;
    FMQ.multiplayer.hostUrls = snapshot.hostUrls || FMQ.multiplayer.hostUrls || [];
    FMQ.multiplayer.joinUrl = FMQ.getPhoneJoinUrl();
    FMQ.multiplayer.players = snapshot.players || [];
    FMQ.multiplayer.controllerId = snapshot.controllerId || null;
    FMQ.multiplayer.controllerActions = Array.isArray(snapshot.controllerActions) ? snapshot.controllerActions : [];
    FMQ.multiplayer.prompt = snapshot.prompt || FMQ.multiplayer.prompt;
    FMQ.multiplayer.answeredPlayerIds = new Set(snapshot.answeredPlayerIds || []);
    FMQ.syncRemotePlayers(FMQ.multiplayer.players);
    FMQ.renderDeviceModePanel?.();
    FMQ.renderMultiplayerPanel?.();
  });
  socket.on("host:answerSubmitted", payload => {
    if (!payload?.playerId) return;
    FMQ.handleMultiplayerAnswer?.(payload);
  });
  socket.on("host:controlAction", payload => FMQ.handleRemoteControlAction?.(payload.action));
};

FMQ.resetLocalMultiplayerSession = () => {
  FMQ.multiplayer.roomCode = null;
  FMQ.multiplayer.joinUrl = null;
  FMQ.multiplayer.players = [];
  FMQ.multiplayer.prompt = null;
  FMQ.multiplayer.answeredPlayerIds = new Set();
  FMQ.multiplayer.controllerId = null;
  FMQ.multiplayer.controllerActions = [];
  FMQ.app.players.forEach(p => { if (p.remoteId) p.remoteConnected = false; });
};

FMQ.closeMultiplayerRoom = ({ switchToSingle = false } = {}) => {
  if (FMQ.multiplayer.socket && FMQ.multiplayer.connected) {
    FMQ.multiplayer.socket.emit("host:closeRoom", {}, snapshot => {
      if (snapshot?.roomCode) FMQ.multiplayer.roomCode = snapshot.roomCode;
      FMQ.renderDeviceModePanel?.();
      FMQ.renderMultiplayerPanel?.();
    });
  }
  FMQ.resetLocalMultiplayerSession();
  FMQ.setMultiplayerControllerActions?.([]);
  if (switchToSingle) {
    FMQ.multiplayer.enabled = false;
    FMQ.app.state.deviceMode = "single";
    document.body.classList.remove("multi-device-active");
  }
};

FMQ.closeMultiplayerSession = () => {
  FMQ.closeMultiplayerRoom({ switchToSingle: true });
  FMQ.showMultiDeviceHint?.("Sitzung geschlossen. Beim nächsten Öffnen wird ein neuer Raumcode erstellt.");
  FMQ.renderDeviceModePanel?.();
  FMQ.renderSetupWizard?.();
};

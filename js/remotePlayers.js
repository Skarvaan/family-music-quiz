window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Handy-Spieler mit den lokalen Spielerplätzen zusammenführen. */

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

FMQ.skipMultiplayerPlayer = (playerId) => {
  const player = FMQ.app.players.find(p => p.id === playerId || p.remoteId === playerId);
  if (!player) return;
  const wasCurrent = FMQ.currentPlayer()?.id === player.id;
  FMQ.setPlayerActive(player.remoteId || player.id, false);
  FMQ.showMultiDeviceHint?.(`${player.name} wurde für den Moment übersprungen.`);
  if (wasCurrent && typeof FMQ.onNext === "function" && FMQ.$("screenGame")?.classList.contains("active")) {
    FMQ.onNext();
    return;
  }
  const mode = FMQ.app.config.mode;
  if (FMQ.$("screenGame")?.classList.contains("active") && FMQ.modes?.[mode]?.renderArea) FMQ.modes[mode].renderArea();
  FMQ.renderMultiplayerPanel?.();
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
    // Alte (lokale) ID merken: Formularfelder, die noch mit ihr
    // beschriftet sind, finden den Spieler so trotzdem.
    if (oldId !== remotePlayer.id && !player.localId) player.localId = oldId;
    player.id = remotePlayer.id;
    player.remoteId = remotePlayer.id;
    player.name = remotePlayer.name || player.name;
    player.active = remotePlayer.active !== false;
    player.remoteConnected = remotePlayer.connected !== false;
    if (oldId !== player.id) FMQ.rebuildTrackUniverse?.();
  }
  return player;
};

// Wann wurde zuletzt eine Auswahlliste angetippt? Auf dem iPad bleibt
// eine <select> nach dem Auswählen im Fokus, bis man woanders hintippt.
// Früher galt das Formular dadurch dauerhaft als "wird gerade bedient",
// und neu beigetretene Handy-Spieler bekamen keine Playlist-Zeile, bis
// man die Spieleranzahl änderte.
FMQ.app.lastSelectTouchAt = 0;
document.addEventListener("focusin", e => { if (e.target?.tagName === "SELECT") FMQ.app.lastSelectTouchAt = Date.now(); });

FMQ.isSetupControlActive = () => {
  const active = document.activeElement;
  if (!active || !active.closest?.("#playersConfig,#multiplayerSetupPanel,#modeConfigArea,#setupNav")) return false;
  // Textfelder (Namen tippen): wirklich aktiv, nicht stören.
  if (active.tagName === "INPUT" && /^(text|search|number)$/i.test(active.type || "text")) return true;
  // Auswahllisten nur kurz nach dem Antippen schützen (Auswahlfenster offen).
  if (active.tagName === "SELECT") return Date.now() - FMQ.app.lastSelectTouchAt < 4000;
  return false;
};

/** Verschobener Neuaufbau, falls gerade jemand ein Feld bedient. */
FMQ.schedulePlayersRebuild = () => {
  clearTimeout(FMQ.app.playersRebuildTimer);
  FMQ.app.playersRebuildTimer = setTimeout(() => {
    if ((FMQ.app.state.setupStep || 1) !== 4) return;
    if (FMQ.isSetupControlActive()) { FMQ.schedulePlayersRebuild(); return; }
    FMQ.buildPlayersConfig?.({ preserveCount: true });
    FMQ.checkReadyToStart?.();
  }, 1000);
};

FMQ.syncRemotePlayers = (remotePlayers = []) => {
  if (!FMQ.isMultiDevice()) return;
  remotePlayers.forEach(FMQ.ensureRemotePlayer);
  const remoteIds = new Set(remotePlayers.map(p => p.id));
  FMQ.app.players.forEach(p => {
    if (p.remoteId && !remoteIds.has(p.remoteId)) p.remoteConnected = false;
  });
  const input = FMQ.$("playerCountInput");
  if (input) input.value = String(FMQ.app.players.length);
  FMQ.rebuildTrackUniverse?.();

  // Socket room snapshots can arrive while the user is tapping category/mode cards.
  // Rebuilding the prep form at that moment re-renders setup and can swallow those clicks.
  // Only rebuild the playlist/player form once the setup is actually on the prep step.
  if ((FMQ.app.state.setupStep || 1) === 4) {
    // Fehlt für einen Spieler die Formularzeile, muss neu gebaut werden.
    // Gerade aktives Feld? Dann gleich nochmal versuchen statt nie.
    if (FMQ.isSetupControlActive?.()) { FMQ.schedulePlayersRebuild(); return; }
    FMQ.buildPlayersConfig?.({ preserveCount: true });
    FMQ.checkReadyToStart?.();
  }
};

FMQ.toRemotePlayerId = (playerId) => {
  if (!playerId) return null;
  const player = FMQ.app.players.find(p => p.id === playerId || p.remoteId === playerId);
  return player?.remoteId || player?.id || playerId;
};

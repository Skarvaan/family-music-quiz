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
    player.id = remotePlayer.id;
    player.remoteId = remotePlayer.id;
    player.name = remotePlayer.name || player.name;
    player.active = remotePlayer.active !== false;
    player.remoteConnected = remotePlayer.connected !== false;
    if (oldId !== player.id) FMQ.rebuildTrackUniverse?.();
  }
  return player;
};

FMQ.isSetupControlActive = () => {
  const active = document.activeElement;
  if (!active) return false;
  return !!active.closest?.("#playersConfig,#multiplayerSetupPanel,#modeConfigArea,#setupNav");
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
    if (FMQ.isSetupControlActive?.()) return;
    FMQ.buildPlayersConfig?.({ preserveCount: true });
    FMQ.checkReadyToStart?.();
  }
};

FMQ.toRemotePlayerId = (playerId) => {
  if (!playerId) return null;
  const player = FMQ.app.players.find(p => p.id === playerId || p.remoteId === playerId);
  return player?.remoteId || player?.id || playerId;
};

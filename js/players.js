window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Spielerverwaltung: Reihenfolge, Playlists, Songvorrat, Verbindungsstatus. */

FMQ.isTrackUsed = (trackOrId) => {
  const track = typeof trackOrId === "string" ? FMQ.app.trackMap.get(trackOrId) : trackOrId;
  const id = typeof trackOrId === "string" ? trackOrId : track?.id;
  if (id && FMQ.app.usedTrackIds.has(id)) return true;
  if (!track) return false;
  const key = FMQ.trackIdentityKey(track);
  return !!key && FMQ.app.usedTrackKeys.has(key);
};

FMQ.markTrackUsed = (trackOrId) => {
  const track = typeof trackOrId === "string" ? FMQ.app.trackMap.get(trackOrId) : trackOrId;
  const id = typeof trackOrId === "string" ? trackOrId : track?.id;
  if (id) FMQ.app.usedTrackIds.add(id);
  if (track) FMQ.app.usedTrackKeys.add(FMQ.trackIdentityKey(track));
  return track || null;
};

FMQ.resetPlayedSongHistory = () => {
  FMQ.app.usedTrackIds = new Set();
  FMQ.app.usedTrackKeys = new Set();
  FMQ.app.globalDeck = FMQ.shuffle([...FMQ.app.trackMap.keys()]);
};

FMQ.activePlayers = () => FMQ.app.players.filter(p => p.active !== false);

FMQ.playerHasMusic = (p) => p && p.spectator !== true && !!p.playlistId && (p.tracks?.length || 0) >= 5;

FMQ.musicPlayers = () => FMQ.activePlayers().filter(FMQ.playerHasMusic);

FMQ.currentPlayer = () => {
  const cur = FMQ.app.players[FMQ.app.state.turnIndex];
  if (cur && cur.active !== false && cur.spectator !== true) return cur;
  return FMQ.musicPlayers()[0] || FMQ.activePlayers()[0] || FMQ.app.players[0] || null;
};

FMQ.getPlayerName = (id) => FMQ.app.players.find(p => p.id === id || p.remoteId === id)?.name || "Unbekannt";

FMQ.advanceTurn = () => {
  const players = FMQ.app.players;
  const turnPlayers = FMQ.activePlayers().filter(p => p.spectator !== true);
  if (!turnPlayers.length || !players.length) return;
  const startIndex = Math.max(0, Math.min(players.length - 1, FMQ.app.state.turnIndex || 0));
  for (let step = 1; step <= players.length; step++) {
    const idx = (startIndex + step) % players.length;
    if (players[idx]?.active !== false && players[idx]?.spectator !== true) {
      FMQ.app.state.turnIndex = idx;
      if (idx <= startIndex) FMQ.app.state.round++;
      return;
    }
  }
};

// Wer spielt mit, entscheidet über die Fragen: mit Kindern am
// Tisch sollen keine Ex-Partner-Fragen kommen.

FMQ.refreshPlaylistDropdowns = () => {
  FMQ.$("playersConfig")?.querySelectorAll('select[data-role="playlist"]').forEach(sel => {
    const p = FMQ.app.players.find(x => x.id === sel.dataset.pid);
    const cur = p?.playlistId || "";
    sel.innerHTML = ['<option value="">(Playlist wählen…)</option>', ...FMQ.app.playlists.map(pl => {
      const cnt = typeof pl.tracks?.total === "number" ? pl.tracks.total : "?";
      const maxLen = 38;
      const shortName = pl.name.length > maxLen ? `${pl.name.slice(0, maxLen - 1)}…` : pl.name;
      return `<option value="${FMQ.escapeHtml(pl.id)}" ${pl.id === cur ? "selected" : ""} title="${FMQ.escapeHtml(pl.name)}">${FMQ.escapeHtml(shortName)} (${cnt})</option>`;
    })].join("");
  });
};

FMQ.rebuildTrackUniverse = () => {
  FMQ.app.trackMap = new Map();
  for (const p of FMQ.app.players) {
    for (const t of (p.tracks || [])) {
      if (!t?.id) continue;
      if (!FMQ.app.trackMap.has(t.id)) FMQ.app.trackMap.set(t.id, { ...t, owners: [p.id] });
      else {
        const ex = FMQ.app.trackMap.get(t.id);
        if (!ex.owners.includes(p.id)) ex.owners.push(p.id);
      }
    }
  }
  FMQ.app.globalDeck = [];
};

FMQ.checkReadyToStart = () => {
  const ok = !!FMQ.storage.token && FMQ.app.players.length >= 1 && FMQ.app.players.some(FMQ.playerHasMusic) && FMQ.app.players.every(p => p.name && (p.spectator === true || (p.playlistId && (p.tracks?.length || 0) >= 5 && p.spanMin && p.spanMax)));
  if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
  return ok;
};

FMQ.getEndTargetText = () => FMQ.app.config.endType === "points"
  ? `${FMQ.app.config.targetPoints} Punkte`
  : `${FMQ.app.config.targetRounds} Runden`;

FMQ.getWinnerByScore = () => [...FMQ.app.players].sort((a, b) => b.score - a.score)[0] || null;

FMQ.movePlayerConfig = (playerId, delta) => {
  const players = FMQ.app.players || [];
  const index = players.findIndex(p => p.id === playerId || p.remoteId === playerId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= players.length) return;
  const [player] = players.splice(index, 1);
  players.splice(nextIndex, 0, player);
  FMQ.buildPlayersConfig({ preserveCount: true });
};

FMQ.buildPlayersConfig = ({ preserveCount = false } = {}) => {
  const input = FMQ.$("playerCountInput");
  const minPlayers = FMQ.isMultiDevice?.() ? 0 : 1;
  const old = FMQ.app.players;
  const requested = preserveCount ? old.length : parseInt(input.value || String(minPlayers || 1), 10);
  const n = Math.max(minPlayers, Math.min(15, Number.isFinite(requested) ? requested : minPlayers));
  input.min = String(minPlayers);
  input.value = String(n);
  if (old.length && !preserveCount && old.length !== n) FMQ.resetPlayedSongHistory();

  FMQ.app.players = [];
  const wrap = document.createElement("div");
  wrap.className = "player-grid";

  for (let i = 0; i < n; i++) {
    const prev = old[i] || {};
    const p = { id: prev.id || crypto.randomUUID(), remoteId: prev.remoteId, remoteConnected: prev.remoteConnected, name: prev.name || (i === 0 ? "Spieler 1" : `Spieler ${i + 1}`), playlistId: prev.playlistId || "", playlistName: prev.playlistName || "", tracks: prev.tracks || [], spanMin: prev.spanMin || null, spanMax: prev.spanMax || null, score: prev.score || 0, active: prev.active !== false, spectator: prev.spectator === true, pendingActive: typeof prev.pendingActive === "boolean" ? prev.pendingActive : undefined };
    FMQ.app.players.push(p);
    const row = document.createElement("div");
    row.className = "player-card";
    const statusHtml = p.spectator === true
      ? `<span class="ok">👀 Nur Mitraten · keine Musikquelle</span>`
      : (p.tracks?.length || 0) >= 5
        ? `<span class="ok">✅ ${p.tracks.length} Tracks</span> <span class="muted">(Spanne ${p.spanMin ?? "?"}–${p.spanMax ?? "?"})</span>`
        : "noch nicht geladen";
    const remotePill = p.remoteId ? `<span class="pill ${p.remoteConnected ? "ok" : ""}">${p.remoteConnected ? "Handy online" : "Handy offline"}</span>` : `<span class="pill">Spieler ${i + 1}</span>`;
    const orderControls = `<div class="playerOrderControls" aria-label="Reihenfolge"><span class="orderBadge">#${i + 1}</span><button data-role="move-player" data-delta="-1" data-pid="${p.id}" type="button" class="miniOrderBtn" ${i === 0 ? "disabled" : ""}>↑</button><button data-role="move-player" data-delta="1" data-pid="${p.id}" type="button" class="miniOrderBtn" ${i === n - 1 ? "disabled" : ""}>↓</button></div>`;
    row.innerHTML = `<div class="player-card-head">${remotePill}${orderControls}<button data-role="clear-name" data-pid="${p.id}" class="clearNameBtn" type="button" aria-label="Name leeren">✕</button></div><label>Name<input data-role="name" data-pid="${p.id}" value="${FMQ.escapeHtml(p.name)}"></label><label class="spectatorSwitchRow"><input type="checkbox" data-role="spectator" data-pid="${p.id}" ${p.spectator ? "checked" : ""}> Nur Zuschauer/Mitrater (keine eigene Playlist)</label><label class="playlistConfigWrap" data-role="playlist-wrap" data-pid="${p.id}" ${p.spectator ? "hidden" : ""}>Playlist<select data-role="playlist" data-pid="${p.id}" class="playerPlaylistSelect"><option value="">(Playlist wählen…)</option></select></label><span class="player-status muted" data-role="status" data-pid="${p.id}">${statusHtml}</span>`;
    wrap.appendChild(row);
  }

  if (!n && FMQ.isMultiDevice?.()) {
    wrap.innerHTML = `<div class="muted multiEmptyPlayers">Noch keine Handy-Spieler verbunden. Handys öffnen /player, geben den Raumcode ein und nutzen bei Rejoin exakt denselben Namen.</div>`;
  }

  FMQ.$("playersConfig").innerHTML = "";
  FMQ.$("playersConfig").appendChild(wrap);

  FMQ.$("playersConfig").querySelectorAll('input[data-role="name"]').forEach(inp => inp.addEventListener("input", () => {
    const p = FMQ.app.players.find(x => x.id === inp.dataset.pid);
    if (p) p.name = inp.value.trim() || "Spieler";
    FMQ.checkReadyToStart();
  }));
  FMQ.$("playersConfig").querySelectorAll('button[data-role="move-player"]').forEach(btn => btn.addEventListener("click", () => {
    FMQ.movePlayerConfig(btn.getAttribute("data-pid"), parseInt(btn.getAttribute("data-delta"), 10));
  }));

  FMQ.$("playersConfig").querySelectorAll('button[data-role="clear-name"]').forEach(btn => btn.addEventListener("click", () => {
    const pid = btn.getAttribute("data-pid");
    const inp = FMQ.$("playersConfig").querySelector(`input[data-role="name"][data-pid="${pid}"]`);
    const p = FMQ.app.players.find(x => x.id === pid);
    if (!inp || !p) return;
    inp.value = "";
    p.name = "Spieler";
    inp.focus();
    FMQ.checkReadyToStart();
  }));

  FMQ.$("playersConfig").querySelectorAll('input[data-role="spectator"]').forEach(inp => inp.addEventListener("change", () => {
    const p = FMQ.app.players.find(x => x.id === inp.dataset.pid);
    if (!p) return;
    p.spectator = inp.checked;
    if (p.spectator) {
      p.playlistId = "";
      p.playlistName = "";
      p.tracks = [];
      p.spanMin = p.spanMax = null;
    }
    FMQ.buildPlayersConfig({ preserveCount: true });
  }));

  FMQ.refreshPlaylistDropdowns();
  FMQ.$("playersConfig").querySelectorAll('select[data-role="playlist"]').forEach(sel => sel.addEventListener("change", async () => {
    const p = FMQ.app.players.find(x => x.id === sel.dataset.pid);
    if (!p) return;

    const previousPlaylistId = p.playlistId || "";
    p.playlistId = sel.value;
    p.playlistName = FMQ.app.playlists.find(x => x.id === sel.value)?.name || "";
    if (previousPlaylistId !== p.playlistId) FMQ.resetPlayedSongHistory();
    const statusEl = FMQ.$("playersConfig").querySelector(`span[data-role="status"][data-pid="${sel.dataset.pid}"]`);

    if (p.spectator === true) {
      p.tracks = [];
      p.spanMin = p.spanMax = null;
      statusEl.innerHTML = `<span class="ok">👀 Nur Mitraten · keine Musikquelle</span>`;
      FMQ.rebuildTrackUniverse();
      FMQ.checkReadyToStart();
      return;
    }

    if (!p.playlistId) {
      p.tracks = [];
      p.spanMin = p.spanMax = null;
      statusEl.textContent = "noch nicht geladen";
      FMQ.rebuildTrackUniverse();
      FMQ.checkReadyToStart();
      return;
    }

    statusEl.textContent = "lade Tracks…";
    try {
      const tracks = await FMQ.loadAllTracksForPlaylist(p.playlistId);
      p.tracks = tracks;
      const s = FMQ.calcYearStats(tracks.map(t => t.year));
      p.spanMin = s.min;
      p.spanMax = s.max;
      statusEl.innerHTML = `<span class="ok">✅ ${tracks.length} Tracks</span> <span class="muted">(Spanne ${p.spanMin ?? "?"}–${p.spanMax ?? "?"})</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span class="bad">❌ ${FMQ.escapeHtml(e.message)}</span>`;
      p.tracks = [];
      p.spanMin = p.spanMax = null;
    }

    FMQ.rebuildTrackUniverse();
    FMQ.checkReadyToStart();
  }));

  FMQ.rebuildTrackUniverse();
  FMQ.checkReadyToStart();
  FMQ.renderMultiplayerPanel?.();
};

FMQ.setSpotifyConnectionStatus = (state, message = "") => {
  const el = FMQ.$("connStatus");
  if (!el) return;
  const states = {
    connected: { cls: "ok", icon: "✅", label: "Spotify verbunden" },
    checking: { cls: "warn", icon: "⏳", label: "Spotify wird geprüft" },
    reconnect: { cls: "bad", icon: "❌", label: "Spotify neu verbinden" }
  };
  const cfg = states[state] || states.reconnect;
  FMQ.app.state.spotifyConnectionState = state;
  el.innerHTML = `<span class="${cfg.cls}" title="${FMQ.escapeHtml(message || cfg.label)}" aria-label="${FMQ.escapeHtml(message || cfg.label)}">${cfg.icon}</span>`;
};

FMQ.refreshConnStatus = () => {
  const hasSession = !!(FMQ.storage.token || FMQ.storage.refreshToken);
  if (!hasSession) {
    FMQ.setSpotifyConnectionStatus("reconnect", "Spotify nicht verbunden");
  } else if (typeof FMQ.validateSpotifySession === "function") {
    FMQ.setSpotifyConnectionStatus("checking", "Spotify-Verbindung wird geprüft …");
    FMQ.validateSpotifySession().then(valid => {
      if (valid) {
        FMQ.setSpotifyConnectionStatus("connected");
      } else {
        FMQ.storage.token = null;
        FMQ.storage.expiresAt = null;
        FMQ.setSpotifyConnectionStatus("reconnect");
        if (FMQ.$("playlistStatus")) FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
      }
      FMQ.checkReadyToStart();
      if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
    }).catch(() => {
      FMQ.setSpotifyConnectionStatus("reconnect");
      if (FMQ.$("playlistStatus")) FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
      FMQ.checkReadyToStart();
      if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
    });
  } else {
    FMQ.setSpotifyConnectionStatus("checking", "Spotify-Verbindung wird geprüft …");
  }
  FMQ.checkReadyToStart();
  if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
};

window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: core.js enthält Shared-State, Helpers und Setup-Basislogik.

// =========================================================
// APP-METADATEN / MODUS-KATALOG
// =========================================================
FMQ.MODE_INFO = {
  quick3: { label: "Songausschnitt raten", category: "self", hint: "Ausschnitt oder ganzer Song raten" },
  rankingList: { label: "Ranking Liste", category: "self", hint: "Baue dein Top-5- oder Top-10-Ranking Song für Song" },
  ratingGuess: { label: "Song-Bewertung einschätzen", category: "social", hint: "Wie schätzen andere den Geschmack ein?" },
  bestFit: { label: "Song A oder B", category: "social", hint: "Welcher Song passt besser zur Hauptperson?" },
  introPlaylistGuess: { label: "Aus welcher Playlist ist das?", category: "intro", hint: "Alle raten nacheinander, aus welcher Playlist der Song stammt" },
  introFirst3: { label: "Meine ersten 3 Songs", category: "intro", hint: "Die vorbereiteten ersten 3 Songs jeder Playlist locker anhören" }
};
FMQ.isSocialMode = (modeId) => ["ratingGuess", "bestFit"].includes(modeId);

FMQ.SPOTIFY_CLIENT_ID = "1567cc8cfec14ea2b8562efca5dd7e08";
FMQ.REDIRECT_URI = (() => {
  const p = window.location.pathname;
  if (p.endsWith("/")) return window.location.origin + p;
  if (p.endsWith(".html")) return window.location.origin + p.replace(/[^/]+$/, "");
  return window.location.origin + p + "/";
})();
FMQ.SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-playback-state",
  "user-modify-playback-state"
].join(" ");

FMQ.$ = (id) => document.getElementById(id);
FMQ.escapeHtml = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
FMQ.showScreen = (id) => document.querySelectorAll(".screen").forEach(el => el.classList.toggle("active", el.id === id));
FMQ.setDebug = (text) => { const el = FMQ.$("debug"); if (el) el.textContent = text || ""; };
FMQ.setGameDebug = (text) => { const el = FMQ.$("debugGame"); if (el) el.textContent = text || ""; };
FMQ.shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
FMQ.normalizeTitle = (s) => String(s || "")
  .toLowerCase()
  .replace(/\([^)]*(remaster|remastered|live|version|edit|mix|mono|stereo)[^)]*\)/gi, " ")
  .replace(/\[[^\]]*(remaster|remastered|live|version|edit|mix|mono|stereo)[^\]]*\]/gi, " ")
  .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
  .replace(/[-–—]\s*(remaster(ed)?|live|version|edit|mix|mono|stereo).*$/gi, " ")
  .replace(/[^a-z0-9äöüß]+/gi, " ")
  .replace(/\s+/g, " ")
  .trim();
FMQ.normalizeArtist = (artists) => String(Array.isArray(artists) ? (artists[0] || "") : (artists || ""))
  .toLowerCase()
  .replace(/[^a-z0-9äöüß]+/gi, " ")
  .replace(/\s+/g, " ")
  .trim();
FMQ.trackIdentityKey = (track) => `${track.normalizedTitle || FMQ.normalizeTitle(track.name)}::${track.normalizedArtist || FMQ.normalizeArtist(track.artists)}`;

FMQ.yearFromReleaseDate = (d) => {
  const y = parseInt(String(d || "").slice(0, 4), 10);
  const cy = new Date().getFullYear();
  return Number.isFinite(y) && y >= 1900 && y <= cy ? y : null;
};
FMQ.calcYearStats = (years) => {
  const ys = years.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ys.length) return { min: null, max: null };
  return { min: ys[0], max: ys[ys.length - 1] };
};

FMQ.storage = {
  get token() { return localStorage.getItem("spotify_access_token"); },
  set token(v) { v ? localStorage.setItem("spotify_access_token", v) : localStorage.removeItem("spotify_access_token"); },
  get refreshToken() { return localStorage.getItem("spotify_refresh_token"); },
  set refreshToken(v) { v ? localStorage.setItem("spotify_refresh_token", v) : localStorage.removeItem("spotify_refresh_token"); },
  get scope() { return localStorage.getItem("spotify_scope") || ""; },
  set scope(v) { v ? localStorage.setItem("spotify_scope", v) : localStorage.removeItem("spotify_scope"); },
  get verifier() { return localStorage.getItem("pkce_verifier"); },
  set verifier(v) { v ? localStorage.setItem("pkce_verifier", v) : localStorage.removeItem("pkce_verifier"); }
};

FMQ.app = {
  playlists: [], players: [], trackMap: new Map(), usedTrackIds: new Set(), globalDeck: [],
  config: {
    category: "self",
    mode: "quick3",
    party: "rotate",
    endType: "rounds",
    targetPoints: 15,
    targetRounds: 5,
    ratingScoring: "classic",
    rankingSize: 5
  },
  state: {
    round: 1, turnIndex: 0, currentTrack: null, currentSourcePlayerId: null, isPlaying: false, playTimer: null,
    rankingList: { size: 5, lists: {}, answers: {} },
    introPlaylistGuess: { answers: {}, responderIndex: 0 },
    quick3: { clipSeconds: 3, randomStartMs: null, answers: {} },
    playStartModes: {},
    pauseApplyMode: "next",
    social: null,
    finalRound: { pending: false, roundNumber: null },
    selfCheckPending: false,
    setupStep: 1
  }
};

FMQ.activePlayers = () => FMQ.app.players.filter(p => p.active !== false);
FMQ.currentPlayer = () => {
  const cur = FMQ.app.players[FMQ.app.state.turnIndex];
  if (cur && cur.active !== false) return cur;
  return FMQ.activePlayers()[0] || FMQ.app.players[0] || null;
};
FMQ.getPlayerName = (id) => FMQ.app.players.find(p => p.id === id)?.name || "Unbekannt";
FMQ.advanceTurn = () => {
  const players = FMQ.app.players;
  const active = FMQ.activePlayers();
  if (!active.length || !players.length) return;
  const startIndex = Math.max(0, Math.min(players.length - 1, FMQ.app.state.turnIndex || 0));
  for (let step = 1; step <= players.length; step++) {
    const idx = (startIndex + step) % players.length;
    if (players[idx]?.active !== false) {
      FMQ.app.state.turnIndex = idx;
      if (idx <= startIndex) FMQ.app.state.round++;
      return;
    }
  }
};

FMQ.renderModeConfig = () => {
  const mode = FMQ.$("modeSelect").value;
  const area = FMQ.$("modeConfigArea");
  area.style.display = "";
  if (mode === "ratingGuess") {
    area.innerHTML = `<div class="config-block"><label><b>Punktelogik</b></label><select id="ratingScoringSelect"><option value="classic">Klassisch (3/2/1/0)</option><option value="light">Light (2/1/0)</option></select></div><div class="muted">Party-Option: Reihum (übersichtlicher für Anfänger).</div>`;
  } else if (mode === "rankingList") {
    area.innerHTML = `<div class="config-block"><label><b>Ranking-Größe</b></label><select id="rankingSizeSetupSelect"><option value="5">Top 5</option><option value="10">Top 10</option></select></div><div class="muted">Wird vor Spielstart festgelegt und bleibt bis Spielende unverändert.</div>`;
  } else {
    area.innerHTML = `<div class="muted">Party-Option: Reihum (übersichtlicher für Anfänger).</div>`;
  }
  const partySelect = FMQ.$("partySelect");
  if (partySelect) {
    partySelect.value = FMQ.app.config.party;
    partySelect.onchange = () => FMQ.app.config.party = partySelect.value;
  }
  if (FMQ.$("ratingScoringSelect")) {
    FMQ.$("ratingScoringSelect").value = FMQ.app.config.ratingScoring || "classic";
    FMQ.$("ratingScoringSelect").onchange = () => FMQ.app.config.ratingScoring = FMQ.$("ratingScoringSelect").value;
  }
  if (FMQ.$("rankingSizeSetupSelect")) {
    FMQ.$("rankingSizeSetupSelect").value = String(FMQ.app.config.rankingSize || 5);
    FMQ.$("rankingSizeSetupSelect").onchange = () => FMQ.app.config.rankingSize = parseInt(FMQ.$("rankingSizeSetupSelect").value, 10);
  }
};

FMQ.renderModeHints = () => {
  const mode = FMQ.$("modeSelect").value;
  FMQ.$("modeHint").textContent = FMQ.MODE_INFO[mode]?.hint || "";
  FMQ.renderModeConfig();
};

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
  const ok = !!FMQ.storage.token && FMQ.app.players.length >= 1 && FMQ.app.players.every(p => p.name && p.playlistId && (p.tracks?.length || 0) >= 5 && p.spanMin && p.spanMax);
  if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
  return ok;
};

FMQ.getEndTargetText = () => FMQ.app.config.endType === "points"
  ? `${FMQ.app.config.targetPoints} Punkte`
  : `${FMQ.app.config.targetRounds} Runden`;

FMQ.getWinnerByScore = () => [...FMQ.app.players].sort((a, b) => b.score - a.score)[0] || null;

FMQ.buildPlayersConfig = () => {
  const n = Math.max(1, Math.min(15, parseInt(FMQ.$("playerCountInput").value || "1", 10)));
  FMQ.$("playerCountInput").value = String(n);

  const old = FMQ.app.players;
  FMQ.app.players = [];
  const wrap = document.createElement("div");
  wrap.className = "player-grid";

  for (let i = 0; i < n; i++) {
    const prev = old[i] || {};
    const p = { id: crypto.randomUUID(), name: prev.name || (i === 0 ? "Spieler 1" : `Spieler ${i + 1}`), playlistId: prev.playlistId || "", playlistName: prev.playlistName || "", tracks: prev.tracks || [], spanMin: prev.spanMin || null, spanMax: prev.spanMax || null, score: 0, active: prev.active !== false, pendingActive: typeof prev.pendingActive === "boolean" ? prev.pendingActive : undefined };
    FMQ.app.players.push(p);
    const row = document.createElement("div");
    row.className = "player-card";
    const statusHtml = (p.tracks?.length || 0) >= 5
      ? `<span class="ok">✅ ${p.tracks.length} Tracks</span> <span class="muted">(Spanne ${p.spanMin ?? "?"}–${p.spanMax ?? "?"})</span>`
      : "noch nicht geladen";
    row.innerHTML = `<div class="player-card-head"><span class="pill">Spieler ${i + 1}</span><button data-role="clear-name" data-pid="${p.id}" class="clearNameBtn" type="button" aria-label="Name leeren">✕</button></div><label>Name<input data-role="name" data-pid="${p.id}" value="${FMQ.escapeHtml(p.name)}"></label><label>Playlist<select data-role="playlist" data-pid="${p.id}" class="playerPlaylistSelect"><option value="">(Playlist wählen…)</option></select></label><span class="player-status muted" data-role="status" data-pid="${p.id}">${statusHtml}</span>`;
    wrap.appendChild(row);
  }

  FMQ.$("playersConfig").innerHTML = "";
  FMQ.$("playersConfig").appendChild(wrap);

  FMQ.$("playersConfig").querySelectorAll('input[data-role="name"]').forEach(inp => inp.addEventListener("input", () => {
    const p = FMQ.app.players.find(x => x.id === inp.dataset.pid);
    if (p) p.name = inp.value.trim() || "Spieler";
    FMQ.checkReadyToStart();
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

  FMQ.refreshPlaylistDropdowns();
  FMQ.$("playersConfig").querySelectorAll('select[data-role="playlist"]').forEach(sel => sel.addEventListener("change", async () => {
    const p = FMQ.app.players.find(x => x.id === sel.dataset.pid);
    if (!p) return;

    p.playlistId = sel.value;
    p.playlistName = FMQ.app.playlists.find(x => x.id === sel.value)?.name || "";
    const statusEl = FMQ.$("playersConfig").querySelector(`span[data-role="status"][data-pid="${sel.dataset.pid}"]`);

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
};

FMQ.refreshConnStatus = () => {
  FMQ.$("connStatus").innerHTML = FMQ.storage.token ? `<span class="ok">✅</span>` : `<span class="bad">❌</span>`;
  if (FMQ.storage.token && typeof FMQ.validateSpotifySession === "function") {
    FMQ.validateSpotifySession().then(valid => {
      if (!valid) {
        FMQ.storage.token = null;
        FMQ.$("connStatus").innerHTML = `<span class="bad">❌</span>`;
        if (FMQ.$("playlistStatus")) FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
      }
    }).catch(() => {});
  }
  FMQ.checkReadyToStart();
  if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
};

FMQ.resetSession = () => {
  FMQ.app.usedTrackIds = new Set();
  FMQ.app.globalDeck = FMQ.shuffle([...FMQ.app.trackMap.keys()]);
  FMQ.app.state.round = 1;
  FMQ.app.state.turnIndex = 0;
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.isPlaying = false;
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.app.state.rankingList = { size: 5, lists: {}, answers: {} };
  FMQ.app.state.introPlaylistGuess = { answers: {}, responderIndex: 0 };
  FMQ.app.state.quick3 = { clipSeconds: 3, randomStartMs: null, answers: {} };
  FMQ.app.state.social = null;
  FMQ.app.state.socialPlayback = null;
  FMQ.app.state.modeStartMs = {};
  FMQ.app.state.playStartModes = {};
  FMQ.app.state.pauseApplyMode = FMQ.app.state.pauseApplyMode || "next";
  FMQ.app.players.forEach(p => { p.pendingActive = undefined; });
  FMQ.app.state.finalRound = { pending: false, roundNumber: null };
  FMQ.app.state.selfCheckPending = false;

  FMQ.app.players.forEach(p => {
    p.score = 0;
  });
};

FMQ.drawFromDeck = (deck) => {
  while (deck.length) {
    const id = deck.pop();
    if (!id || FMQ.app.usedTrackIds.has(id)) continue;
    FMQ.app.usedTrackIds.add(id);
    return FMQ.app.trackMap.get(id) || null;
  }
  return null;
};

FMQ.drawTrackForCurrentTurn = ({ risk = null, forceFromAny = false } = {}) => {
  const me = FMQ.currentPlayer();
  const active = FMQ.activePlayers();
  if (!me || !active.length) return null;
  const drawFromPlayer = (p) => {
    const deck = FMQ.shuffle((p.tracks || []).map(t => t.id).filter(id => id && !FMQ.app.usedTrackIds.has(id)));
    while (deck.length) {
      const id = deck.pop();
      FMQ.app.usedTrackIds.add(id);
      const track = FMQ.app.trackMap.get(id);
      if (track) return { track, sourcePlayerId: p.id };
    }
    return null;
  };

  if (forceFromAny) {
    const activeIds = new Set(active.map(p => p.id));
    const candidateIds = [...FMQ.app.trackMap.entries()]
      .filter(([, t]) => (t.owners || []).some(id => activeIds.has(id)))
      .map(([id]) => id)
      .filter(id => !FMQ.app.usedTrackIds.has(id));
    const track = FMQ.drawFromDeck(FMQ.shuffle(candidateIds));
    if (!track) return null;
    const owners = (track.owners || []).filter(id => activeIds.has(id));
    return { track, sourcePlayerId: owners[Math.floor(Math.random() * owners.length)] || me.id };
  }

  if (risk === "wagnis" && active.length >= 2) {
    const src = FMQ.shuffle(active.filter(p => p.id !== me.id))[0];
    const res = src && drawFromPlayer(src);
    if (res) return res;
  }

  return drawFromPlayer(me) || FMQ.drawTrackForCurrentTurn({ forceFromAny: true });
};

FMQ.awardPoints = (pid, delta) => {
  const p = FMQ.app.players.find(x => x.id === pid);
  if (p) p.score += delta;
};

FMQ.renderScoreTable = () => {
  FMQ.$("scoreTable").innerHTML = FMQ.app.players
    .map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${FMQ.app.config.endType === "points" ? `${p.score} / ${FMQ.app.config.targetPoints}` : `${p.score} Punkte`}</div><div class="span">Spanne: ${p.spanMin && p.spanMax ? `${p.spanMin}–${p.spanMax}` : "–"}</div></div>`)
    .join("");
};

FMQ.renderHeader = () => {
  const me = FMQ.currentPlayer();
  if (!me) return;
  FMQ.$("gameModeLabel").textContent = FMQ.modes[FMQ.app.config.mode]?.label || FMQ.app.config.mode;
  FMQ.$("gameModeSub").textContent = FMQ.app.config.party === "allguess" ? "Alle raten" : "Reihum";
  FMQ.$("roundLabel").textContent = `Runde ${FMQ.app.state.round}`;
  FMQ.$("turnPlayerName").textContent = me.name;
  FMQ.$("turnInfo").textContent = `Spanne: ${(me.spanMin && me.spanMax) ? `${me.spanMin}–${me.spanMax}` : "?"}`;
  FMQ.$("globalUsedLabel").textContent = String(FMQ.app.usedTrackIds.size);
};


window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: core.js enthält Shared-State, Helpers und Setup-Basislogik.

// =========================================================
// APP-METADATEN / MODUS-KATALOG
// =========================================================
FMQ.MODE_INFO = {
  quick3: { label: "Songausschnitt raten", category: "self", hint: "Ausschnitt oder ganzer Song raten" },
  speedGuess: { label: "Zeitdruck", category: "self", hint: "Schnell reagieren, Punkte sinken mit Zeit" },
  yearRange: { label: "Zeitraum/Jahr raten", category: "self", hint: "Jahr per Multiple Choice einordnen" },
  ratingGuess: { label: "Song-Bewertung einschätzen", category: "social", hint: "Wie schätzen andere den Geschmack ein?" },
  knowledgeGuess: { label: "Was weiß ich wirklich?", category: "social", hint: "Wissens-Selbstbild vs. Fremdeinschätzung" },
  bestFit: { label: "Song A oder B", category: "social", hint: "Welcher Song passt besser zur Hauptperson?" }
};
FMQ.isSocialMode = (modeId) => ["ratingGuess", "knowledgeGuess", "bestFit"].includes(modeId);

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
  get scope() { return localStorage.getItem("spotify_scope") || ""; },
  set scope(v) { v ? localStorage.setItem("spotify_scope", v) : localStorage.removeItem("spotify_scope"); },
  get verifier() { return localStorage.getItem("pkce_verifier"); },
  set verifier(v) { v ? localStorage.setItem("pkce_verifier", v) : localStorage.removeItem("pkce_verifier"); }
};

FMQ.app = {
  playlists: [], players: [], trackMap: new Map(), usedTrackIds: new Set(), globalDeck: [],
  config: { category: "self", mode: "quick3", party: "rotate", targetPoints: 15, ratingScoring: "classic" },
  state: {
    round: 1, turnIndex: 0, currentTrack: null, currentSourcePlayerId: null, isPlaying: false, playTimer: null,
    yearRange: { step: null, points: 0, options: [], correctIdx: -1, picks: new Map() },
    playlistGuess: { picks: new Map() },
    quick3: { clipSeconds: 3, randomStartMs: null },
    social: null,
    finalRound: { pending: false, roundNumber: null },
    selfCheckPending: false,
    setupStep: 1
  }
};

FMQ.currentPlayer = () => FMQ.app.players[FMQ.app.state.turnIndex];
FMQ.getPlayerName = (id) => FMQ.app.players.find(p => p.id === id)?.name || "Unbekannt";
FMQ.advanceTurn = () => {
  FMQ.app.state.turnIndex++;
  if (FMQ.app.state.turnIndex >= FMQ.app.players.length) {
    FMQ.app.state.turnIndex = 0;
    FMQ.app.state.round++;
  }
};

FMQ.renderModeConfig = () => {
  const mode = FMQ.$("modeSelect").value;
  const area = FMQ.$("modeConfigArea");
  if (mode === "yearRange" || mode === "playlistGuess") {
    area.innerHTML = `<div class="row"><label><b>Party-Option</b></label><select id="partySelect"><option value="rotate">Reihum (jeder ist dran)</option><option value="allguess">Alle raten gleichzeitig</option></select><span class="muted">Dieser Modus unterstützt beide Varianten.</span></div>`;
  } else if (mode === "ratingGuess") {
    area.innerHTML = `<div class="row"><label><b>Punktelogik</b></label><select id="ratingScoringSelect"><option value="classic">Klassisch (3/2/1/0)</option><option value="light">Light (2/1/0)</option></select></div><div class="row"><label><b>Party-Option</b></label><select id="partySelect" disabled><option value="rotate">Reihum (jeder ist dran)</option></select></div>`;
  } else {
    area.innerHTML = `<div class="row"><label><b>Party-Option</b></label><select id="partySelect" disabled><option value="rotate">Reihum (jeder ist dran)</option></select><span class="muted">In diesem Modus immer Reihum (übersichtlicher für Anfänger).</span></div>`;
  }
  FMQ.$("partySelect").value = FMQ.app.config.party;
  FMQ.$("partySelect").onchange = () => FMQ.app.config.party = FMQ.$("partySelect").value;
  if (FMQ.$("ratingScoringSelect")) {
    FMQ.$("ratingScoringSelect").value = FMQ.app.config.ratingScoring || "classic";
    FMQ.$("ratingScoringSelect").onchange = () => FMQ.app.config.ratingScoring = FMQ.$("ratingScoringSelect").value;
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
    sel.innerHTML = ['<option value="">(Playlist wählen…)</option>', ...FMQ.app.playlists.map(pl => `<option value="${FMQ.escapeHtml(pl.id)}" ${pl.id === cur ? "selected" : ""}>${FMQ.escapeHtml(pl.name)} (${typeof pl.tracks?.total === "number" ? pl.tracks.total : "?"})</option>`)].join("");
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
  FMQ.$("startGameBtn").disabled = !ok;
  if (typeof FMQ.renderSetupWizard === "function") FMQ.renderSetupWizard();
};

FMQ.buildPlayersConfig = () => {
  const n = Math.max(1, Math.min(8, parseInt(FMQ.$("playerCountInput").value || "1", 10)));
  FMQ.$("playerCountInput").value = String(n);

  const old = FMQ.app.players;
  FMQ.app.players = [];
  const wrap = document.createElement("div");
  wrap.className = "box";
  wrap.style.boxShadow = "none";
  wrap.style.border = "1px dashed var(--line)";
  wrap.innerHTML = '<div class="muted" style="margin-bottom:8px;">Spieler: Name + Playlist wählen (Tracks laden automatisch).</div>';

  for (let i = 0; i < n; i++) {
    const prev = old[i] || {};
    const p = { id: crypto.randomUUID(), name: prev.name || (i === 0 ? "Spieler 1" : `Spieler ${i + 1}`), playlistId: prev.playlistId || "", playlistName: prev.playlistName || "", tracks: prev.tracks || [], spanMin: prev.spanMin || null, spanMax: prev.spanMax || null, score: 0 };
    FMQ.app.players.push(p);
    const row = document.createElement("div");
    row.className = "row";
    row.style.margin = "8px 0";
    row.innerHTML = `<span class="pill">#${i + 1}</span><input data-role="name" data-pid="${p.id}" value="${FMQ.escapeHtml(p.name)}" style="min-width:180px;"><select data-role="playlist" data-pid="${p.id}" style="min-width:320px;"><option value="">(Playlist wählen…)</option></select><span class="muted" data-role="status" data-pid="${p.id}">noch nicht geladen</span>`;
    wrap.appendChild(row);
  }

  FMQ.$("playersConfig").innerHTML = "";
  FMQ.$("playersConfig").appendChild(wrap);

  FMQ.$("playersConfig").querySelectorAll('input[data-role="name"]').forEach(inp => inp.addEventListener("input", () => {
    const p = FMQ.app.players.find(x => x.id === inp.dataset.pid);
    if (p) p.name = inp.value.trim() || "Spieler";
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
  FMQ.app.state.yearRange = { step: null, points: 0, options: [], correctIdx: -1, picks: new Map() };
  FMQ.app.state.playlistGuess = { picks: new Map() };
  FMQ.app.state.quick3 = { clipSeconds: 3, randomStartMs: null };
  FMQ.app.state.social = null;
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
    const track = FMQ.drawFromDeck(FMQ.app.globalDeck) || FMQ.drawFromDeck(FMQ.shuffle([...FMQ.app.trackMap.keys()].filter(id => !FMQ.app.usedTrackIds.has(id))));
    if (!track) return null;
    const owners = track.owners || [];
    return { track, sourcePlayerId: owners[Math.floor(Math.random() * owners.length)] || me.id };
  }

  if (risk === "wagnis" && FMQ.app.players.length >= 2) {
    const src = FMQ.shuffle(FMQ.app.players.filter(p => p.id !== me.id))[0];
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
    .map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${p.score} / ${FMQ.app.config.targetPoints}</div><div class="span">Spanne: ${p.spanMin && p.spanMax ? `${p.spanMin}–${p.spanMax}` : "–"}</div></div>`)
    .join("");
};

FMQ.renderHeader = () => {
  const me = FMQ.currentPlayer();
  FMQ.$("gameModeLabel").textContent = FMQ.modes[FMQ.app.config.mode]?.label || FMQ.app.config.mode;
  FMQ.$("gameModeSub").textContent = FMQ.app.config.party === "allguess" ? "Alle raten" : "Reihum";
  FMQ.$("roundLabel").textContent = `Runde ${FMQ.app.state.round}`;
  FMQ.$("turnPlayerName").textContent = me.name;
  FMQ.$("turnInfo").textContent = `Spanne: ${(me.spanMin && me.spanMax) ? `${me.spanMin}–${me.spanMax}` : "?"}`;
  FMQ.$("globalUsedLabel").textContent = String(FMQ.app.usedTrackIds.size);
};

FMQ.showRangeOverlay = (show) => FMQ.$("rangeOverlay").classList.toggle("show", !!show);

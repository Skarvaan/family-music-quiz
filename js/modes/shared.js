window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: modes.js enthält nur modus-spezifische Render- und Spielregeln.

// Equalizer-Balken. Das wiederkehrende Motiv der Oberfläche: es zeigt
// überall dort Bewegung, wo gerade etwas läuft oder erwartet wird.
FMQ.eqBarsHtml = (balken = 5) =>
  `<span class="eqBars" aria-hidden="true">${"<span></span>".repeat(balken)}</span>`;

FMQ.renderModeLikeQuick3 = ({ heading, subtitle, bodyHtml, panelClass = "", heroName = undefined }) => {
  const me = FMQ.currentPlayer();
  const hero = heroName === undefined ? (me?.name || "") : (heroName || "");
  FMQ.$("modeArea").innerHTML = `
    <div class="quick3Hero">
      <div class="name">${FMQ.escapeHtml(hero)}</div>
      <div class="sub muted">${FMQ.escapeHtml(subtitle || "")}</div>
    </div>
    <div class="quick3Stage">
      <div class="quick3Panel ${panelClass}">
        <span class="eqStrip" aria-hidden="true"></span>
        <h3>${FMQ.escapeHtml(heading)}</h3>
        ${bodyHtml || ""}
      </div>
    </div>
  `;
  if (typeof FMQ.applyAccessibilityLabels === "function") FMQ.applyAccessibilityLabels();
  if (FMQ.isMultiDevice?.() && FMQ.$("screenGame")?.classList.contains("active")) {
    setTimeout(() => FMQ.$("modeArea")?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }
  FMQ.refreshPhoneControls?.();
};


// =========================================================
// PROMPT-ZIEHUNG
// ---------------------------------------------------------
// Vorher: FMQ.shuffle(list)[0] bei jedem Aufruf. Ergebnis war,
// dass derselbe Prompt am selben Abend mehrfach kam und über
// mehrere Runden hinweg dieselben Motive auftauchten.
// Jetzt: ein Beutel pro Pool, ohne Zurücklegen, plus ein
// Kurzzeitgedächtnis über localStorage, damit auch der nächste
// Spieleabend nicht mit denselben Fragen startet.
// =========================================================
FMQ.promptBag = {
  bags: {},
  lastTheme: {},
  MEMORY_SIZE: 45,

  allPrompts(type) {
    const data = window.FMQ_SONG_PROMPTS || {};
    return (type === "duel" ? data.duelPrompts : data.storyPrompts) || [];
  },

  allowedTones() {
    const setting = FMQ.app?.config?.promptTone || "mixed";
    if (setting === "family") return new Set(["family"]);
    if (setting === "all") return new Set(["family", "deep", "spicy"]);
    return new Set(["family", "deep"]);
  },

  pool(type) {
    const tones = this.allowedTones();
    const filtered = this.allPrompts(type).filter(p => tones.has(p.tone || "family"));
    return filtered.length ? filtered : this.allPrompts(type);
  },

  memory(type) {
    try { return JSON.parse(localStorage.getItem(`fmq_prompt_memory_${type}`) || "[]"); }
    catch { return []; }
  },

  remember(type, id) {
    try {
      const list = this.memory(type).filter(x => x !== id);
      list.push(id);
      localStorage.setItem(`fmq_prompt_memory_${type}`, JSON.stringify(list.slice(-this.MEMORY_SIZE)));
    } catch {}
  },

  refill(type) {
    const pool = this.pool(type);
    const recent = new Set(this.memory(type));
    // Erst alles nehmen, was länger nicht dran war.
    let fresh = pool.filter(p => !recent.has(p.id));
    if (fresh.length < 4) fresh = pool;
    this.bags[type] = FMQ.shuffle(fresh);
  },

  /** Zieht Prompts und vermeidet, dass zwei gleiche Themen aufeinanderfolgen. */
  draw(type = "shared", count = 1) {
    const key = type === "duel" ? "duel" : "shared";
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!this.bags[key]?.length) this.refill(key);
      const bag = this.bags[key] || [];
      if (!bag.length) break;
      let index = bag.findIndex(p => p.theme !== this.lastTheme[key]);
      if (index < 0) index = 0;
      const [prompt] = bag.splice(index, 1);
      this.lastTheme[key] = prompt.theme;
      this.remember(key, prompt.id);
      out.push(prompt);
    }
    if (!out.length) out.push({ id: "fallback", text: "Wähle einen Song, der dazu passt.", theme: "alltag", tone: "family" });
    return out;
  },

  reset() { this.bags = {}; this.lastTheme = {}; }
};

FMQ.canPlayerActNow = (playerId) => {
  const p = FMQ.app.players.find(x => x.id === playerId);
  if (!p || p.active === false) return false;
  return !(FMQ.app.state.pauseApplyMode === "next" && p.pendingActive === false);
};

FMQ.actingPlayers = () => FMQ.activePlayers().filter(p => FMQ.canPlayerActNow(p.id));

FMQ.initSocialRound = ({ modeId, startPhase = "othersGuessing" }) => {
  const mainPlayerId = FMQ.app.state.currentSourcePlayerId || FMQ.currentPlayer().id;
  const activePlayers = FMQ.actingPlayers();
  FMQ.app.state.social = {
    modeId,
    phase: startPhase,
    mainPlayerId,
    respondingPlayersQueue: activePlayers.filter(p => p.id !== mainPlayerId).map(p => p.id),
    currentResponderIndex: 0,
    answers: new Map(),
    answersByPlayer: {},
    votes: {},
    mainAnswers: {},
    mainAnswer: null
  };
};
FMQ.getSocialResponderId = () => {
  const s = FMQ.app.state.social;
  if (!s) return null;
  while (s.respondingPlayersQueue[s.currentResponderIndex] && !FMQ.canPlayerActNow(s.respondingPlayersQueue[s.currentResponderIndex])) {
    s.currentResponderIndex++;
  }
  return s.respondingPlayersQueue[s.currentResponderIndex] || null;
};

FMQ.submitAnswerToSession = (session, playerId, answer) => {
  if (!session.answersByPlayer) session.answersByPlayer = {};
  session.answersByPlayer[playerId] = answer;
  if (session.answers?.set) session.answers.set(playerId, answer);
};
FMQ.submitVoteToSession = (session, playerId, vote) => {
  if (!session.votes) session.votes = {};
  session.votes[playerId] = vote;
  FMQ.submitAnswerToSession(session, playerId, vote);
};
FMQ.submitMainAnswerToSession = (session, playerId, answer) => {
  if (!session.mainAnswers) session.mainAnswers = {};
  session.mainAnswers[playerId] = answer;
  session.mainAnswer = answer;
};



FMQ.getPlaybackPlayerId = () => {
  const s = FMQ.app.state.social;
  if (s) {
    if (s.phase === "listen" || s.phase === "mainAnswer") return s.mainPlayerId || FMQ.currentPlayer()?.id || "default";
    return FMQ.getSocialResponderId() || s.mainPlayerId || FMQ.currentPlayer()?.id || "default";
  }
  return FMQ.currentPlayer()?.id || "default";
};

FMQ.getPlayerStartMode = (fallback = "start") => {
  const playerId = FMQ.getPlaybackPlayerId();
  FMQ.app.state.playStartModes = FMQ.app.state.playStartModes || {};
  return FMQ.app.state.playStartModes[playerId] || fallback;
};

FMQ.setPlayerStartMode = (mode) => {
  const playerId = FMQ.getPlaybackPlayerId();
  FMQ.app.state.playStartModes = FMQ.app.state.playStartModes || {};
  FMQ.app.state.playStartModes[playerId] = mode === "random" ? "random" : "start";
};

FMQ.bindPlayerStartModeSelect = (id, fallback = "start") => {
  const el = FMQ.$(id);
  if (!el) return;
  el.value = FMQ.getPlayerStartMode(fallback);
  el.onchange = () => FMQ.setPlayerStartMode(el.value);
};

FMQ.getBoundStartMode = (id, fallback = "start") => {
  const mode = FMQ.$(id)?.value || FMQ.getPlayerStartMode(fallback);
  FMQ.setPlayerStartMode(mode);
  return mode;
};

FMQ.getStoredStartMs = (track, key, mode = "start") => {
  if (mode !== "random") return 0;
  FMQ.app.state.modeStartMs = FMQ.app.state.modeStartMs || {};
  const storeKey = `${key}:${track.id}`;
  if (typeof FMQ.app.state.modeStartMs[storeKey] === "number") return FMQ.app.state.modeStartMs[storeKey];
  const dur = track.durationMs || 180000;
  const min = Math.floor(dur * 0.25);
  const max = Math.max(min, Math.floor(dur * 0.7));
  const start = max <= min ? Math.floor(dur / 2) : Math.floor(min + Math.random() * (max - min));
  FMQ.app.state.modeStartMs[storeKey] = start;
  return start;
};

FMQ.socialPlaybackStart = async (uri, { fromStart = false, key = "default" } = {}) => {
  if (!FMQ.app.state.socialPlayback) FMQ.app.state.socialPlayback = {};
  if (!FMQ.app.state.socialPlayback[key]) FMQ.app.state.socialPlayback[key] = { uri, posMs: 0, startedAt: null, basePosMs: 0 };
  const pb = FMQ.app.state.socialPlayback[key];
  if (fromStart || pb.uri !== uri) pb.posMs = 0;
  pb.uri = uri;
  pb.basePosMs = pb.posMs || 0;
  pb.startedAt = Date.now();
  await FMQ.playTrackUri(uri, { positionMs: pb.basePosMs });
  FMQ.app.state.isPlaying = true;
};

FMQ.socialPlaybackPause = async ({ key = "default" } = {}) => {
  const pb = FMQ.app.state.socialPlayback?.[key];
  if (pb?.startedAt) {
    pb.posMs = Math.max(0, pb.basePosMs + (Date.now() - pb.startedAt));
    pb.startedAt = null;
  }
  await FMQ.pausePlayback();
  FMQ.app.state.isPlaying = false;
};

// =========================================================
// MODUS-DEFINITIONEN
// =========================================================

// Die einzelnen Modi registrieren sich in js/modes/*.js jeweils selbst.
FMQ.modes = FMQ.modes || {};

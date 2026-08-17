window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: core.js enthält Shared-State, Helpers und Setup-Basislogik.

// =========================================================
// APP-METADATEN / MODUS-KATALOG
// =========================================================

/* Gemeinsame Grundlagen: Konstanten, kleine Helfer, Zustandsobjekt. */

FMQ.MODE_INFO = {
  quick3: { label: "Songausschnitt raten", category: "self", hint: "Ausschnitt oder ganzer Song raten" },
  rankingList: { label: "Ranking Liste", category: "self", hint: "Baue dein Top-5- oder Top-10-Ranking Song für Song" },
  ratingGuess: { label: "Song-Bewertung einschätzen", category: "social", hint: "Wie schätzen andere den Geschmack ein?" },
  bestFit: { label: "Song A oder B", category: "social", hint: "Welcher Song passt besser zur ausgewählten Person?" },
  introPlaylistGuess: { label: "Aus welcher Playlist ist das?", category: "intro", hint: "Alle raten nacheinander, aus welcher Playlist der Song stammt" },
  introFirst3: { label: "Meine ersten 3 Songs", category: "intro", hint: "Die vorbereiteten ersten 3 Songs jeder Playlist locker anhören" },
  storyPrompt: { label: "Song-Geschichten", category: "challenge", hint: "Wählt Songs aus, die etwas über euch erzählen. Kein Voting, keine Punkte." },
  promptDuel: { label: "Song-Duell", category: "challenge", hint: "Zwei Songs treten gegeneinander an. Welcher passt besser zum Prompt?" }
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

FMQ.trackIdentityKey = (track) => `${track.normalizedTitle || FMQ.normalizeTitle(track.name)}::${track.normalizedArtist || FMQ.normalizeArtist(track.artists || track.artistName)}`;

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
  get expiresAt() { return parseInt(localStorage.getItem("spotify_expires_at") || "0", 10) || 0; },
  set expiresAt(v) { v ? localStorage.setItem("spotify_expires_at", String(v)) : localStorage.removeItem("spotify_expires_at"); },
  get verifier() { return localStorage.getItem("pkce_verifier"); },
  set verifier(v) { v ? localStorage.setItem("pkce_verifier", v) : localStorage.removeItem("pkce_verifier"); }
};

FMQ.app = {
  playlists: [], players: [], trackMap: new Map(), usedTrackIds: new Set(), usedTrackKeys: new Set(), globalDeck: [],
  config: {
    category: "self",
    mode: "quick3",
    party: "rotate",
    endType: "rounds",
    targetPoints: 15,
    targetRounds: 5,
    ratingScoring: "classic",
    rankingSize: 5,
    songChallengeType: "storyPrompt",
    // Welche Prompts dürfen kommen: "family" | "mixed" | "all"
    promptTone: "mixed"
  },
  state: {
    round: 1, turnIndex: 0, currentTrack: null, currentSourcePlayerId: null, isPlaying: false, playTimer: null,
    rankingList: { size: 5, lists: {}, answers: {} },
    introPlaylistGuess: { answers: {}, responderIndex: 0 },
    quick3: { clipSeconds: 3, randomStartMs: null, answers: {} },
    playStartModes: {},
    deviceMode: "single",
    pauseApplyMode: "next",
    social: null,
    finalRound: { pending: false, roundNumber: null },
    selfCheckPending: false,
    songChallenge: null,
    setupStep: 1
  }
};

FMQ.resetSession = () => {
  FMQ.app.globalDeck = FMQ.shuffle([...FMQ.app.trackMap.keys()]);
  FMQ.app.state.round = 1;
  FMQ.app.state.turnIndex = 0;
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.isPlaying = false;
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.app.state.rankingList = { size: FMQ.app.config.rankingSize || 5, lists: {}, answers: {} };
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
  FMQ.app.state.songChallenge = null;

  FMQ.app.players.forEach(p => {
    p.score = 0;
  });
};

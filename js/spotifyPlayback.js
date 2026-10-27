window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: spotifyPlayback.js steuert die Wiedergabe per Spotify Connect
// (Play, Pause, welches Gerät). Anmeldung und Playlists: spotify.js.

// =========================================================
// PLAYER-DEVICE / PLAYBACK
// =========================================================
// Welches Gerät spielt die Musik? Vor JEDEM Abspielen wird die
// Geräteliste frisch bei Spotify geholt (wie in der Originalversion).
// Reihenfolge:
//   1. Das Gerät, das du auf dem Startbildschirm unter
//      "Abspielgerät" ausdrücklich gewählt hast, falls es gerade da ist.
//   2. Sonst das Gerät, das Spotify als "aktiv" meldet (dort, wo du
//      zuletzt selbst etwas gestartet hast).
//   3. Sonst das Gerät, auf dem das Spiel zuletzt gespielt hat.
//   4. Sonst das erste Gerät der Liste.
//
// Warum nicht mehr merken (Fehler aus Update 2/3):
// Ein gemerktes Gerät war oft nicht mehr das, auf dem du gerade Musik
// gestartet hattest. Spotify übergibt die Wiedergabe dann an das
// gemerkte Gerät, und auf deinem Gerät sieht es aus, als würde Spotify
// "stoppen statt spielen". Der eine zusätzliche Aufruf kostet etwas
// Zeit, ist aber eindeutig.
//
// Gemerkt wird das zuletzt benutzte Gerät nur noch für "Pause", damit
// Stopp schnell geht und genau dort ankommt, wo gerade Musik läuft.
FMQ.lastPlaybackDevice = { id: null, name: "" };

/** Ausdrücklich gewähltes Abspielgerät (bleibt im Browser gespeichert). */
FMQ.getPreferredDeviceId = () => { try { return localStorage.getItem("fmq_device_id") || ""; } catch { return ""; } };
FMQ.setPreferredDeviceId = (id) => {
  try { id ? localStorage.setItem("fmq_device_id", id) : localStorage.removeItem("fmq_device_id"); } catch {}
};

/** Geräteliste von Spotify (für Auswahl und Wiedergabe). */
FMQ.listSpotifyDevices = async () => {
  const data = await FMQ.apiFetch("https://api.spotify.com/v1/me/player/devices");
  return (data && data.devices) || [];
};

/** Wählt das Abspielgerät nach den Regeln oben. Liefert {id, name} oder null. */
FMQ.pickPlaybackDevice = async () => {
  // Geräte mit is_restricted=true nehmen laut Spotify KEINE Befehle
  // von außen an (z. B. manche Fernseher, Autos, Geräte im Sparmodus).
  // Ein Befehl dorthin würde ins Leere gehen.
  const devices = (await FMQ.listSpotifyDevices()).filter(d => !d.is_restricted);
  const preferred = FMQ.getPreferredDeviceId();
  const device = devices.find(d => d.id === preferred)
    || devices.find(d => d.is_active)
    || devices.find(d => d.id === FMQ.lastPlaybackDevice.id)
    || devices[0]
    || null;
  return device ? { id: device.id, name: device.name || "Spotify-Gerät" } : null;
};

/** Für alte Aufrufer: liefert nur die ID. */
FMQ.getActiveDeviceId = async () => (await FMQ.pickPlaybackDevice())?.id || null;

/** Zeigt unter dem Spiel an, wo die Musik gerade läuft. */
FMQ.showPlaybackDevice = (name) => {
  ["playbackDeviceGame", "playbackDeviceStart"].forEach(id => {
    const el = FMQ.$(id);
    if (el) el.textContent = name ? `🔊 Musik läuft auf: ${name}` : "";
  });
};

/**
 * Spotify-Fehler in Klartext. Vorher landeten Fehler nur im
 * zugeklappten Debug-Feld, auf dem Bildschirm passierte einfach nichts.
 */
FMQ.explainSpotifyError = (e) => {
  const msg = String(e?.message || e || "");
  if (/\(401\)/.test(msg)) return "Spotify-Anmeldung abgelaufen. Bitte auf dem Startbildschirm neu verbinden.";
  if (/\(403\)/.test(msg)) return "Spotify lehnt ab (403). Häufigste Gründe: Konto ohne Premium, oder das Konto ist im Spotify Developer Dashboard nicht als Nutzer der App eingetragen.";
  if (/\(404\)/.test(msg)) return "Spotify findet kein Abspielgerät. Spotify-App auf dem Abspielgerät öffnen, kurz einen Song anspielen, dann nochmal.";
  if (/\(429\)/.test(msg)) return "Zu viele Anfragen an Spotify. Ein paar Sekunden warten.";
  if (/Timeout/i.test(msg)) return "Spotify antwortet nicht. Internet prüfen und nochmal.";
  if (/Kein Spotify-Gerät/.test(msg)) return msg;
  return "Spotify-Fehler: " + msg;
};

/** Zeigt einen Wiedergabe-Fehler gut sichtbar an (Spielbildschirm + Startbildschirm). */
FMQ.showSpotifyAlert = (text) => {
  ["spotifyAlertGame", "spotifyAlertStart"].forEach(id => {
    const el = FMQ.$(id);
    if (!el) return;
    el.textContent = text ? "⚠️ " + text : "";
    el.hidden = !text;
  });
};

/*
 * WIE GESPIELT WIRD (umgestellt am 25.10.2026 nach "Spotify testen"):
 *
 * Bei Benes Konto lehnt Spotify "spiel diesen einzelnen Song"
 * ({ uris: [song] }) ab: Der Befehl wird angenommen, die Wiedergabe
 * bricht aber sofort ab. "Spiel diese Playlist ab genau diesem Song"
 * ({ context_uri: playlist, offset: { uri: song } }) funktioniert.
 * Darum startet das Spiel jeden Song jetzt über seine Playlist.
 * Ist zu einem Song keine Playlist bekannt, wird der alte Weg genutzt.
 *
 * Nebenwirkung: Über eine Playlist gestartet, spielt Spotify nach dem
 * Songende einfach den NÄCHSTEN Playlist-Song weiter. Das würde Songs
 * verraten. Die Ende-Sicherung (armEndGuard) hält deshalb kurz vor
 * Songende an.
 */

/** Findet Playlist und Länge zu einem Song (aus den geladenen Spielern). */
FMQ.findTrackContext = (uri) => {
  const id = String(uri || "").split(":").pop();
  const fromMap = FMQ.app.trackMap?.get?.(id);
  let track = fromMap || null;
  let playlistId = fromMap?.playlistId || null;
  if (!playlistId) {
    // Songs können über mehrere Wege kommen (z. B. vom Handy zurück).
    // Notfalls in allen Spieler-Playlists suchen.
    for (const p of FMQ.app.players || []) {
      const hit = (p.tracks || []).find(t => t.id === id || t.uri === uri);
      if (hit) { track = track || hit; playlistId = hit.playlistId || p.playlistId || null; if (playlistId) break; }
    }
  }
  if (!playlistId && fromMap?.owners?.length) {
    playlistId = (FMQ.app.players || []).find(p => fromMap.owners.includes(p.id))?.playlistId || null;
  }
  return { playlistId, durationMs: track?.durationMs || null };
};

/** Baut den Play-Befehl: über die Playlist, sonst als Einzelsong. */
FMQ.buildPlayBody = (uri, positionMs) => {
  const { playlistId } = FMQ.findTrackContext(uri);
  const body = playlistId
    ? { context_uri: `spotify:playlist:${playlistId}`, offset: { uri } }
    : { uris: [uri] };
  if (typeof positionMs === "number") body.position_ms = Math.max(0, Math.floor(positionMs));
  return body;
};

/*
 * Ende-Sicherung: hält an, kurz bevor der Song zu Ende ist, damit
 * Spotify nicht in den nächsten Playlist-Song weiterläuft.
 * Kurz vor dem geplanten Zeitpunkt wird bei Spotify nachgefragt, wo
 * der Song wirklich steht (Startverzögerung!), und der Zeitpunkt
 * notfalls nachgestellt. Jede neue Wiedergabe und jedes Stop entwertet
 * eine alte Sicherung (endGuardGen).
 */
FMQ.armEndGuard = (uri, positionMs, durationMs) => {
  clearTimeout(FMQ.endGuardTimer);
  const gen = FMQ.endGuardGen = (FMQ.endGuardGen || 0) + 1;
  if (!durationMs) return;
  const wantId = String(uri).split(":").pop();
  const MARGIN = 1200; // so viele ms vor Songende anhalten
  const schedule = (ms) => {
    FMQ.endGuardTimer = setTimeout(async () => {
      if (FMQ.endGuardGen !== gen) return;
      let st = null;
      try { st = await FMQ.apiFetch("https://api.spotify.com/v1/me/player", { timeoutMs: 4000 }); } catch {}
      if (FMQ.endGuardGen !== gen) return;
      if (!st || !st.is_playing) return; // läuft nicht (mehr): nichts zu tun
      const sameSong = FMQ.isOurPlayback(st, uri);
      if (!sameSong) {
        // Schon in den nächsten Song gerutscht: sofort anhalten.
        try { await FMQ.pausePlayback(); } catch {}
        return;
      }
      const left = durationMs - (Number(st.progress_ms) || 0);
      if (left > MARGIN + 600) { schedule(left - MARGIN); return; } // noch zu früh
      try { await FMQ.pausePlayback(); } catch {}
    }, Math.max(500, ms));
  };
  schedule(durationMs - (positionMs || 0) - MARGIN);
};

/** Stop/Neustart: Ende-Sicherung entwerten. */
FMQ.disarmEndGuard = () => {
  clearTimeout(FMQ.endGuardTimer);
  FMQ.endGuardGen = (FMQ.endGuardGen || 0) + 1;
};

/**
 * Zentraler Schalter "Musik läuft / läuft nicht". Steuert die
 * Markierung des Abspielen-Knopfs auf dem Handy. Früher blieb der
 * zuletzt getippte Knopf grün, auch wenn längst nichts mehr lief.
 */
FMQ.setPlayingState = (on) => {
  FMQ.app.state.isPlaying = !!on;
  if (!on) FMQ.app.state.playingControlId = null;
  FMQ.refreshPhoneControls?.();
};

FMQ.playTrackUri = async (uri, { positionMs = null } = {}) => {
  const body = FMQ.buildPlayBody(uri, positionMs);
  const send = id => FMQ.apiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(id)}`, { method: "PUT", jsonBody: body });
  try {
    let device = await FMQ.pickPlaybackDevice();
    if (!device) throw new Error("Kein Spotify-Gerät gefunden. Spotify-App auf dem Abspielgerät öffnen, kurz irgendeinen Song starten, dann nochmal.");
    try {
      await send(device.id);
    } catch (e) {
      // Nur bei "Gerät nicht gefunden" einmal neu suchen. Andere Fehler
      // (z. B. 403) würden sich bei Wiederholung nur verdoppeln.
      if (!/\((404|502)\)/.test(e.message)) throw e;
      device = await FMQ.pickPlaybackDevice();
      if (!device) throw e;
      await send(device.id);
    }
    FMQ.lastPlaybackDevice = device;
    FMQ.showPlaybackDevice(device.name);
    FMQ.showSpotifyAlert("");
    FMQ.app.state.playingControlId = FMQ.app.state.pendingPlayControlId || null;
    FMQ.app.state.pendingPlayControlId = null;
    FMQ.setPlayingState(true);
    // Nur nötig, wenn über die Playlist gespielt wird (läuft sonst weiter).
    if (body.context_uri) FMQ.armEndGuard(uri, body.position_ms || 0, FMQ.findTrackContext(uri).durationMs);
    else FMQ.disarmEndGuard();
  } catch (e) {
    FMQ.showSpotifyAlert(FMQ.explainSpotifyError(e));
    throw e;
  }
};

FMQ.pausePlayback = async () => {
  FMQ.disarmEndGuard();
  FMQ.setPlayingState(false);
  // Pause geht an das Gerät, auf dem das Spiel zuletzt gestartet hat.
  // Ist schon pausiert, antwortet Spotify mit 403 ("Restriction
  // violated"). Das ist harmlos und wird NICHT wiederholt: eine
  // verspätete zweite Pause könnte sonst einen gerade neu gestarteten
  // Song abwürgen.
  const id = FMQ.lastPlaybackDevice.id || await FMQ.getActiveDeviceId();
  if (!id) return;
  await FMQ.apiFetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(id)}`, { method: "PUT" });
};

/**
 * Auswahl "Abspielgerät" auf dem Startbildschirm füllen.
 * Zeigt alle Geräte, die Spotify gerade kennt. Ein Gerät taucht nur
 * auf, wenn dort die Spotify-App offen ist (kurz einen Song anspielen
 * hilft, dann "Geräte suchen" tippen).
 */
FMQ.refreshDevicePicker = async () => {
  const sel = FMQ.$("deviceSelect");
  const status = FMQ.$("deviceStatus");
  if (!sel) return;
  if (!FMQ.storage.token && !FMQ.storage.refreshToken) { if (status) status.textContent = "Erst Spotify verbinden."; return; }
  if (status) status.textContent = "Suche Geräte …";
  try {
    const devices = await FMQ.listSpotifyDevices();
    const preferred = FMQ.getPreferredDeviceId();
    sel.innerHTML = ['<option value="">Automatisch (aktives Gerät)</option>', ...devices.map(d =>
      `<option value="${FMQ.escapeHtml(d.id)}" ${d.id === preferred ? "selected" : ""}>${FMQ.escapeHtml(d.name)} · ${FMQ.escapeHtml(d.type || "")}${d.is_active ? " (aktiv)" : ""}</option>`)].join("");
    const missing = preferred && !devices.some(d => d.id === preferred);
    if (status) status.textContent = !devices.length
      ? "Kein Gerät gefunden. Spotify-App auf dem Abspielgerät öffnen und kurz einen Song anspielen."
      : missing
        ? "Das gewählte Gerät ist gerade nicht da (Spotify-App dort schläft). Bis es auftaucht, spielt das aktive Gerät."
        : `${devices.length} Gerät${devices.length === 1 ? "" : "e"} gefunden`;
  } catch (e) {
    if (status) status.textContent = FMQ.explainSpotifyError(e);
  }
};

// =========================================================
// CLIPS: erst messen, wenn der Song WIRKLICH läuft
// =========================================================
// Problem vorher: Nach dem Play-Befehl startete sofort eine Stoppuhr
// (z. B. 3 Sekunden), danach kam "Pause". Spotify bestätigt den
// Befehl aber, bevor der Ton läuft. Auf einem anderen Gerät per
// Spotify Connect (Galaxy, Fernseher) oder bei Gerätewechsel dauert
// der echte Start oft 2-5 Sekunden. Dann kam die Pause, bevor
// überhaupt etwas zu hören war: "Spotify stoppt statt zu spielen".
//
// Jetzt: Wir fragen Spotify alle 300 ms, ob DIESER Song läuft und an
// welcher Stelle. Erst dann startet die Stoppuhr, und zwar mit der
// Zeit, die noch vom Ausschnitt übrig ist.

/** Kurz warten (für die Abfrage-Schleife). */
const fmqSleep = ms => new Promise(r => setTimeout(r, ms));

/** Spotify-ID aus "spotify:track:abc" holen. */
const fmqTrackIdFromUri = uri => String(uri || "").split(":").pop();

/**
 * Wartet, bis Spotify meldet, dass uri läuft.
 * Liefert { progressMs, at } oder null, wenn es nach timeoutMs nicht klappt.
 * isStale(): true, wenn inzwischen etwas anderes gestartet/gestoppt wurde.
 */
/**
 * Ist das, was Spotify meldet, "unser" Song?
 * Fehler vorher (27.10.): Verglichen wurde nur die Song-Kennung. Über
 * eine Playlist gestartet, meldet Spotify manchmal eine ANDERE Kennung
 * für denselben Titel (Spotify tauscht Titel je nach Land gegen eine
 * andere Ausgabe aus). Dann wartete die Stoppuhr 9 s vergeblich, der
 * Ausschnitt wurde 12-19 s lang, und es kam die falsche Warnung
 * "Spotify meldet nicht, dass der Song läuft".
 * Jetzt zählt: gleiche Kennung ODER gleicher (bereinigter) Titel.
 */
FMQ.isOurPlayback = (st, uri) => {
  const item = st && st.item;
  if (!item) return false;
  const wantId = fmqTrackIdFromUri(uri);
  if (item.uri === uri || item.id === wantId) return true;
  const t = FMQ.app.trackMap?.get?.(wantId)
    || (FMQ.app.players || []).flatMap(p => p.tracks || []).find(x => x.id === wantId);
  if (!t) return false;
  return FMQ.normalizeTitle(item.name) === (t.normalizedTitle || FMQ.normalizeTitle(t.name));
};

/**
 * Wartet, bis Spotify meldet, dass uri läuft.
 * Liefert { progressMs, at } sobald es läuft, sonst nach timeoutMs
 * { timedOut: true, anythingPlaying } (läuft überhaupt etwas?).
 */
FMQ.waitForPlaybackStart = async (uri, { timeoutMs = 15000, isStale = () => false } = {}) => {
  const until = Date.now() + timeoutMs;
  let anythingPlaying = false;
  while (Date.now() < until) {
    if (isStale()) return null;
    try {
      const st = await FMQ.apiFetch("https://api.spotify.com/v1/me/player", { timeoutMs: 4000 });
      if (st && st.is_playing) anythingPlaying = true;
      if (st && st.is_playing && FMQ.isOurPlayback(st, uri)) {
        return { progressMs: Number(st.progress_ms) || 0, at: Date.now() };
      }
    } catch { /* einzelne Abfrage fehlgeschlagen: weiter versuchen */ }
    await fmqSleep(300);
  }
  return { timedOut: true, anythingPlaying };
};

/**
 * Stoppuhr für einen Ausschnitt. Ersetzt das alte
 * "setTimeout(pause, sekunden)" direkt nach dem Play-Befehl.
 *
 * @param {string} uri        der gerade gestartete Song
 * @param {number} startMs    ab welcher Stelle er gestartet wurde
 * @param {number|"full"} seconds  Ausschnittlänge, "full" = keine Stoppuhr
 * @param {Function} [onPaused]    wird nach der automatischen Pause gerufen
 */
FMQ.startClipTimer = (uri, startMs, seconds, onPaused) => {
  const state = FMQ.app.state;
  clearTimeout(state.playTimer);
  state.playTimer = null;
  // Jede neue Wiedergabe und jedes Stop erhöht die Nummer. Eine
  // ältere, noch wartende Stoppuhr merkt das und tut dann nichts.
  const gen = state.clipGen = (state.clipGen || 0) + 1;
  if (seconds === "full" || !Number(seconds)) return;
  const clipMs = Number(seconds) * 1000;

  (async () => {
    const started = await FMQ.waitForPlaybackStart(uri, { isStale: () => state.clipGen !== gen });
    if (!started || state.clipGen !== gen) return;
    let remaining = clipMs;
    if (!started.timedOut) {
      // Schon gespielte Zeit abziehen (Abfrage-Verzögerung eingerechnet).
      const playedMs = Math.max(0, started.progressMs - (startMs || 0)) + (Date.now() - started.at);
      remaining = Math.max(300, clipMs - playedMs);
    } else if (!started.anythingPlaying) {
      // Nur warnen, wenn wirklich GAR NICHTS läuft.
      FMQ.showSpotifyAlert?.("Der Song startet nicht. Läuft die Spotify-App auf dem Abspielgerät? Sonst unter „Abspielgerät“ prüfen.");
    }
    state.playTimer = setTimeout(async () => {
      if (state.clipGen !== gen) return;
      try { await FMQ.pausePlayback(); } catch {}
      state.isPlaying = false;
      if (onPaused) onPaused();
    }, remaining);
  })();
};

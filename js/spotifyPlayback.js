window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: spotifyPlayback.js steuert die Wiedergabe per Spotify Connect
// (Play, Pause, welches Gerät). Anmeldung und Playlists: spotify.js.

// =========================================================
// PLAYER-DEVICE / PLAYBACK
// =========================================================
// Welches Gerät spielt die Musik?
//   1. Das Gerät, das du auf dem Startbildschirm unter
//      "Abspielgerät" gewählt hast (z. B. Galaxy S22), falls es
//      gerade in der Spotify-Liste auftaucht.
//   2. Sonst das Gerät, das Spotify als "aktiv" meldet.
//   3. Sonst das erste Gerät der Liste.
//
// Das gefundene Gerät wird 60 Sekunden gemerkt, damit nicht jeder
// Play-/Stop-Befehl zwei Spotify-Aufrufe braucht.
// WICHTIG (Fehler aus Update 2 behoben): Schlägt ein Befehl an das
// gemerkte Gerät fehl, egal mit welchem Fehler, wird die Geräteliste
// frisch geholt und der Befehl EINMAL wiederholt. Vorher passierte
// das nur bei Fehler 404. Wer zwischendurch das Gerät gewechselt
// hat (iPad-App zu, S22 an), blieb dadurch bis zu 2 Minuten ohne
// Musik hängen, auch im Ein-Gerät-Modus.
FMQ.spotifyDeviceCache = { id: null, at: 0 };
FMQ.DEVICE_CACHE_MS = 60 * 1000;

/** Gewähltes Abspielgerät (bleibt im Browser gespeichert). */
FMQ.getPreferredDeviceId = () => { try { return localStorage.getItem("fmq_device_id") || ""; } catch { return ""; } };
FMQ.setPreferredDeviceId = (id) => {
  try { id ? localStorage.setItem("fmq_device_id", id) : localStorage.removeItem("fmq_device_id"); } catch {}
  FMQ.spotifyDeviceCache = { id: null, at: 0 }; // sofort neu wählen
};

/** Geräteliste von Spotify (für Auswahl und Wiedergabe). */
FMQ.listSpotifyDevices = async () => {
  const data = await FMQ.apiFetch("https://api.spotify.com/v1/me/player/devices");
  return (data && data.devices) || [];
};

FMQ.getActiveDeviceId = async ({ fresh = false } = {}) => {
  const cache = FMQ.spotifyDeviceCache;
  if (!fresh && cache.id && Date.now() - cache.at < FMQ.DEVICE_CACHE_MS) return cache.id;
  const devices = await FMQ.listSpotifyDevices();
  const preferred = FMQ.getPreferredDeviceId();
  const id = devices.find(d => d.id === preferred)?.id
    || devices.find(d => d.is_active)?.id
    || devices[0]?.id
    || null;
  FMQ.spotifyDeviceCache = { id, at: Date.now() };
  return id;
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

/** Befehl an das gemerkte Gerät; klappt das nicht, frisch suchen und einmal wiederholen. */
FMQ.withSpotifyDevice = async (run) => {
  let deviceId = await FMQ.getActiveDeviceId();
  if (!deviceId) return { noDevice: true };
  try {
    await run(deviceId);
  } catch (firstError) {
    // Abgelaufene Anmeldung ist kein Geräteproblem, nicht wiederholen.
    if (/\(401\)/.test(firstError.message)) throw firstError;
    deviceId = await FMQ.getActiveDeviceId({ fresh: true });
    if (!deviceId) return { noDevice: true };
    await run(deviceId);
  }
  return { ok: true };
};

FMQ.playTrackUri = async (uri, { positionMs = null } = {}) => {
  const body = { uris: [uri] };
  if (typeof positionMs === "number") body.position_ms = Math.max(0, positionMs);
  try {
    const res = await FMQ.withSpotifyDevice(deviceId =>
      FMQ.apiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", jsonBody: body }));
    if (res.noDevice) throw new Error("Kein Spotify-Gerät gefunden. Spotify-App auf dem Abspielgerät öffnen, kurz irgendeinen Song starten, dann nochmal.");
    FMQ.showSpotifyAlert("");
  } catch (e) {
    FMQ.showSpotifyAlert(FMQ.explainSpotifyError(e));
    throw e;
  }
};

FMQ.pausePlayback = async () => {
  // Pause-Fehler nicht groß anzeigen: Ist nichts am Laufen, meldet
  // Spotify manchmal einen Fehler, obwohl alles in Ordnung ist.
  await FMQ.withSpotifyDevice(deviceId =>
    FMQ.apiFetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" }));
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
    if (status) status.textContent = devices.length
      ? `${devices.length} Gerät${devices.length === 1 ? "" : "e"} gefunden`
      : "Kein Gerät gefunden. Spotify-App auf dem Abspielgerät öffnen und kurz einen Song anspielen.";
  } catch (e) {
    if (status) status.textContent = FMQ.explainSpotifyError(e);
  }
};

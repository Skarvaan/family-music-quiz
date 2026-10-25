window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: spotify.js kapselt Auth, Token und Spotify API/Playback.

// =========================================================
// AUTH / PKCE
// =========================================================

FMQ.randomVerifier = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

FMQ.sha256Base64Url = async (verifier) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

/**
 * Spotify erlaubt als Rückleitungsadresse nur https oder die
 * Loopback-IP 127.0.0.1 (seit April 2025, "localhost" ist verboten).
 * Öffnet jemand die Seite über eine WLAN-Adresse wie
 * http://192.168.178.20:3000, lehnt Spotify den Login ab.
 * Lieber vorher klar sagen, was los ist.
 */
FMQ.canUseSpotifyLoginHere = () => {
  const host = window.location.hostname;
  const loopback = host === "127.0.0.1" || host === "[::1]" || host === "::1";
  return window.location.protocol === "https:" || loopback;
};

FMQ.loginSpotify = async () => {
  if (!FMQ.canUseSpotifyLoginHere()) {
    FMQ.$("playlistStatus").textContent = "Spotify-Login geht hier nicht: Spotify verlangt https (z. B. GitHub Pages) oder am Laptop http://127.0.0.1:3000. Über eine WLAN-Adresse wie 192.168… lehnt Spotify ab.";
    return;
  }
  const verifier = FMQ.randomVerifier();
  FMQ.storage.verifier = verifier;
  const challenge = await FMQ.sha256Base64Url(verifier);
  window.location = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
    response_type: "code",
    client_id: FMQ.SPOTIFY_CLIENT_ID,
    scope: FMQ.SPOTIFY_SCOPES,
    redirect_uri: FMQ.REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    show_dialog: "true"
  });
};

FMQ.logoutSpotify = () => {
  FMQ.storage.token = null;
  FMQ.storage.refreshToken = null;
  FMQ.storage.expiresAt = null;
  FMQ.storage.scope = null;
  FMQ.storage.verifier = null;
  FMQ.refreshConnStatus();
};

FMQ.handleOAuthCallbackIfPresent = async () => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
    return;
  }
  if (!code) return;

  if (!FMQ.storage.verifier) {
    FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
    return;
  }

  const body = new URLSearchParams({
    client_id: FMQ.SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: FMQ.REDIRECT_URI,
    code_verifier: FMQ.storage.verifier
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (!data.access_token) {
    FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
    return;
  }

  FMQ.storage.token = data.access_token;
  FMQ.storage.refreshToken = data.refresh_token || FMQ.storage.refreshToken || null;
  FMQ.storage.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  FMQ.storage.scope = data.scope || "";
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
  FMQ.refreshConnStatus();

  try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; }
};

FMQ.refreshAccessToken = async () => {
  if (!FMQ.storage.refreshToken) throw new Error("Kein Refresh-Token vorhanden.");
  const body = new URLSearchParams({
    client_id: FMQ.SPOTIFY_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: FMQ.storage.refreshToken
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data?.error_description || "Token-Refresh fehlgeschlagen.");
  FMQ.storage.token = data.access_token;
  FMQ.storage.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000;
  if (data.refresh_token) FMQ.storage.refreshToken = data.refresh_token;
};

FMQ.ensureSpotifyAccessToken = async () => {
  if (FMQ.storage.refreshToken && (!FMQ.storage.token || (FMQ.storage.expiresAt && Date.now() > FMQ.storage.expiresAt - 30000))) {
    await FMQ.refreshAccessToken();
  }
  if (!FMQ.storage.token) throw new Error("Kein Token (bitte verbinden).");
  return FMQ.storage.token;
};

// Protokoll der letzten Spotify-Aufrufe (für "Spotify testen" und die
// Fehlersuche). Nur Methode, Pfad, Status und Fehlertext, keine Tokens.
FMQ.spotifyLog = [];
FMQ.logSpotifyCall = (method, url, status, info) => {
  const path = String(url).replace("https://api.spotify.com/v1", "").split("&fields=")[0];
  FMQ.spotifyLog.push(`${new Date().toLocaleTimeString()} ${method} ${path} → ${status}${info ? " · " + info : ""}`);
  if (FMQ.spotifyLog.length > 40) FMQ.spotifyLog.shift();
};

FMQ.apiFetch = async (url, { method = "GET", jsonBody = null, timeoutMs = 12000, _retry = false } = {}) => {
  await FMQ.ensureSpotifyAccessToken();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${FMQ.storage.token}`,
        ...(jsonBody ? { "Content-Type": "application/json" } : {})
      },
      body: jsonBody ? JSON.stringify(jsonBody) : null,
      signal: ctrl.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    FMQ.logSpotifyCall(method, url, res.status, res.ok ? "" : (data?.error?.message || data?.error?.reason || ""));
    if (res.status === 401 && !_retry && FMQ.storage.refreshToken) {
      FMQ.storage.token = null;
      FMQ.storage.expiresAt = null;
      await FMQ.refreshAccessToken();
      FMQ.setSpotifyConnectionStatus?.("connected");
      return FMQ.apiFetch(url, { method, jsonBody, timeoutMs, _retry: true });
    }
    if (!res.ok) throw new Error(`Spotify API (${res.status}): ${data?.error?.message || data?.error_description || text || `HTTP ${res.status}`}`);
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Timeout: Spotify antwortet nicht.");
    throw e;
  } finally {
    clearTimeout(t);
  }
};

// Wiedergabe und Geräteauswahl stehen in js/spotifyPlayback.js.

// =========================================================
// PLAYLISTS / TRACK-LADEN
// =========================================================
/*
 * Seit Februar/März 2026 (Spotify "Development Mode"-Umstellung)
 * liefert Spotify die Songs einer Playlist NUR noch, wenn der
 * eingeloggte Host sie selbst besitzt oder an ihr mitarbeitet.
 * Eine Playlist, der man nur folgt (z. B. die von Oma), lässt
 * sich zwar anzeigen, aber nicht mehr auslesen.
 *
 * Darum:
 * - alle Seiten von /me/playlists laden (früher nur die ersten 50)
 * - jede Playlist markieren: fmqReadable = eigene oder gemeinsame
 * - fremde Playlists im Auswahlmenü sichtbar, aber gesperrt
 */
FMQ.loadMyPlaylists = async () => {
  if (!FMQ.storage.token) {
    FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
    return;
  }
  FMQ.$("playlistStatus").textContent = "Lade Playlists…";
  const fail = () => {
    FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!";
    throw new Error("Bitte neu verbinden!");
  };

  // Eigene Spotify-ID, um "meine" von "fremden" Playlists zu trennen.
  // Schlägt das fehl, lieber alles freigeben als alles sperren.
  const me = await FMQ.apiFetch("https://api.spotify.com/v1/me", { timeoutMs: 8000 }).catch(() => null);
  const myId = me?.id || null;

  const all = [];
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  // Höchstens 10 Seiten (500 Playlists), damit nichts endlos läuft.
  for (let page = 0; url && page < 10; page++) {
    const data = await FMQ.apiFetch(url).catch(fail);
    all.push(...(data?.items || []).filter(Boolean));
    url = data?.next || null;
  }

  all.forEach(pl => {
    pl.fmqReadable = !myId || pl.owner?.id === myId || pl.collaborative === true;
    // Feld hieß früher tracks.total, seit 2026 items.total.
    pl.fmqTotal = typeof pl.items?.total === "number" ? pl.items.total
      : typeof pl.tracks?.total === "number" ? pl.tracks.total : null;
  });
  // Nutzbare Playlists zuerst, innerhalb davon Reihenfolge wie bei Spotify.
  FMQ.app.playlists = [...all.filter(pl => pl.fmqReadable), ...all.filter(pl => !pl.fmqReadable)];

  const locked = all.filter(pl => !pl.fmqReadable).length;
  FMQ.$("playlistStatus").textContent = locked
    ? `${all.length - locked} Playlists nutzbar · ${locked} fremde gesperrt (Spotify gibt seit 2026 nur eigene oder gemeinsame Playlists frei)`
    : `${all.length} Playlists geladen`;
  FMQ.refreshPlaylistDropdowns();
};

FMQ.loadAllTracksForPlaylist = async (playlistId) => {
  const tracks = [];
  const skipped = []; // als nicht abspielbar gemeldete Titel
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const data = await FMQ.apiFetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100&offset=${offset}&market=from_token&fields=total,items(item(type,id,uri,name,duration_ms,is_playable,is_local,artists(name),album(release_date)))`,
      { timeoutMs: 15000 }
    ).catch(e => {
      // 403/404 heißt seit 2026 fast immer: fremde Playlist.
      if (/\((403|404)\)/.test(e.message)) {
        throw new Error("Spotify gibt diese Playlist nicht frei. Es gehen nur eigene oder gemeinsame Playlists. Tipp: Playlist in den eigenen Account kopieren oder als gemeinsame Playlist anlegen.");
      }
      throw e;
    });
    total = data.total ?? 0;
    const items = data.items || [];

    for (const it of items) {
      // Seit 2026 steht der Song unter "item". "track" ist dort jetzt
      // nur noch true/false. Ältere Antworten: Song unter "track".
      const t = (it?.item && typeof it.item === "object") ? it.item
        : (it?.track && typeof it.track === "object") ? it.track : null;
      const y = FMQ.yearFromReleaseDate(t?.album?.release_date);
      if (!t || t.type !== "track" || !y || !t.uri) continue;
      // Nicht abspielbare Titel aussortieren: in Deutschland gesperrt
      // (is_playable=false) oder lokale Dateien vom eigenen Rechner.
      // Schickt man so einen Titel an Spotify, bricht die Wiedergabe
      // einfach ab, ohne Fehlermeldung.
      const unplayable = t.is_local || t.is_playable === false;
      (unplayable ? skipped : tracks).push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: (t.artists || []).map(a => a.name),
        year: y,
        durationMs: typeof t.duration_ms === "number" ? t.duration_ms : null,
        isLocal: !!t.is_local, // lokale Dateien kann Spotify Connect nie abspielen
        normalizedTitle: FMQ.normalizeTitle(t.name),
        normalizedArtist: FMQ.normalizeArtist((t.artists || []).map(a => a.name))
      });
    }

    offset += 100;
    if (!items.length) break;
  }

  // Sicherheitsnetz: Meldet Spotify ALLE Titel als nicht abspielbar,
  // ist eher die Angabe falsch als die Playlist. Dann lieber behalten
  // (der Knopf "Spotify testen" zeigt, ob sie wirklich laufen).
  const usable = tracks.length ? tracks : skipped.filter(t => !t.isLocal);
  FMQ.app.skippedUnplayable = tracks.length ? skipped.length : 0;
  return [...new Map(usable.map(t => [t.id, t])).values()];
};

FMQ.validateSpotifySession = async () => {
  if (!FMQ.storage.token && !FMQ.storage.refreshToken) return false;
  try {
    await FMQ.ensureSpotifyAccessToken();
    await FMQ.apiFetch("https://api.spotify.com/v1/me", { timeoutMs: 5000 });
    return true;
  } catch {
    FMQ.storage.token = null;
    FMQ.storage.expiresAt = null;
    return false;
  }
};

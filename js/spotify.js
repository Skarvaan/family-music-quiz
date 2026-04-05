window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: spotify.js kapselt Auth, Token und Spotify API/Playback.

FMQ.randomVerifier = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

FMQ.sha256Base64Url = async (verifier) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

FMQ.loginSpotify = async () => {
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
  FMQ.storage.scope = null;
  FMQ.storage.verifier = null;
  FMQ.refreshConnStatus();
};

FMQ.handleOAuthCallbackIfPresent = async () => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    FMQ.setDebug("OAuth Fehler: " + err);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
    return;
  }
  if (!code) return;

  if (!FMQ.storage.verifier) {
    FMQ.setDebug("Fehler: PKCE verifier fehlt. Bitte nochmal Login drücken.");
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
    FMQ.setDebug("Token Fehler:\n" + JSON.stringify(data, null, 2));
    return;
  }

  FMQ.storage.token = data.access_token;
  FMQ.storage.scope = data.scope || "";
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
  FMQ.refreshConnStatus();

  try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "❌ " + e.message; }
};

FMQ.apiFetch = async (url, { method = "GET", jsonBody = null, timeoutMs = 12000 } = {}) => {
  if (!FMQ.storage.token) throw new Error("Kein Token (bitte verbinden).");
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
    if (!res.ok) throw new Error(`Spotify API (${res.status}): ${data?.error?.message || data?.error_description || text || `HTTP ${res.status}`}`);
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Timeout: Spotify antwortet nicht.");
    throw e;
  } finally {
    clearTimeout(t);
  }
};

FMQ.getActiveDeviceId = async () => {
  const data = await FMQ.apiFetch("https://api.spotify.com/v1/me/player/devices");
  const devices = data.devices || [];
  return devices.find(d => d.is_active)?.id || devices[0]?.id || null;
};

FMQ.playTrackUri = async (uri, { positionMs = null } = {}) => {
  const deviceId = await FMQ.getActiveDeviceId();
  if (!deviceId) throw new Error("Kein Spotify-Gerät gefunden. Öffne Spotify (App/Webplayer) und starte kurz irgendeinen Song, dann erneut.");
  const body = { uris: [uri] };
  if (typeof positionMs === "number") body.position_ms = Math.max(0, positionMs);
  await FMQ.apiFetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", jsonBody: body });
};

FMQ.pausePlayback = async () => {
  const deviceId = await FMQ.getActiveDeviceId();
  if (!deviceId) return;
  await FMQ.apiFetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" });
};

FMQ.loadMyPlaylists = async () => {
  if (!FMQ.storage.token) {
    FMQ.$("playlistStatus").textContent = "❌ Bitte erst verbinden.";
    return;
  }
  FMQ.$("playlistStatus").textContent = "Lade Playlists…";
  const data = await FMQ.apiFetch("https://api.spotify.com/v1/me/playlists?limit=50");
  FMQ.app.playlists = data.items || [];
  FMQ.$("playlistStatus").textContent = `✅ ${FMQ.app.playlists.length} Playlists geladen`;
  FMQ.setDebug(JSON.stringify(FMQ.app.playlists.map(p => ({ name: p.name, id: p.id, total: p.tracks?.total })), null, 2));
  FMQ.refreshPlaylistDropdowns();
};

FMQ.loadAllTracksForPlaylist = async (playlistId) => {
  const tracks = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const data = await FMQ.apiFetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100&offset=${offset}&market=from_token&fields=total,items(item(type,id,uri,name,duration_ms,artists(name),album(release_date)))`,
      { timeoutMs: 15000 }
    );
    total = data.total ?? 0;
    const items = data.items || [];

    for (const it of items) {
      const t = it?.item;
      const y = FMQ.yearFromReleaseDate(t?.album?.release_date);
      if (!t || t.type !== "track" || !y) continue;
      tracks.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: (t.artists || []).map(a => a.name),
        year: y,
        durationMs: typeof t.duration_ms === "number" ? t.duration_ms : null
      });
    }

    offset += 100;
    if (!items.length) break;
  }

  return [...new Map(tracks.map(t => [t.id, t])).values()];
};

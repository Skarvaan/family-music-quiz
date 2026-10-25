window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: spotifyDiagnose.js ist der Knopf "Spotify testen" auf dem
// Startbildschirm. Er prüft Schritt für Schritt, woran es hakt, und
// schreibt alles im Klartext auf den Bildschirm. Ergebnis kann kopiert
// und weitergegeben werden. Es werden keine Zugangsdaten angezeigt.

/* Ablauf:
   1. Anmeldung und Berechtigungen (Scopes) prüfen
   2. Konto (/me)
   3. Geräte: welche gibt es, welches ist aktiv, welche sind gesperrt
   4. Was läuft gerade?
   5. Ein Song aus der geladenen Playlist: ist er abspielbar?
   6. Test A: den gerade pausierten Song per Spiel starten
   7. Test B: den Playlist-Song per Spiel starten ("spiel diesen Song")
   7c. Test C: denselben Song über die Playlist starten ("spiel diese
       Playlist ab genau diesem Song", context_uri + offset). Das ist der
       zweite offiziell dokumentierte Weg desselben Play-Befehls.
   8. Pause
   Vergleich A/B zeigt: Liegt es am Gerät/der Steuerung oder am Song? */

// outId: wohin das Ergebnis geschrieben wird. Startbildschirm:
// "spotifyDiagOut", im Spiel (Debug-Bereich): "spotifyDiagOutGame".
// Im Spiel sind die Playlist-Songs sicher geladen, dort läuft Test B.
FMQ.runSpotifyDiagnose = async (outId = "spotifyDiagOut") => {
  const out = FMQ.$(outId);
  const lines = [];
  const say = (text) => { lines.push(text); if (out) { out.hidden = false; out.textContent = lines.join("\n"); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const call = async (label, url, opts) => {
    try { return { ok: true, data: await FMQ.apiFetch(url, opts) }; }
    catch (e) { say(`   ✗ ${label}: ${e.message}`); return { ok: false, error: e }; }
  };
  const nowPlaying = async () => {
    const r = await call("Wiedergabestatus", "https://api.spotify.com/v1/me/player");
    const st = r.data;
    if (!r.ok) return null;
    if (!st) { say("   Spotify meldet: nichts aktiv (kein Gerät spielt oder ist pausiert)"); return null; }
    say(`   läuft: ${st.is_playing ? "JA" : "nein"} · Song: ${st.item?.name || "–"} · Gerät: ${st.device?.name || "–"}`);
    return st;
  };

  say(`Spotify-Test · ${new Date().toLocaleString()} · ${document.querySelector("[data-fmq-version]")?.dataset.fmqVersion || ""}`);

  // 1) Anmeldung
  const scopes = (FMQ.storage.scope || "").split(/\s+/).filter(Boolean);
  const needed = FMQ.SPOTIFY_SCOPES.split(" ");
  const missing = needed.filter(s => !scopes.includes(s));
  say(`1) Anmeldung: ${FMQ.storage.token ? "Token da" : "KEIN Token"} · Berechtigungen: ${scopes.join(", ") || "unbekannt"}`);
  if (missing.length && scopes.length) say(`   ✗ Es fehlen Berechtigungen: ${missing.join(", ")} → „Spotify verbinden“ neu ausführen.`);

  // 2) Konto
  const me = await call("Konto", "https://api.spotify.com/v1/me");
  if (me.ok) say(`2) Konto: ${me.data?.display_name || me.data?.id || "?"}`);

  // 3) Geräte
  const dev = await call("Geräte", "https://api.spotify.com/v1/me/player/devices");
  const devices = dev.data?.devices || [];
  say(`3) Geräte: ${devices.length || "keine"}`);
  devices.forEach(d => say(`   · ${d.name} (${d.type})${d.is_active ? " · AKTIV" : ""}${d.is_restricted ? " · GESPERRT für Fernsteuerung" : ""}`));
  const preferred = FMQ.getPreferredDeviceId();
  if (preferred) say(`   Fest gewählt: ${devices.find(d => d.id === preferred)?.name || "ein Gerät, das gerade NICHT da ist"}`);
  const target = await FMQ.pickPlaybackDevice().catch(() => null);
  say(`   Das Spiel würde spielen auf: ${target?.name || "KEINEM Gerät"}`);
  if (!target) { say("→ Ohne Gerät geht nichts. Spotify-App öffnen, kurz anspielen, Test wiederholen."); return; }

  // 4) Aktuell
  say("4) Gerade:");
  const before = await nowPlaying();

  // 5) Playlist-Song
  const track = (FMQ.app.players || []).flatMap(p => p.tracks || [])[0];
  if (!track) say("5) Kein Playlist-Song geladen (erst im Setup eine Playlist wählen). Test B entfällt.");
  else {
    say(`5) Playlist-Song: ${track.name} · ${track.uri}`);
    const info = await call("Song-Info", `https://api.spotify.com/v1/tracks/${encodeURIComponent(track.id)}?market=from_token`);
    if (info.ok) say(`   abspielbar: ${info.data?.is_playable === false ? "NEIN" : "ja"}${info.data?.restrictions?.reason ? " · Grund: " + info.data.restrictions.reason : ""}`);
  }
  if (FMQ.app.skippedUnplayable) say(`   (Beim Laden ${FMQ.app.skippedUnplayable} nicht abspielbare Titel aussortiert)`);

  // body: was an Spotify geht. Standard: { uris: [uri] } = "spiel diesen Song".
  const tryPlay = async (label, uri, body = { uris: [uri] }) => {
    say(`${label}: starte ${uri} auf ${target.name} …`);
    const r = await call("Play-Befehl", `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(target.id)}`, { method: "PUT", jsonBody: body });
    if (r.ok) say("   Spotify hat den Befehl angenommen.");
    await sleep(4000);
    const st = await nowPlaying();
    return !!(st && st.is_playing && st.item && (st.item.uri === uri || uri.endsWith(st.item.id)));
  };

  // 6) Test A
  const knownUri = before?.item?.uri || "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
  const okA = await tryPlay("6) Test A (bekannter Song)", knownUri);
  say(`   → Test A ${okA ? "OK" : "FEHLGESCHLAGEN"}`);

  // 7) Test B
  let okB = null;
  if (track) {
    okB = await tryPlay("7) Test B (Playlist-Song)", track.uri);
    say(`   → Test B ${okB ? "OK" : "FEHLGESCHLAGEN"}`);
  }

  // 7c) Test C: derselbe Song, aber über seine Playlist gestartet.
  //     context_uri = die Playlist, offset.uri = genau dieser Song darin.
  let okC = null;
  const owner = track ? (FMQ.app.players || []).find(p => (p.tracks || []).some(t => t.id === track.id)) : null;
  if (track && owner?.playlistId) {
    const contextUri = `spotify:playlist:${owner.playlistId}`;
    say(`   (Playlist: ${owner.playlistName || owner.playlistId})`);
    okC = await tryPlay("7c) Test C (über die Playlist)", track.uri, { context_uri: contextUri, offset: { uri: track.uri }, position_ms: 0 });
    say(`   → Test C ${okC ? "OK" : "FEHLGESCHLAGEN"}`);
  } else if (track) {
    say("7c) Test C entfällt: Zu diesem Song ist keine Playlist bekannt.");
  }

  // 8) Pause
  await call("Pause", `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(target.id)}`, { method: "PUT" });

  say("");
  // Test C eigene Aussage: Klappt C, B aber nicht, ist der Playlist-Weg die Lösung.
  if (okC === true && okB === false) say("HINWEIS: Über die Playlist klappt es (Test C), als Einzelsong nicht (Test B). Das Spiel kann auf diesen Weg umgestellt werden.");
  if (okC === false && okB === false) say("HINWEIS: Auch über die Playlist klappt es nicht (Test C). Abspielen per Fernsteuerung ist bei diesem Konto/Gerät derzeit blockiert.");
  say(okA && okB !== false ? "ERGEBNIS: Steuerung und Songs funktionieren."
    : !okA ? "ERGEBNIS: Spotify nimmt Befehle an, spielt auf diesem Gerät aber nicht ab. Liegt am Gerät/der App (Gerät wechseln oder App neu starten)."
    : "ERGEBNIS: Gerät funktioniert, aber der Playlist-Song nicht. Liegt am Song bzw. der Playlist.");
  say("");
  say("Letzte Spotify-Aufrufe:");
  FMQ.spotifyLog.slice(-25).forEach(l => say("  " + l));
};

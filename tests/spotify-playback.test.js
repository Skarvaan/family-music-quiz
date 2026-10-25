/* Wiedergabe-Weg echt im Browser, Spotify wird auf Netzwerkebene
   simuliert (Playwright fängt api.spotify.com ab).

   Hintergrund: Update 2 merkte sich das Abspielgerät. Wer danach das
   Gerät wechselte (iPad-App zu, Galaxy an), bekam keine Musik mehr,
   auch im Ein-Gerät-Modus, und sah keine Fehlermeldung.

   Geprüft wird:
   - Gerätewechsel: alter Befehl scheitert -> frisch suchen -> neues Gerät spielt
   - gewähltes Abspielgerät hat Vorrang vor "aktiv"
   - 403 wird als verständliche Meldung angezeigt
   - Ein-Gerät-Modus: Abspielen-Knopf startet echte Wiedergabe
   Braucht Playwright, sonst übersprungen. */

const path = require("path");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("Playwright fehlt, Test übersprungen."); process.exit(0); }

const PORT = 3950;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`); };

(async () => {
  const app = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await wait(1500);
  const browser = await chromium.launch();

  // Simulierter Spotify-Zustand
  const sim = {
    devices: [{ id: "ipad", name: "iPad", type: "Tablet", is_active: true }],
    played: [],          // Geräte-IDs, auf denen "play" geklappt hat
    failPlayWith: null,  // z. B. 403, um einen Fehler zu erzwingen
    startDelayMs: 0,     // so lange "puffert" das Gerät, bevor Ton kommt
    playing: null,       // { uri, startMs, soundAt } – was gerade läuft
    pauses: [],          // Zeitpunkte aller Pause-Befehle
    badUris: ["spotify:track:gesperrt"] // Spotify bricht bei diesen ab
  };

  try {
    const ctx = await browser.newContext();
    await ctx.route("https://api.spotify.com/**", async route => {
      const url = new URL(route.request().url());
      const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/v1/me/player/devices") return json(200, { devices: sim.devices });
      if (url.pathname === "/v1/me/player/play") {
        const id = url.searchParams.get("device_id");
        if (sim.failPlayWith) return json(sim.failPlayWith, { error: { status: sim.failPlayWith, message: "Simuliert" } });
        // Gerät nicht (mehr) in der Liste: Spotify antwortet mit einem Fehler,
        // absichtlich NICHT 404, sondern 502 / "Restriction violated" (403-ähnlich).
        if (!sim.devices.some(d => d.id === id)) return json(400, { error: { status: 400, message: "Device not available" } });
        const body = JSON.parse(route.request().postData() || "{}");
        // Wie echtes Spotify bei gesperrtem Titel: Befehl "klappt", Wiedergabe endet.
        sim.lastBody = body;
        // Song steht entweder in uris (Einzelsong) oder in offset.uri (über Playlist)
        const songUri = body.uris?.[0] || body.offset?.uri;
        if (sim.badUris.includes(songUri)) { sim.playing = null; return route.fulfill({ status: 204, body: "" }); }
        sim.played.push(id);
        sim.playing = { uri: songUri, startMs: body.position_ms || 0, soundAt: Date.now() + sim.startDelayMs, context: body.context_uri || null };
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname === "/v1/me/player/pause") {
        sim.pauses.push(Date.now());
        // Wie echtes Spotify: schon pausiert -> 403
        if (!sim.playing) return json(403, { error: { status: 403, message: "Player command failed: Restriction violated" } });
        sim.playing = null;
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname === "/v1/me/player") {
        const p = sim.playing;
        const sounding = p && Date.now() >= p.soundAt;
        // Wie echtes Spotify: über Playlist gestartet, läuft nach Songende
        // der NÄCHSTE Playlist-Song weiter.
        if (p && sounding && p.context && sim.trackLenMs && p.startMs + (Date.now() - p.soundAt) > sim.trackLenMs) {
          sim.rolledIntoNext = true;
          return json(200, { is_playing: true, progress_ms: 1000, item: { uri: "spotify:track:naechster", id: "naechster" } });
        }
        return json(200, { is_playing: !!sounding, progress_ms: sounding ? p.startMs + (Date.now() - p.soundAt) : (p?.startMs || 0), item: p ? { uri: p.uri, id: p.uri.split(":").pop() } : null });
      }
      if (url.pathname === "/v1/me") return json(200, { id: "bene" });
      if (url.pathname.startsWith("/v1/tracks/")) return json(200, { is_playable: !url.pathname.includes("gesperrt"), restrictions: url.pathname.includes("gesperrt") ? { reason: "market" } : undefined });
      if (/\/v1\/playlists\/.+\/items/.test(url.pathname)) return json(200, { total: 7, items: [
        ...Array.from({ length: 6 }, (_, k) => ({ track: true, item: { type: "track", id: "ok" + k, uri: "spotify:track:ok" + k, name: "Gut " + k, duration_ms: 200000, is_playable: true, artists: [{ name: "B" }], album: { release_date: "2001" } } })),
        { track: true, item: { type: "track", id: "gesperrt", uri: "spotify:track:gesperrt", name: "Gesperrt", duration_ms: 200000, is_playable: false, artists: [{ name: "B" }], album: { release_date: "2001" } } }
      ] });
      if (url.pathname === "/v1/me/playlists") return json(200, { items: [], next: null });
      return json(200, {});
    });

    const page = await ctx.newPage();
    page.on("pageerror", e => console.log("  [Seitenfehler]", e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.evaluate(() => { localStorage.setItem("spotify_access_token", "x"); localStorage.setItem("spotify_expires_at", String(Date.now() + 3600e3)); });

    // 1) Spielt auf dem iPad, Gerät wird gemerkt
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:a"));
    check("Erster Song spielt auf dem aktiven Gerät", sim.played.at(-1) === "ipad");

    // 2) Gerätewechsel: iPad-App zu, Galaxy an
    sim.devices = [{ id: "s22", name: "Galaxy S22", type: "Smartphone", is_active: true }];
    const err = await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:b").then(() => null, e => e.message));
    check("Nach Gerätewechsel spielt das neue Gerät (ohne 2 Min. Hängen)", !err && sim.played.at(-1) === "s22", err || sim.played.join(","));

    // 2b) Kernfehler aus Update 2/3: Spiel hat zuletzt auf dem Galaxy
    //     gespielt, du startest Musik am iPad (iPad = aktiv). Ohne feste
    //     Auswahl MUSS das iPad spielen. Vorher ging der Befehl ans
    //     gemerkte Galaxy und das iPad "stoppte statt zu spielen".
    sim.devices = [
      { id: "s22", name: "Galaxy S22", type: "Smartphone", is_active: false },
      { id: "ipad", name: "iPad", type: "Tablet", is_active: true }
    ];
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:b2"));
    check("Ohne feste Auswahl spielt das gerade aktive Gerät", sim.played.at(-1) === "ipad", sim.played.at(-1));
    check("Anzeige, wo die Musik läuft", /iPad/.test(await page.$eval("#playbackDeviceStart", el => el.textContent)));

    // 3) Gewähltes Gerät hat Vorrang
    sim.devices = [
      { id: "s22", name: "Galaxy S22", type: "Smartphone", is_active: false },
      { id: "tv", name: "Fernseher", type: "TV", is_active: true }
    ];
    await page.evaluate(() => window.FMQ.setPreferredDeviceId("s22"));
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:c"));
    check("Gewähltes Abspielgerät hat Vorrang", sim.played.at(-1) === "s22", sim.played.at(-1));

    // 4) Geräteauswahl auf dem Startbildschirm
    await page.click("#deviceRefreshBtn");
    await page.waitForFunction(() => document.querySelectorAll("#deviceSelect option").length === 3);
    check("Geräteauswahl listet die Spotify-Geräte", (await page.$eval("#deviceSelect", s => s.value)) === "s22");

    // 5) Fehler wird sichtbar erklärt
    sim.failPlayWith = 403;
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:d").catch(() => {}));
    const alertText = await page.$eval("#spotifyAlertStart", el => el.hidden ? "" : el.textContent);
    check("403 erscheint als verständliche Meldung", /Premium/.test(alertText), alertText.slice(0, 60));
    sim.failPlayWith = null;
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:e"));
    check("Meldung verschwindet, sobald es wieder klappt", await page.$eval("#spotifyAlertStart", el => el.hidden));

    // 6) Ein-Gerät-Modus komplett über die Knöpfe
    const before = sim.played.length;
    await page.evaluate(() => {
      const F = window.FMQ;
      F.app.players = ["Bene", "Anna"].map((name, i) => ({ id: "p" + i, name, playlistId: "pl" + i, playlistName: "L", tracks: Array.from({ length: 8 }, (_, k) => ({ id: `t${i}${k}`, uri: `spotify:track:t${i}${k}`, name: `Song ${k}`, artists: ["Band"], year: 2000 + k, durationMs: 200000 })), score: 0, active: true }));
      F.rebuildTrackUniverse();
      F.setDeviceMode("single");
      Object.assign(F.app.config, { category: "self", mode: "quick3", endType: "rounds", targetRounds: 2 });
      F.$("modeSelect").value = "quick3";
      F.startGame({ fromForm: false });
    });
    await page.click("#quick3PlayBtnInline");
    await page.waitForTimeout(800);
    check("Ein-Gerät-Modus: Abspielen startet echte Wiedergabe", sim.played.length === before + 1, sim.played.at(-1));

    // 7) Langsames Gerät: Ton kommt erst 4 s nach dem Befehl, Ausschnitt 3 s.
    //    Früher kam die Pause nach 3 s, also BEVOR etwas zu hören war.
    await page.evaluate(() => window.FMQ.stopPlaybackNow());
    sim.startDelayMs = 4000;
    sim.pauses = [];
    const t0 = Date.now();
    await page.click("#quick3PlayBtnInline");
    await page.waitForTimeout(9000);
    const firstPause = sim.pauses[0] ? sim.pauses[0] - t0 : null;
    check("Ausschnitt-Stoppuhr startet erst, wenn Ton läuft", firstPause !== null && firstPause >= 6500, firstPause === null ? "keine Pause" : `Pause nach ${firstPause} ms (Ton ab 4000 ms, Ausschnitt 3000 ms)`);
    sim.startDelayMs = 0;

    // 8) Pause auf schon pausiertem Gerät darf nicht nachträglich wiederholt werden
    sim.pauses = [];
    await page.evaluate(() => window.FMQ.pausePlayback().catch(() => {}));
    await page.waitForTimeout(1500);
    check("Pause bei schon pausiert: keine verspätete Zweit-Pause", sim.pauses.length === 1, `${sim.pauses.length} Pause-Befehle`);

    // 8b) Umstellung 25.10.: Songs mit bekannter Playlist laufen über die Playlist
    await page.evaluate(() => window.FMQ.stopPlaybackNow());
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:t00", { positionMs: 0 }));
    check("Song wird über seine Playlist gestartet (wie Test C)", sim.lastBody?.context_uri === "spotify:playlist:pl0" && sim.lastBody?.offset?.uri === "spotify:track:t00", JSON.stringify(sim.lastBody));

    // 8c) Ende-Sicherung: kurzer Song (6 s), ab Sekunde 2 -> muss vor Ende anhalten
    await page.evaluate(() => { window.FMQ.app.trackMap.get("t01").durationMs = 6000; });
    sim.trackLenMs = 6000; sim.rolledIntoNext = false; sim.pauses = [];
    const tEnd = Date.now();
    await page.evaluate(() => window.FMQ.playTrackUri("spotify:track:t01", { positionMs: 2000 }));
    await page.waitForTimeout(6500);
    const pauseAt = sim.pauses[0] ? sim.pauses[0] - tEnd : null;
    check("Ende-Sicherung hält vor Songende an", pauseAt !== null && pauseAt < 4200 && !sim.rolledIntoNext, pauseAt === null ? "keine Pause" : `Pause nach ${pauseAt} ms (Song endet nach 4000 ms)`);
    sim.trackLenMs = 0;

    // 9) Nicht abspielbare Titel werden beim Laden aussortiert
    const loaded = await page.evaluate(() => window.FMQ.loadAllTracksForPlaylist("pl").then(t => t.map(x => x.id)));
    check("Gesperrter Titel wird beim Laden aussortiert", loaded.length === 6 && !loaded.includes("gesperrt"), loaded.join(","));

    // 10) Knopf "Spotify testen": erkennt, dass es am Song liegt
    sim.devices = [{ id: "ipad", name: "iPad", type: "Tablet", is_active: true }];
    await page.evaluate(() => { window.FMQ.setPreferredDeviceId(""); window.FMQ.app.players = [{ id: "p", name: "B", tracks: [{ id: "gesperrt", uri: "spotify:track:gesperrt", name: "Gesperrt" }] }]; });
    sim.playing = { uri: "spotify:track:ok1", startMs: 0, soundAt: Date.now() };
    // Zurück auf den Startbildschirm, dort sitzt der Knopf.
    await page.evaluate(() => { const F = window.FMQ; F.showScreen("screenSetup"); F.app.state.setupStep = 1; F.renderSetupWizard(); });
    await page.click("#spotifyDiagBtn");
    await page.waitForFunction(() => /ERGEBNIS/.test(document.getElementById("spotifyDiagOut").textContent), null, { timeout: 30000 });
    const report = await page.$eval("#spotifyDiagOut", el => el.textContent);
    check("Spotify-Test: Test A (bekannter Song) OK", /Test A OK/.test(report));
    check("Spotify-Test: erkennt Problem beim Playlist-Song", /Test B FEHLGESCHLAGEN/.test(report) && /Liegt am Song/.test(report));
    check("Spotify-Test: zeigt Abspielbarkeit", /abspielbar: NEIN/.test(report));
  } catch (e) {
    console.error("Abbruch:", e.message);
    results.push(false);
  } finally {
    await browser.close();
    app.kill();
  }
  const allOk = results.every(Boolean);
  console.log("\n" + (allOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
  process.exit(allOk ? 0 : 1);
})();

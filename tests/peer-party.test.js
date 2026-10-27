/* Party-Test: iPad + drei Handys, echt im Browser (WebRTC über lokalen
   Vermittlungsserver), Spotify wird auf Netzwerkebene simuliert.

   Geprüft wird (Fehlerliste vom 27.10.):
   - Song erraten: Ausschnitt 3 s dauert ca. 3 s ab Tonbeginn, auch wenn
     Spotify eine andere Song-Kennung meldet (Austausch-Ausgabe), und es
     erscheint KEINE falsche Warnung "Song läuft nicht".
   - Handy-Steuerung: Abspielen violett, Reveal gold; Abspielen nur
     markiert, solange Musik läuft.
   - Selbst-Check: Häkchen vom Handy erscheinen am iPad, danach geht es
     automatisch weiter (kein extra "Weiter").
   - Notfall: Häkchen am iPad setzen und bestätigen vergibt Punkte.
   - "Aus welcher Playlist ist das?": alle Handys antworten, auch mit
     schnellen Mehrfach-Tipps, niemand fliegt aus dem Raum.
   Braucht Playwright, sonst übersprungen. */

const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("Playwright fehlt, Test übersprungen."); process.exit(0); }
const express = require("express");
const { ExpressPeerServer } = require("peer");

const APP_PORT = 3963, PEER_PORT = 9133;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`); };
const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 150 }).then(() => true, () => false);

(async () => {
  const peerApp = express(), peerHttp = http.createServer(peerApp);
  peerApp.use("/", ExpressPeerServer(peerHttp, { path: "/" }));
  await new Promise(r => peerHttp.listen(PEER_PORT, "127.0.0.1", r));
  const app = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(APP_PORT) }, stdio: "ignore" });
  await wait(1500);
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

  // ---- Simuliertes Spotify ------------------------------------
  // Ton kommt 1,5 s nach dem Befehl. Gemeldet wird eine ANDERE Kennung
  // mit gleichem Titel (wie bei Spotifys Länder-Austausch).
  const sim = { playing: null, pauses: [], plays: [] };
  const hostCtx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await hostCtx.route("https://api.spotify.com/**", async route => {
    const u = new URL(route.request().url());
    const json = (s, b) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    if (u.pathname === "/v1/me/player/devices") return json(200, { devices: [{ id: "s22", name: "Galaxy S22", type: "Smartphone", is_active: true }] });
    if (u.pathname === "/v1/me/player/play") {
      const body = JSON.parse(route.request().postData() || "{}");
      const uri = body.uris?.[0] || body.offset?.uri;
      sim.plays.push({ at: Date.now(), body });
      sim.playing = { uri, startMs: body.position_ms || 0, soundAt: Date.now() + 1500 };
      return route.fulfill({ status: 204, body: "" });
    }
    if (u.pathname === "/v1/me/player/pause") { sim.pauses.push(Date.now()); sim.playing = null; return route.fulfill({ status: 204, body: "" }); }
    if (u.pathname === "/v1/me/player") {
      const p = sim.playing;
      if (!p) return json(200, { is_playing: false, item: null });
      const sounding = Date.now() >= p.soundAt;
      const id = p.uri.split(":").pop();
      const name = "Song " + id.replace(/^t/, "").replace(/^(\d)(\d+)$/, "$1-$2");
      return json(200, { is_playing: sounding, progress_ms: sounding ? p.startMs + (Date.now() - p.soundAt) : p.startMs, item: { uri: "spotify:track:relinked_" + id, id: "relinked_" + id, name }, device: { name: "Galaxy S22" } });
    }
    return json(200, {});
  });

  try {
    const host = await hostCtx.newPage();
    host.on("pageerror", e => console.log("  [Host-Fehler]", e.message));
    await host.goto(`http://127.0.0.1:${APP_PORT}/?net=peer&peerserver=127.0.0.1:${PEER_PORT}`);
    await host.evaluate(() => { localStorage.setItem("spotify_access_token", "x"); localStorage.setItem("spotify_expires_at", String(Date.now() + 3600e3)); });
    await host.click("#multiDeviceModeBtn");
    await host.waitForFunction(() => window.FMQ.multiplayer.connected);
    const url = await host.evaluate(() => window.FMQ.getPhoneJoinUrl());

    const phones = {};
    for (const name of ["Anna", "Ben", "Carla"]) {
      const page = await (await browser.newContext({ viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true })).newPage();
      page.on("pageerror", e => console.log(`  [${name}-Fehler]`, e.message));
      await page.goto(url);
      await page.fill("#playerNameInput", name);
      await page.click('#joinForm button[type="submit"]');
      await page.waitForFunction(() => document.body.classList.contains("joined"));
      phones[name] = page;
    }
    await host.waitForFunction(() => window.FMQ.app.players.filter(p => p.remoteConnected).length === 3);
    // Songs mit Playlist-Kennung, Titel "Song i-k"
    await host.evaluate(() => {
      const F = window.FMQ;
      F.app.players.forEach((p, i) => { p.playlistId = "pl" + i; p.playlistName = "Liste " + p.name; p.tracks = Array.from({ length: 8 }, (_, k) => ({ id: `t${i}${k}`, uri: `spotify:track:t${i}${k}`, name: `Song ${i}-${k}`, artists: ["Band " + i], year: 1990 + k, durationMs: 200000, playlistId: "pl" + i, normalizedTitle: F.normalizeTitle(`Song ${i}-${k}`) })); p.spanMin = 1990; p.spanMax = 1997; });
      F.rebuildTrackUniverse();
      Object.assign(F.app.config, { category: "self", mode: "quick3", endType: "rounds", targetRounds: 2 });
      F.$("modeSelect").value = "quick3";
      F.startGame({ fromForm: false });
    });

    // ================= Song erraten =================
    const cur1 = await host.evaluate(() => window.FMQ.currentPlayer().name);
    const me = phones[cur1];
    await me.waitForSelector('#controlPanel [data-control="quick3PlayBtnInline"]', { timeout: 10000 });
    check("Abspielen am Handy violett", await me.$eval('[data-control="quick3PlayBtnInline"]', b => b.classList.contains("play")));
    check("Reveal am Handy gold (nicht rot)", await me.$eval('[data-control="revealBtnInline"]', b => b.classList.contains("reveal") && !b.classList.contains("primary")));

    sim.pauses = [];
    const t0 = Date.now();
    await me.click('[data-control="quick3PlayBtnInline"]');
    check("Abspielen markiert, solange Musik läuft", await until(me, () => document.querySelector('[data-control="quick3PlayBtnInline"]')?.classList.contains("selected")));
    check("Song wird über die Playlist gestartet", await until(host, () => true) && !!sim.plays.at(-1)?.body.context_uri);
    await wait(6500);
    const pauseAfter = sim.pauses[0] ? sim.pauses[0] - t0 : null;
    // Ton ab ~1,5 s + 3 s Ausschnitt = ~4,5 s (plus Abfrage-Takt)
    check("Ausschnitt 3 s stimmt trotz anderer Song-Kennung", pauseAfter !== null && pauseAfter > 3800 && pauseAfter < 6000, pauseAfter === null ? "keine Pause" : `Pause nach ${pauseAfter} ms`);
    check("Keine falsche Warnung 'Song läuft nicht'", await host.$eval("#spotifyAlertGame", el => el.hidden));
    check("Markierung weg, wenn nichts mehr läuft", await until(me, () => !document.querySelector('[data-control="quick3PlayBtnInline"]')?.classList.contains("selected")));

    await me.click('[data-control="revealBtnInline"]');
    check("iPad zeigt Häkchen auch im Handy-Modus", await until(host, () => window.FMQ.$("quick3RevealOverlay").classList.contains("show") && getComputedStyle(document.querySelector("#quick3RevealOverlay .selfCheckList")).display !== "none"));
    await me.waitForSelector('[data-check="title"]', { timeout: 8000 });
    await me.check('[data-check="title"]');
    await me.check('[data-check="year"]');
    await me.click("#sendChecksBtn");
    check("Handy-Häkchen erscheinen am iPad", await until(host, () => window.FMQ.$("quick3ChkTitle").checked && window.FMQ.$("quick3ChkYear").checked && !window.FMQ.$("quick3ChkArtist").checked));
    check("Punkte vom Handy gezählt", await until(host, n => window.FMQ.app.players.find(p => p.name === n).score === 2, cur1));
    check("Danach automatisch weiter (ohne extra Klick)", await until(host, n => window.FMQ.currentPlayer().name !== n && !window.FMQ.$("quick3RevealOverlay").classList.contains("show"), cur1, 6000));

    // Notfall am iPad: nächste Person, Handy bleibt stumm
    const cur2 = await host.evaluate(() => window.FMQ.currentPlayer().name);
    await host.evaluate(() => window.FMQ.$("quick3PlayBtnInline").click());
    await wait(800);
    await host.evaluate(() => window.FMQ.$("revealBtnInline").click());
    await until(host, () => window.FMQ.$("quick3RevealOverlay").classList.contains("show"));
    await host.check("#quick3ChkArtist");
    await host.click("#quick3ConfirmBtn");
    check("Notfall: Häkchen am iPad vergeben Punkte", await until(host, n => window.FMQ.app.players.find(p => p.name === n).score === 1, cur2));
    check("Notfall: es geht weiter", await until(host, n => window.FMQ.currentPlayer().name !== n, cur2));

    // ================= Aus welcher Playlist ist das? =================
    await host.evaluate(() => {
      const F = window.FMQ;
      F.app.players.forEach(p => { p.score = 0; });
      Object.assign(F.app.config, { category: "intro", mode: "introPlaylistGuess", endType: "rounds", targetRounds: 2 });
      F.$("modeSelect").value = "introPlaylistGuess";
      F.startGame({ fromForm: false });
    });
    await wait(800);
    await host.evaluate(() => window.FMQ.$("introGuessPlayBtn").click());
    // Alle angesprochenen Handys antworten, mit hektischen Doppel-Tipps
    let answered = 0;
    for (const [name, page] of Object.entries(phones)) {
      const hasQuestion = await page.waitForSelector("[data-answer]", { timeout: 8000 }).then(() => true, () => false);
      if (!hasQuestion) continue;
      const btns = await page.$$("[data-answer]");
      await btns[0].click(); await btns[btns.length - 1].click(); await btns[0].click();
      await page.click("#sendChoiceBtn");
      await page.click("#sendChoiceBtn").catch(() => {}); // doppelt
      const ok = await until(page, () => /Antwort ist da|nicht dran/.test(document.body.textContent), null, 6000);
      if (ok) answered++;
    }
    check("Playlist-Raten: Antworten kommen von allen Handys an", answered >= 2, `${answered} Handys`);
    const allJoined = (await Promise.all(Object.values(phones).map(p => p.evaluate(() => document.body.classList.contains("joined"))))).every(Boolean);
    check("Kein Handy ist aus dem Raum geflogen", allJoined);
    const paused = (await Promise.all(Object.values(phones).map(p => p.evaluate(() => /Du pausierst/.test(document.body.textContent))))).some(Boolean);
    check("Kein Handy wurde versehentlich pausiert", !paused);
  } catch (e) {
    console.error("Abbruch:", e.message);
    results.push(false);
  } finally {
    await browser.close();
    app.kill();
    peerHttp.close();
  }
  const allOk = results.every(Boolean);
  console.log("\n" + (allOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
  process.exit(allOk ? 0 : 1);
})();

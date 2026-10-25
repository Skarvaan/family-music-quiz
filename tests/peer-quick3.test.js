/* "Songausschnitt raten" im iPad-Betrieb, echt im Browser.
   Spotify wird mit 400 ms Antwortzeit pro Aufruf simuliert.

   Hintergrund: In der Vorversion zeigte Reveal im Mehrgeräte-Modus
   den Song nirgends an, und das Handy baute bei jedem Raum-Update
   die ganze Frage neu auf. Dieser Test hält beides fest.
   Braucht Playwright mit Chromium, sonst wird er übersprungen. */

const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
let chromium;
try { ({ chromium } = require("playwright")); } catch { console.log("Playwright fehlt, Test übersprungen."); process.exit(0); }
const express = require("express");
const { ExpressPeerServer } = require("peer");

const APP_PORT = 3949, PEER_PORT = 9126;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`); };

(async () => {
  const peerApp = express(), peerHttp = http.createServer(peerApp);
  peerApp.use("/", ExpressPeerServer(peerHttp, { path: "/" }));
  await new Promise(r => peerHttp.listen(PEER_PORT, "127.0.0.1", r));
  const app = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT: String(APP_PORT) }, stdio: "ignore" });
  await wait(1500);
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

  try {
    const host = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
    await host.goto(`http://127.0.0.1:${APP_PORT}/?net=peer&peerserver=127.0.0.1:${PEER_PORT}`);
    // Spotify-Attrappe mit Verzögerung
    await host.evaluate(() => {
      window.__api = [];
      window.FMQ.apiFetch = async url => { window.__api.push(url); await new Promise(r => setTimeout(r, 400)); return { devices: [{ id: "d", is_active: true }] }; };
      window.FMQ.storage.token = "x";
    });
    await host.click("#multiDeviceModeBtn");
    await host.waitForFunction(() => window.FMQ.multiplayer.connected);
    const url = await host.evaluate(() => window.FMQ.getPhoneJoinUrl());

    const phones = {};
    for (const name of ["Anna", "Ben"]) {
      const p = await (await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage();
      await p.goto(url);
      await p.fill("#playerNameInput", name);
      await p.click('#joinForm button[type="submit"]');
      await p.waitForFunction(() => document.body.classList.contains("joined"));
      await p.evaluate(() => { window.__renders = 0; new MutationObserver(() => window.__renders++).observe(document.getElementById("promptPanel"), { childList: true }); });
      phones[name] = p;
    }
    await host.waitForFunction(() => window.FMQ.app.players.filter(p => p.remoteConnected).length === 2);

    // Spiel mit Testsongs starten
    await host.evaluate(() => {
      const F = window.FMQ;
      F.app.players.forEach((p, i) => { p.playlistId = "pl" + i; p.tracks = Array.from({ length: 12 }, (_, k) => ({ id: `t${i}_${k}`, uri: `spotify:track:t${i}_${k}`, name: `Song ${i}-${k}`, artists: [`Band ${i}`], artistName: `Band ${i}`, year: 1990 + k, durationMs: 200000 })); });
      F.rebuildTrackUniverse();
      Object.assign(F.app.config, { category: "self", mode: "quick3", endType: "rounds", targetRounds: 3 });
      F.$("modeSelect").value = "quick3";
      F.startGame({ fromForm: false });
    });
    const cur = await host.evaluate(() => window.FMQ.currentPlayer().name);
    const me = phones[cur], other = phones[cur === "Anna" ? "Ben" : "Anna"];
    check("Handy am Zug bekommt Steuerknöpfe", await me.waitForSelector('#controlPanel [data-control="quick3PlayBtnInline"]', { timeout: 10000 }).then(() => true, () => false));

    await me.click('#controlPanel [data-control="quick3PlayBtnInline"]');
    await host.waitForFunction(() => window.__api.some(u => u.includes("/play")));
    await wait(1200);
    await me.click('#controlPanel [data-control="revealBtnInline"]');
    await wait(1500);

    check("Reveal: Auflösung am iPad sichtbar", await host.evaluate(() => window.FMQ.$("quick3RevealOverlay").classList.contains("show") && /Song \d-\d+/.test(window.FMQ.$("quick3RevealContent").textContent)));
    check("Reveal: Lösung auf dem Handy am Zug", /Es war: Song/.test(await me.$eval("#promptPanel", e => e.textContent)));
    check("Reveal: Lösung auch auf den anderen Handys", /Es war: Song/.test(await other.$eval("#promptPanel", e => e.textContent)));

    await me.check('[data-check="title"]');
    await me.check('[data-check="artist"]');
    await me.click("#sendChecksBtn");
    check("Punkte vom Handy-Selbst-Check", await host.waitForFunction(n => window.FMQ.app.players.find(p => p.name === n)?.score === 2, cur, { timeout: 8000 }).then(() => true, () => false));
    check("Auflösung bleibt bis Weiter stehen", await host.evaluate(() => window.FMQ.$("quick3RevealOverlay").classList.contains("show")));
    check("Handy bekommt genau einen Weiter-Knopf", await me.waitForFunction(() => [...document.querySelectorAll("#controlPanel [data-control]")].filter(b => /Weiter/.test(b.textContent)).length === 1, null, { timeout: 8000 }).then(() => true, () => false));

    await me.click('#controlPanel [data-control="quick3ConfirmBtn"]');
    check("Weiter vom Handy: nächste Person ist dran", await host.waitForFunction(n => window.FMQ.currentPlayer().name !== n, cur, { timeout: 8000 }).then(() => true, () => false));

    const renders = await other.evaluate(() => window.__renders);
    check("Handy baut die Frage nicht bei jedem Update neu", renders <= 4, `${renders} Neuaufbauten`);
    const deviceCalls = await host.evaluate(() => window.__api.filter(u => u.includes("/devices")).length);
    check("Spotify-Gerät wird gemerkt", deviceCalls === 1, `${deviceCalls}× Geräteliste`);
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

/* Echter Durchlauf des iPad-Betriebs (WebRTC) in einem Browser.

   Simuliert: ein Host-Gerät (iPad) und zwei Handys, alle in
   eigenen Browser-Profilen. Statt der PeerJS-Cloud läuft ein
   lokaler Vermittlungsserver, damit der Test offline geht.

   Braucht Playwright mit Chromium (npx playwright install chromium).
   Ist Playwright nicht da, wird der Test übersprungen.

   Geprüft wird:
   - Raum öffnen, QR-Code im Browser
   - zwei Handys treten bei
   - Frage stellen, Antwort kommt beim Host an
   - große Frage (300 Songs pro Handy) wird gestückelt übertragen
   - ein Handy darf sich nicht zum Host machen
   - Handy verliert kurz das Netz und kommt von selbst zurück
   - Host-Tab wird neu geladen: gleicher Raumcode, Handys docken wieder an
   - falscher Raumcode gibt eine verständliche Meldung */

const path = require("path");
const { spawn } = require("child_process");

let chromium;
try { ({ chromium } = require("playwright")); } catch {
  console.log("Playwright fehlt, WebRTC-Test übersprungen.");
  process.exit(0);
}
const http = require("http");
const express = require("express");
const { ExpressPeerServer } = require("peer");

const APP_PORT = Number(process.env.TEST_APP_PORT || 3946);
const PEER_PORT = Number(process.env.TEST_PEER_PORT || 9123);
const PEER_PARAM = `127.0.0.1:${PEER_PORT}`;
const HOST_URL = `http://127.0.0.1:${APP_PORT}/?net=peer&peerserver=${PEER_PARAM}`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = "") => {
  results.push(!!ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`);
};

/** Wartet, bis fn() im Browser true liefert. */
const until = async (page, fn, arg, timeout = 20000) => {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 200 }); return true; } catch { return false; }
};

(async () => {
  // Lokaler Vermittlungsserver, nur IPv4 (der Container hat kein IPv6).
  const peerApp = express();
  const peerHttp = http.createServer(peerApp);
  peerApp.use("/", ExpressPeerServer(peerHttp, { path: "/" }));
  await new Promise(r => peerHttp.listen(PEER_PORT, "127.0.0.1", r));
  const app = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(APP_PORT) }, stdio: "ignore"
  });
  await wait(1500);

  // Chromium versteckt lokale IPs sonst hinter mDNS-Namen, die
  // im Testcontainer niemand auflöst. Im echten WLAN egal.
  const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const phoneOpts = { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true };

  try {
    // ---- Host -------------------------------------------------
    const hostCtx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    let host = await hostCtx.newPage();
    host.on("pageerror", e => console.log("  [host-Fehler]", e.message));
    await host.goto(HOST_URL);
    await host.click("#multiDeviceModeBtn");
    const hostUp = await until(host, () => window.FMQ.multiplayer.connected && window.FMQ.multiplayer.roomCode);
    check("Host meldet sich bei der Vermittlung an", hostUp);
    const room = await host.evaluate(() => window.FMQ.multiplayer.roomCode);
    const joinUrl = await host.evaluate(() => window.FMQ.getPhoneJoinUrl());
    check("Beitrittslink zeigt auf die Handy-Seite", /\/public\/player\.html\?room=/.test(joinUrl), joinUrl);
    check("QR-Code wird im Browser erzeugt", await host.$eval(".qrBox img", img => img.src.startsWith("data:image/svg+xml")).catch(() => false));

    // Antworten am Host mitschreiben
    await host.evaluate(() => { window.__answers = []; window.FMQ.multiplayer.socket.on("host:answerSubmitted", a => window.__answers.push(a)); });

    // ---- Zwei Handys -----------------------------------------
    const joinPhone = async name => {
      const ctx = await browser.newContext(phoneOpts);
      const page = await ctx.newPage();
      page.on("pageerror", e => console.log(`  [${name}-Fehler]`, e.message));
      await page.goto(joinUrl);
      await page.fill("#playerNameInput", name);
      await page.click('#joinForm button[type="submit"]');
      const ok = await until(page, () => document.body.classList.contains("joined"));
      return { ctx, page, ok };
    };
    const anna = await joinPhone("Anna");
    check("Handy 1 tritt bei", anna.ok);
    const ben = await joinPhone("Ben");
    check("Handy 2 tritt bei", ben.ok);
    check("Host sieht beide als online", await until(host, () => window.FMQ.multiplayer.players.filter(p => p.connected).length === 2));

    // ---- Frage + Antwort -------------------------------------
    await host.evaluate(() => new Promise(res => window.FMQ.multiplayer.socket.emit("host:startPrompt",
      { id: "q1", type: "test", title: "Testfrage", text: "A oder B?", options: [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }] }, res)));
    check("Frage erscheint auf dem Handy", await until(anna.page, () => !!document.querySelector('[data-answer="A"]')));
    await anna.page.click('[data-answer="A"]');
    await anna.page.click("#sendChoiceBtn");
    check("Antwort kommt beim Host an", await until(host, () => window.__answers.some(a => a.promptId === "q1" && a.answer === "A")));
    check("Handy zeigt Bestätigung", await until(anna.page, () => /Antwort ist da/.test(document.body.textContent)));

    // ---- Große Frage (Stückelung) ----------------------------
    const ids = await host.evaluate(() => window.FMQ.multiplayer.players.map(p => p.id));
    await host.evaluate(ids => {
      const tracks = n => Array.from({ length: 300 }, (_, i) => ({ id: `t${n}-${i}`, name: `Ein ziemlich langer Songtitel mit Ümläuten Nummer ${i}`, artistName: `Künstler ${i} feat. Jemand`, year: 1970 + (i % 50) }));
      const tracksByPlayer = Object.fromEntries(ids.map((id, n) => [id, tracks(n)]));
      return new Promise(res => window.FMQ.multiplayer.socket.emit("host:startPrompt", { id: "q2", kind: "songSelect", title: "Wähle", text: "Einen Song", tracksByPlayer }, res));
    }, ids);
    check("Große Frage (300 Songs) kommt gestückelt an", await until(ben.page, () => /300 Songs in deiner Playlist/.test(document.body.textContent)));

    // ---- Handy darf nicht Host spielen -----------------------
    const hijack = await ben.page.evaluate(code => new Promise(res => {
      const s = window.FMQNet.createPeerSocket();
      s.setRoom(code);
      s.emit("host:createRoom", { newSession: true }, r => { s.disconnect(); res(r); });
    }), room);
    check("Handy kann sich nicht zum Host machen", hijack && hijack.ok === false && /darf keinen Raum/.test(hijack.error || ""), JSON.stringify(hijack));
    check("Raumcode blieb dabei gleich", (await host.evaluate(() => window.FMQ.multiplayer.roomCode)) === room);

    // ---- Funkloch am Handy -----------------------------------
    await anna.ctx.setOffline(true);
    await wait(14000); // länger als der Totmannschalter (12 s)
    await anna.ctx.setOffline(false);
    check("Handy kommt nach Funkloch von selbst zurück", await until(host, () => {
      const a = window.FMQ.multiplayer.players.find(p => p.name === "Anna");
      return a && a.connected;
    }, null, 30000));

    // ---- Host-Reload -----------------------------------------
    await host.reload();
    await host.click("#multiDeviceModeBtn");
    check("Host nach Reload wieder online", await until(host, () => window.FMQ.multiplayer.connected, null, 40000));
    check("Raumcode überlebt Host-Reload", (await host.evaluate(() => window.FMQ.multiplayer.roomCode)) === room);
    check("Beide Handys docken wieder an", await until(host, () => window.FMQ.multiplayer.players.filter(p => p.connected).length === 2, null, 40000));
    check("Keine doppelten Spieler nach Reload", (await host.evaluate(() => window.FMQ.multiplayer.players.length)) === 2);

    // ---- Falscher Code ---------------------------------------
    const lostCtx = await browser.newContext(phoneOpts);
    const lost = await lostCtx.newPage();
    await lost.goto(joinUrl.replace(`room=${room}`, "room=zzzzzz"));
    await lost.fill("#playerNameInput", "Carla");
    // Code von Hand eintippen (ohne QR) = der Weg mit setRoom + emit direkt nacheinander
    await lost.fill("#roomCodeInput", "zzzzzz");
    await lost.click('#joinForm button[type="submit"]');
    check("Falscher Code gibt klare Meldung", await until(lost, () => /nicht gefunden/.test(document.body.textContent)));

    // Danach richtigen Code eintippen: muss im ersten Anlauf klappen
    await lost.fill("#roomCodeInput", room);
    await lost.click('#joinForm button[type="submit"]');
    check("Code von Hand eintippen klappt beim ersten Versuch", await until(lost, () => document.body.classList.contains("joined")));
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

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
    failPlayWith: null   // z. B. 403, um einen Fehler zu erzwingen
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
        sim.played.push(id);
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname === "/v1/me/player/pause") return route.fulfill({ status: 204, body: "" });
      if (url.pathname === "/v1/me") return json(200, { id: "bene" });
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

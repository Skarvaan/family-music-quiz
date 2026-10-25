/* Ein-Gerät-Modus komplett durchspielen, Spotify wird attrappiert. */
const { JSDOM } = require("jsdom");
const fs = require("fs");

function makeGame() {
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(__dirname + "/../index.html","utf8"), { runScripts:"outside-only", url:"http://localhost:3000/", pretendToBeVisual:true });
  const w = dom.window;
  let uid = 0;
  w.crypto = { randomUUID: () => "id" + (++uid), getRandomValues: a => { for (let i=0;i<a.length;i++) a[i]=i; return a; } };
  w.onerror = m => errors.push("onerror: " + m);
  w.fetch = async () => ({ ok:true, status:200, json: async () => ({}) });
  const mem = {};
  Object.defineProperty(w, "localStorage", { value:{ getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=v;}, removeItem:k=>{delete mem[k];} } });

  [
    "js/core.js",
    "js/players.js",
    "js/scoring.js",
    "js/modeConfig.js",
    "js/spotify.js",
    "js/multiplayer.js",
    "js/remotePlayers.js",
    "js/phoneControls.js",
    "js/multiplayerRound.js",
    "js/lobby.js",
    "data/songPrompts.js",
    "js/modes/shared.js",
    "js/modes/guessSong.js",
    "js/modes/quick3.js",
    "js/modes/rankingList.js",
    "js/modes/introPlaylistGuess.js",
    "js/modes/introFirst3.js",
    "js/modes/ratingGuess.js",
    "js/modes/bestFit.js",
    "js/modes/songChallenge.js",
    "js/setup.js",
    "js/pausePanel.js",
    "js/turn.js",
    "js/roundFlow.js",
    "js/main.js"
  ]
    .forEach(f => { try { w.eval(fs.readFileSync(__dirname + "/../" + f,"utf8")); } catch(e){ errors.push(f+": "+e.message); } });

  const F = w.FMQ;
  // Spotify-Attrappe
  const played = [];
  F.playTrackUri = async (uri, opt) => { played.push({ uri, ...opt }); };
  F.pausePlayback = async () => {};
  F.validateSpotifySession = async () => true;
  F.loadMyPlaylists = async () => {};
  return { w, F, errors, played, dom };
}

function seedPlayers(F, names) {
  F.storage.token = "faketoken";
  F.app.players = names.map((name, i) => ({
    id: "p" + i, name, playlistId: "pl" + i, playlistName: "Liste " + name,
    tracks: Array.from({length:12}, (_,k) => ({
      id:`t${i}_${k}`, uri:`spotify:track:t${i}_${k}`, name:`Song ${i}-${k}`,
      artists:[`Band ${i}`], artistName:`Band ${i}`, year: 1990 + k, durationMs: 200000
    })),
    spanMin:1990, spanMax:2001, score:0, active:true, spectator:false
  }));
  F.rebuildTrackUniverse();
}

const click = (w, el) => { if (!el) throw new Error("Element fehlt"); el.dispatchEvent(new w.MouseEvent("click",{bubbles:true,cancelable:true})); };

(async () => {
  const results = [];
  const check = (label, ok, extra="") => { results.push({label, ok, extra}); console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  "+extra : ""}`); };

  // ============ Modus 1: Songausschnitt raten ============
  {
    const { w, F, errors, played } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin","Oma"]);
    F.setDeviceMode("single");
    check("Ein-Gerät-Modus aktiv", F.isMultiDevice() === false);

    F.app.config.category = "self";
    F.$("modeSelect").value = "quick3";
    F.app.config.mode = "quick3";
    F.app.config.endType = "rounds";
    F.app.config.targetRounds = 3;
    F.startGame({ fromForm: false });

    check("Spielbildschirm sichtbar", F.$("screenGame").classList.contains("active"));
    check("Spieler am Zug angezeigt", F.$("turnPlayerName").textContent === "Bene", F.$("turnPlayerName").textContent);
    check("Inline-Steuerung vorhanden", !!F.$("quick3PlayBtnInline") && !!F.$("revealBtnInline"));

    // Clip abspielen
    F.$("quick3LenSelectInline").value = "5";
    F.$("quick3LenSelectInline").dispatchEvent(new w.Event("change"));
    click(w, F.$("quick3PlayBtnInline"));
    await new Promise(r => setTimeout(r, 30));
    check("Song wurde abgespielt", played.length === 1, played[0]?.uri);
    check("Clip-Länge übernommen", F.app.state.quick3.clipSeconds === 5);

    // Reveal
    click(w, F.$("revealBtnInline"));
    await new Promise(r => setTimeout(r, 30));
    check("Auflösungs-Overlay offen", F.$("quick3RevealOverlay").classList.contains("show"));
    check("Titel in der Auflösung", F.$("quick3RevealContent").textContent.includes("Song 0-"));

    // Selbstcheck: Titel und Interpret richtig
    F.$("quick3ChkTitle").checked = true;
    F.$("quick3ChkArtist").checked = true;
    click(w, F.$("quick3ConfirmBtn"));
    await new Promise(r => setTimeout(r, 400));
    check("Punkte vergeben", F.app.players[0].score === 2, "Score " + F.app.players[0].score);
    check("Nächster Spieler ist dran", F.$("turnPlayerName").textContent === "Partnerin", F.$("turnPlayerName").textContent);

    // Zwei weitere Züge, dann Rundenwechsel
    const spielZug = async () => {
      click(w, F.$("quick3PlayBtnInline"));
      click(w, F.$("revealBtnInline"));
      await new Promise(r => setTimeout(r, 20));
      F.$("quick3ChkTitle").checked = true;
      click(w, F.$("quick3ConfirmBtn"));
      await new Promise(r => setTimeout(r, 350));
    };
    await spielZug(); await spielZug();
    check("Runde weitergezählt", F.app.state.round === 2, "Runde " + F.app.state.round);
    check("Wieder bei Spieler 1", F.$("turnPlayerName").textContent === "Bene");

    const usedVorher = F.app.usedTrackIds.size;
    check("Keine Songwiederholung", usedVorher === 3, usedVorher + " verschiedene Songs bei 3 Zügen");

    check("Keine JS-Fehler (Ausschnitt raten)", errors.length === 0, errors.join(" | "));
  }

  // ============ Modus 2: Ranking Liste ============
  console.log("\n-- Ranking Liste --");
  {
    const { w, F, errors, played } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin"]);
    F.setDeviceMode("single");
    F.app.config.category = "self";
    F.$("modeSelect").value = "rankingList"; F.app.config.mode = "rankingList";
    F.app.config.rankingSize = 5;
    F.startGame({ fromForm: false });
    await new Promise(r=>setTimeout(r,60)); // Song wird asynchron gezogen
    check("Ranking-Plaetze gerendert", w.document.querySelectorAll("#rankingSlotsWrap [data-rank]").length === 5);
    check("Aktueller Song angezeigt", !!F.$("rankingCurrentCard"));
    click(w, F.$("rankingPlayBtn"));
    await new Promise(r=>setTimeout(r,20));
    check("Song abgespielt", played.length === 1);
    check("Weiter zunaechst gesperrt", F.$("rankingNextBtn").disabled === true);
    click(w, w.document.querySelector('#rankingSlotsWrap [data-rank="3"]'));
    check("Nach Platzwahl freigegeben", F.$("rankingNextBtn").disabled === false);
    const track = F.app.state.currentTrack;
    click(w, F.$("rankingNextBtn"));
    await new Promise(r=>setTimeout(r,30));
    const liste = F.app.state.rankingList.lists["p0"] || [];
    check("Song auf Platz 3 fixiert", liste[2]?.track?.id === track.id);
    check("Zielrunden auf Ranking-Groesse", F.app.config.targetRounds === 5);
    check("Keine JS-Fehler (Ranking)", errors.length === 0, errors.join(" | "));
  }

  // ============ Modus 3: Bewertung einschaetzen ============
  console.log("\n-- Song-Bewertung einschaetzen --");
  {
    const { w, F, errors, played } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin","Oma"]);
    F.setDeviceMode("single");
    F.app.config.category = "social";
    F.$("modeSelect").value = "ratingGuess"; F.app.config.mode = "ratingGuess";
    F.app.config.endType = "rounds"; F.app.config.targetRounds = 2;
    F.startGame({ fromForm: false });
    check("Hoerphase startet", F.app.state.social?.phase === "listen", F.app.state.social?.phase);
    check("Play zunaechst gesperrt", F.$("ratingPlayResumeBtn").disabled === true);
    await new Promise(r=>setTimeout(r,60));
    check("Play nach Songzug frei", F.$("ratingPlayResumeBtn").disabled === false);
    click(w, F.$("ratingPlayResumeBtn"));
    await new Promise(r=>setTimeout(r,20));
    check("Song laeuft", played.length >= 1);
    click(w, F.$("ratingListenNextBtn"));
    await new Promise(r=>setTimeout(r,40));
    check("Schaetzphase erreicht", F.app.state.social?.phase === "othersGuessing", F.app.state.social?.phase);
    const skala = w.document.querySelectorAll("#modeArea [data-rate]");
    check("Skala 1-10 vorhanden", skala.length === 10, skala.length + " Buttons");
    click(w, skala[6]);
    check("Weiter nach Auswahl aktiv", F.$("ratingNextBtn").disabled === false);
    check("Keine JS-Fehler (Bewertung)", errors.length === 0, errors.join(" | "));
  }

  // ============ Modus 4: Song A oder B ============
  console.log("\n-- Song A oder B --");
  {
    const { w, F, errors, played } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin","Oma"]);
    F.setDeviceMode("single");
    F.app.config.category = "social";
    F.$("modeSelect").value = "bestFit"; F.app.config.mode = "bestFit";
    F.app.config.endType = "rounds"; F.app.config.targetRounds = 2;
    F.startGame({ fromForm: false });
    await new Promise(r=>setTimeout(r,40));
    check("Zwei Songs gezogen", !!F.app.state.bestFitTracks?.a && !!F.app.state.bestFitTracks?.b);
    check("Songs sind verschieden", F.app.state.bestFitTracks.a.id !== F.app.state.bestFitTracks.b.id);
    check("Abspielknoepfe A und B", !!F.$("playAFromStartBtn") && !!F.$("playBFromStartBtn"));
    click(w, F.$("playAFromStartBtn"));
    await new Promise(r=>setTimeout(r,20));
    check("Song A laeuft", played.length >= 1);
    check("Keine JS-Fehler (A oder B)", errors.length === 0, errors.join(" | "));
  }

  // ============ Modus 5: Aus welcher Playlist ============
  console.log("\n-- Aus welcher Playlist --");
  {
    const { w, F, errors, played } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin","Oma"]);
    F.setDeviceMode("single");
    F.app.config.category = "intro";
    F.$("modeSelect").value = "introPlaylistGuess"; F.app.config.mode = "introPlaylistGuess";
    F.startGame({ fromForm: false });
    click(w, F.$("introGuessPlayBtn"));
    await new Promise(r=>setTimeout(r,40));
    check("Song abgespielt", played.length >= 1);
    const tipps = w.document.querySelectorAll("#plGuessPanel [data-owner]");
    check("Tippbuttons je Playlist", tipps.length === 3, tipps.length + " Buttons");
    const label = F.$("plGuessPanel").textContent;
    check("Zeigt an wer tippt", label.includes("tippt"), label.slice(0,40));
    click(w, tipps[0]);
    await new Promise(r=>setTimeout(r,20));
    check("Naechste Person ist dran", F.$("plGuessPanel").textContent.includes("tippt"));
    check("Keine JS-Fehler (Playlist raten)", errors.length === 0, errors.join(" | "));
  }

  // ============ Modus 6: Meine ersten 3 Songs ============
  console.log("\n-- Meine ersten 3 Songs --");
  {
    const { w, F, errors } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin"]);
    F.setDeviceMode("single");
    F.app.config.category = "intro";
    F.$("modeSelect").value = "introFirst3"; F.app.config.mode = "introFirst3";
    F.startGame({ fromForm: false });
    await new Promise(r=>setTimeout(r,40));
    const knoepfe = w.document.querySelectorAll("[data-first3-play]");
    check("Abspielknoepfe fuer die ersten Songs", knoepfe.length > 0, knoepfe.length + " Buttons");
    check("Keine JS-Fehler (erste 3)", errors.length === 0, errors.join(" | "));
  }

  // ============ Spielende und Sieger ============
  console.log("\n-- Spielende --");
  {
    const { w, F, errors } = makeGame();
    await F.init();
    seedPlayers(F, ["Bene","Partnerin"]);
    F.setDeviceMode("single");
    F.app.config.category = "self";
    F.$("modeSelect").value = "quick3"; F.app.config.mode = "quick3";
    F.app.config.endType = "rounds"; F.app.config.targetRounds = 1;
    F.startGame({ fromForm: false });
    check("Konfiguration bleibt erhalten", F.app.config.targetRounds === 1, "targetRounds " + F.app.config.targetRounds);
    // Gegenprobe: mit Formular gewinnt das Formular
    F.$("targetRoundsInput").value = "7";
    F.readSetupForm();
    check("Formular schreibt in die Konfiguration", F.app.config.targetRounds === 7);
    F.app.config.targetRounds = 1; F.writeSetupForm();
    check("Konfiguration spiegelt zurueck ins Formular", F.$("targetRoundsInput").value === "1");
    F.app.players[0].score = 5; F.app.players[1].score = 2;
    F.app.state.round = 2;
    await F.onNext();
    check("Siegerbildschirm erscheint", F.$("screenWinner").classList.contains("active"));
    check("Richtiger Sieger", F.$("winnerHeadline").textContent.includes("Bene"), F.$("winnerHeadline").textContent);
    check("Endstand gelistet", F.$("finalScoreTable").textContent.includes("5 Punkte"));
    click(w, F.$("endBtn"));
    await new Promise(r=>setTimeout(r,30));
    check("Zurueck im Setup", F.$("screenSetup").classList.contains("active"));
    check("Keine JS-Fehler (Spielende)", errors.length === 0, errors.join(" | "));
  }

  console.log("");
  console.log(results.every(r=>r.ok) ? "ALLE PRUEFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLAEGE: " + results.filter(r=>!r.ok).map(r=>r.label).join(", "));
  process.exit(results.every(r=>r.ok) ? 0 : 1);
})().catch(e => { console.error("Abbruch:", e.stack); process.exit(1); });

window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Meine ersten 3 Songs. Lockeres Reinhören ohne Wertung. */

FMQ.modes.introFirst3 = {
  label: "Meine ersten 3 Songs",
  supportsAllGuess: false,
  async playClip(track, seconds = 10, mode = "start") {
    if (!track) return;
    const startMs = FMQ.getStoredStartMs(track, `first3:${track.id}`, mode);
    await FMQ.playTrackUri(track.uri, { positionMs: startMs });
    clearTimeout(FMQ.app.state.playTimer);
    FMQ.app.state.playTimer = null;
    if (seconds !== "full") {
      FMQ.app.state.playTimer = setTimeout(() => {
        FMQ.pausePlayback().catch(() => {});
      }, seconds * 1000);
    }
  },
  renderArea() {
    FMQ.$("modeAreaTitle").textContent = "Meine ersten 3 Songs";
    const me = FMQ.currentPlayer();
    const top = (me?.tracks || []).slice(0, 3);
    const labels = ["Song 1", "Song 2", "Song 3"];
    const descriptors = ["Favorit!", "Sehr gut", "Gut"];
    FMQ.renderModeLikeQuick3({
      heading: `Die ersten 3 Songs von "${FMQ.escapeHtml(me?.name || "")}"`,
      subtitle: "Locker reinhören: 10 Sekunden, 20 Sekunden oder ganzer Song.",
      heroName: "",
      panelClass: "theme-playlist",
      bodyHtml: `<div class="quick3Controls quick3Controls--center u-mb-md"><select id="first3StartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select></div><div class="first3List">${top.map((t, i) => `<div class="first3Row"><div class="first3Meta"><span class="pill">${i + 1}) ${labels[i]}</span><span class="first3Descriptor">${descriptors[i]}</span></div><div class="abTransport"><button id="first3Play${i}_10" class="big" data-first3-play="${i}" data-seconds="10">▶️ ${labels[i]} · 10 Sek.</button><button id="first3Play${i}_20" class="big" data-first3-play="${i}" data-seconds="20">▶️ ${labels[i]} · 20 Sek.</button><button id="first3Play${i}_full" class="big" data-first3-play="${i}" data-seconds="full">▶️ ${labels[i]} · Ganzer Song</button></div></div>`).join("")}</div><div class="abTransport"><button id="iceStopBtn" class="big">⏸️ Stop</button></div><div class="muted u-text-center u-mt-sm" id="iceTrackInfo">${top.length ? "Spiele Song 1, 2 oder 3 kurz an." : "Zu wenig Songs in der Playlist."}</div><div class="row row--center u-mt-lg"><button id="iceNextBtn" class="big primary">Weiter</button></div>`
    });
    if (FMQ.isMultiDevice?.() && me) FMQ.ensureMultiplayerController?.(me.remoteId || me.id);
    FMQ.bindPlayerStartModeSelect("first3StartModeSelect");
    FMQ.$("modeArea").querySelectorAll("[data-first3-play]").forEach(btn => btn.onclick = () => {
      const idx = parseInt(btn.getAttribute("data-first3-play"), 10);
      const secondsRaw = btn.getAttribute("data-seconds");
      const seconds = secondsRaw === "full" ? "full" : parseInt(secondsRaw, 10);
      const t = top[idx];
      if (!t) return;
      FMQ.modes.introFirst3.playClip(t, seconds, FMQ.getBoundStartMode("first3StartModeSelect")).then(() => {
        FMQ.$("iceTrackInfo").textContent = `${labels[idx]} · ${seconds === "full" ? "Ganzer Song" : `${seconds} Sek.`}: ${t.name} · ${t.artists.join(", ")}`;
      }).catch(e => FMQ.setGameDebug(e.stack || e.message));
    });
    FMQ.$("iceStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
    FMQ.$("iceNextBtn").onclick = async () => {
      try { await FMQ.pausePlayback(); } catch {}
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = null;
      FMQ.onNext();
    };
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};

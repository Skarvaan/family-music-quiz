window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Songausschnitt raten. Clip-Länge und Startpunkt wählen,
   danach Selbst-Check für Titel, Interpret und Jahr. */

FMQ.modes.quick3 = {
  label: "Songausschnitt raten",
  supportsAllGuess: false,
  submitAnswer(playerId, answer) {
    FMQ.app.state.quick3.answers[playerId] = answer;
    return FMQ.modes.guessSong.submitAnswer(playerId, answer);
  },
  renderArea() {
    const me = FMQ.currentPlayer();
    FMQ.$("modeAreaTitle").textContent = "Songausschnitt raten";
    FMQ.$("modeArea").innerHTML = `
      <div class="quick3Hero">
        <div class="name">${FMQ.escapeHtml(me.name)}</div>
        <div class="sub muted">Wähle Sekunden und Startpunkt, dann starte den Clip.</div>
      </div>
      <div class="quick3Stage">
        <div class="quick3Panel">
          <div class="quick3Controls" id="quick3InlineControls">
            <select id="quick3LenSelectInline">
              <option value="3">3 Sekunden</option>
              <option value="5">5 Sekunden</option>
              <option value="10">10 Sekunden</option>
              <option value="full">Ganzer Song</option>
            </select>
            <select id="quick3StartModeSelectInline">
              <option value="start">Von Anfang an</option>
              <option value="random">Zufällig mittig</option>
            </select>
            <button id="quick3PlayBtnInline" class="big">▶️ Abspielen</button>
            ${FMQ.isMultiDevice?.() ? `<button id="quick3StopBtnInline" class="big">⏸️ Stop</button>` : ""}
          </div>
          <div class="revealCenter">
            <button id="revealBtnInline" class="big">Reveal</button>
          </div>
        </div>
      </div>
    `;
    FMQ.$("quick3LenSelectInline").value = String(FMQ.app.state.quick3.clipSeconds);
    FMQ.$("quick3LenSelectInline").onchange = () => {
      const nextVal = FMQ.$("quick3LenSelectInline").value;
      FMQ.app.state.quick3.clipSeconds = nextVal === "full" ? "full" : parseInt(nextVal, 10);
    };
    FMQ.bindPlayerStartModeSelect("quick3StartModeSelectInline");
    FMQ.$("quick3PlayBtnInline").onclick = () => FMQ.onQuick3Play(FMQ.getBoundStartMode("quick3StartModeSelectInline")).catch(e => FMQ.setGameDebug(e.stack || e.message));
    if (FMQ.$("quick3StopBtnInline")) FMQ.$("quick3StopBtnInline").onclick = () => FMQ.stopPlaybackNow?.().catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("revealBtnInline").onclick = () => FMQ.$("revealBtn").click();
    if (FMQ.isMultiDevice?.() && me) FMQ.ensureMultiplayerController?.(me.remoteId || me.id);
    if (FMQ.isMultiDevice?.() && FMQ.app.state.quick3.multiReveal) {
      const expectedIds = [FMQ.currentPlayer()?.id].filter(Boolean);
      const allDone = expectedIds.every(id => Object.prototype.hasOwnProperty.call(FMQ.app.state.quick3.answers || {}, id));
      FMQ.$("modeArea").insertAdjacentHTML("beforeend", `${FMQ.modes.bestFit.answerStatusHtml(expectedIds, FMQ.app.state.quick3.answers)}`);
      if (allDone && !FMQ.app.state.quick3.advanceAfterSelfCheck) {
        FMQ.app.state.quick3.advanceAfterSelfCheck = true;
        setTimeout(() => FMQ.onNext().catch(e => FMQ.setGameDebug(e.stack || e.message)), 0);
      }
    }
  },
  getClipSeconds() { return FMQ.app.state.quick3.clipSeconds || 3; },
  randomStartMs(track) {
    const dur = track.durationMs || 180000;
    const clipSeconds = this.getClipSeconds();
    const clip = clipSeconds === "full" ? 15000 : clipSeconds * 1000;
    const min = 20000;
    const max = Math.max(min, dur - 20000 - clip);
    return max <= min ? 0 : Math.floor(min + Math.random() * (max - min));
  },
  async playStored(track, startMs) {
    await FMQ.playTrackUri(track.uri, { positionMs: startMs });
    clearTimeout(FMQ.app.state.playTimer);
    FMQ.app.state.playTimer = null;
    const clipSeconds = this.getClipSeconds();
    if (clipSeconds !== "full") {
      FMQ.app.state.playTimer = setTimeout(async () => {
        try { await FMQ.pausePlayback(); } catch {}
        FMQ.app.state.isPlaying = false;
      }, clipSeconds * 1000);
    }
    FMQ.app.state.isPlaying = true;
  },
  onReveal() {
    if (FMQ.isMultiDevice?.()) {
      FMQ.app.state.selfCheckPending = false;
      FMQ.app.state.quick3.multiReveal = true;
      FMQ.startMultiplayerPrompt?.({
        id: crypto.randomUUID(),
        type: "quick3SelfCheck",
        kind: "checks",
        title: "Was hattest du richtig?",
        text: "Markiere alles, was du erkannt hast.",
        options: [{ value: "title", label: "Titel" }, { value: "artist", label: "Interpret" }, { value: "year", label: "Jahr" }],
        waitingText: "Warte auf die Auswahl aller anderen Personen!",
        sentText: "Selbstcheck gespeichert. Bitte warten …",
        recipientIds: [FMQ.currentPlayer()?.id].filter(Boolean)
      });
      setTimeout(() => FMQ.modes.quick3.renderArea(), 0);
      return { skipReveal: true, disableReveal: true };
    }
    FMQ.app.state.selfCheckPending = true;
    return { headline: "Auflösung", detail: "Selbst-Check notwendig" };
  },
  renderRevealExtras() { FMQ.modes.guessSong.renderRevealExtras(); }
};

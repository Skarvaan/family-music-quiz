window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Songausschnitt raten. Clip-Länge und Startpunkt wählen,
   danach Selbst-Check für Titel, Interpret und Jahr. */

FMQ.modes.quick3 = {
  label: "Songausschnitt raten",
  supportsAllGuess: false,
  submitAnswer(playerId, answer) {
    FMQ.app.state.quick3.answers[playerId] = answer;
    const result = FMQ.modes.guessSong.submitAnswer(playerId, answer);
    // Für die Anzeige in der Auflösung merken (Mehrgeräte-Modus).
    FMQ.app.state.quick3.lastPoints = result.points;
    return result;
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
      // Nach dem Reveal sind Abspielen und Reveal erledigt.
      ["quick3PlayBtnInline", "revealBtnInline", "quick3LenSelectInline", "quick3StartModeSelectInline"].forEach(id => { if (FMQ.$(id)) FMQ.$(id).disabled = true; });
      if (allDone && !FMQ.app.state.quick3.advanceAfterSelfCheck) {
        // Früher ging es hier sofort zum nächsten Zug. Dadurch war die
        // Auflösung weg, bevor jemand sie lesen konnte. Jetzt bleibt sie
        // stehen, zeigt die Punkte, und es geht mit "Weiter" weiter
        // (am iPad oder per Handy-Steuerung).
        FMQ.app.state.quick3.advanceAfterSelfCheck = true;
        FMQ.app.state.selfCheckPending = false;
        const pts = FMQ.app.state.quick3.lastPoints ?? 0;
        const status = FMQ.$("quick3PtsStatus");
        if (status) status.innerHTML = `<span class="ok">${FMQ.escapeHtml(me?.name || "")}: +${pts} Punkt${pts === 1 ? "" : "e"}</span>`;
        if (FMQ.$("quick3ConfirmBtn")) { FMQ.$("quick3ConfirmBtn").disabled = false; FMQ.$("quick3ConfirmBtn").textContent = "Weiter"; }
        FMQ.$("nextBtn").disabled = false;
        FMQ.renderScoreTable();
        FMQ.refreshPhoneControls?.();
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
      // Mehrgeräte: Die Auflösung erscheint groß am iPad (Overlay),
      // der Selbst-Check läuft am Handy der Person, die dran ist.
      // Alle anderen Handys sehen die Lösung ebenfalls.
      // Früher wurde hier skipReveal zurückgegeben, dadurch stand
      // der Titel nirgends.
      const t = FMQ.app.state.currentTrack;
      const me = FMQ.currentPlayer();
      const songLine = t ? `${t.name} – ${(t.artists || []).join(", ")} (${t.year})` : "";
      FMQ.app.state.selfCheckPending = true;
      FMQ.app.state.quick3.multiReveal = true;
      FMQ.app.state.quick3.lastPoints = null;
      FMQ.startMultiplayerPrompt?.({
        id: crypto.randomUUID(),
        type: "quick3SelfCheck",
        kind: "checks",
        title: "Auflösung",
        text: `Es war: ${songLine}. Was hattest du richtig?`,
        options: [{ value: "title", label: "Titel" }, { value: "artist", label: "Interpret" }, { value: "year", label: "Jahr" }],
        waitingText: `Es war: ${songLine}. ${me?.name || "Die Person am Zug"} trägt gerade ein, was richtig war.`,
        sentText: `Gespeichert. Es war: ${songLine}`,
        recipientIds: [me?.id].filter(Boolean)
      });
      setTimeout(() => FMQ.modes.quick3.renderArea(), 0);
      return { headline: "Auflösung", detail: "", remoteSelfCheck: true, waitingFor: me?.name || "" };
    }
    FMQ.app.state.selfCheckPending = true;
    return { headline: "Auflösung", detail: "Selbst-Check notwendig" };
  },
  renderRevealExtras() { FMQ.modes.guessSong.renderRevealExtras(); }
};

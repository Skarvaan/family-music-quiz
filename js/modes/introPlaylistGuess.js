window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Aus welcher Playlist ist das? Alle tippen nacheinander,
   aus wessen Playlist der Song stammt. */

FMQ.modes.introPlaylistGuess = {
  label: "Aus welcher Playlist ist das?",
  supportsAllGuess: false,
  submitAnswer(playerId, answer) {
    FMQ.app.state.introPlaylistGuess.answers[playerId] = answer;
  },
  drawUniqueTrack({ allowReset = true } = {}) {
    const candidates = [];
    for (const p of FMQ.musicPlayers()) {
      for (const t of p.tracks || []) {
        if (!t?.id || FMQ.isTrackUsed(t)) continue;
        candidates.push({ track: t, sourcePlayerId: p.id });
      }
    }
    if (!candidates.length && allowReset && FMQ.musicPlayers().some(p => (p.tracks || []).length)) {
      FMQ.resetPlayedSongHistory();
      return this.drawUniqueTrack({ allowReset: false });
    }
    const draw = FMQ.shuffle(candidates)[0] || null;
    if (draw?.track?.id) FMQ.markTrackUsed(draw.track);
    return draw;
  },
  matchingPlaylistOwnerIds(track) {
    const key = FMQ.trackIdentityKey(track);
    const owners = new Set(track?.owners || []);
    for (const p of FMQ.activePlayers()) {
      if ((p.tracks || []).some(t => FMQ.trackIdentityKey(t) === key)) owners.add(p.id);
    }
    return owners;
  },
  renderArea() {
    FMQ.$("modeAreaTitle").textContent = "Aus welcher Playlist ist das?";
    if (FMQ.isMultiDevice?.()) FMQ.setMultiplayerController?.(null);
    FMQ.renderModeLikeQuick3({
      heading: "Aus welcher Playlist ist das?",
      subtitle: "Erst hören, dann tippt jeweils die gerade angezeigte Person.",
      heroName: "",
      panelClass: "theme-playlist",
      bodyHtml: `<div class="quick3Controls quick3Controls--center"><select id="introGuessLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganzer Song</option></select><select id="introGuessStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select><button id="introGuessPlayBtn" class="big">▶️ Abspielen</button>${FMQ.isMultiDevice?.() ? `<button id="introGuessStopBtn" class="big">⏸️ Stop</button>` : ""}</div><div id="plGuessPanel" class="u-mt-md"></div><div class="row row--center u-mt-lg"><button id="introGuessRevealBtn" class="big" disabled>Reveal</button><button id="introGuessNextBtn" class="big primary" disabled>Weiter</button></div>`
    });
    FMQ.$("introGuessLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
    FMQ.$("introGuessLenSelect").onchange = () => {
      const v = FMQ.$("introGuessLenSelect").value;
      FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
    };
    const afterPlay = () => { FMQ.modes.introPlaylistGuess.renderGuessUI(); };
    FMQ.bindPlayerStartModeSelect("introGuessStartModeSelect");
    FMQ.$("introGuessPlayBtn").onclick = () => FMQ.onQuick3Play(FMQ.getBoundStartMode("introGuessStartModeSelect")).then(afterPlay).catch(e => FMQ.setGameDebug(e.stack || e.message));
    if (FMQ.$("introGuessStopBtn")) FMQ.$("introGuessStopBtn").onclick = () => FMQ.stopPlaybackNow?.().catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("introGuessRevealBtn").onclick = () => FMQ.modes.introPlaylistGuess.reveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("introGuessNextBtn").onclick = () => FMQ.onNext();
    if (FMQ.isMultiDevice?.() && (FMQ.app.state.currentTrack || FMQ.app.state.introPlaylistGuess.multiPromptStarted)) {
      setTimeout(() => FMQ.modes.introPlaylistGuess.renderGuessUI(), 0);
    }
  },
  renderGuessUI() {
    const c = FMQ.$("plGuessPanel");
    const responders = FMQ.actingPlayers();
    const answered = FMQ.app.state.introPlaylistGuess.answers || {};
    if (FMQ.isMultiDevice?.()) {
      if (!FMQ.app.state.introPlaylistGuess.multiPromptStarted) {
        FMQ.app.state.introPlaylistGuess.multiPromptStarted = true;
        FMQ.startMultiplayerPrompt?.({
          id: crypto.randomUUID(),
          type: "introPlaylistGuess",
          title: "Aus welcher Playlist?",
          text: "Wähle die Playlist, aus der der Song kommt.",
          options: FMQ.app.players.map(p => ({ value: p.id, label: p.name })),
          waitingText: "Warte auf die Auswahl aller anderen Personen!",
          sentText: "Tipp gespeichert. Bitte warten …",
          recipientIds: responders.map(p => p.id)
        });
      }
      const allDone = responders.every(p => Object.prototype.hasOwnProperty.call(answered, p.id));
      if (allDone) {
        c.innerHTML = `${FMQ.modes.bestFit.answerStatusHtml(responders.map(p => p.id), answered)}<div class="autoRevealCountdown"><div class="muted">Alle Tipps sind da.</div><div id="introAutoCountdown" class="countNum">3</div><div class="muted">Reveal startet automatisch …</div><button id="introAutoRevealNowBtn" class="big primary">Sofort Reveal</button></div>`;
        if (FMQ.$("introGuessRevealBtn")) FMQ.$("introGuessRevealBtn").disabled = false;
        FMQ.$("introAutoRevealNowBtn").onclick = () => FMQ.modes.introPlaylistGuess.reveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
        if (!FMQ.app.state.introPlaylistGuess.countdownStarted) {
          FMQ.app.state.introPlaylistGuess.countdownStarted = true;
          let n = 3;
          FMQ.app.state.introPlaylistGuess.countdownTimer = setInterval(() => {
            n--;
            if (FMQ.$("introAutoCountdown")) FMQ.$("introAutoCountdown").textContent = String(Math.max(0, n));
            if (n <= 0) {
              clearInterval(FMQ.app.state.introPlaylistGuess.countdownTimer);
              FMQ.app.state.introPlaylistGuess.countdownTimer = null;
              FMQ.modes.introPlaylistGuess.reveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
            }
          }, 1000);
        }
      } else {
        c.innerHTML = FMQ.modes.bestFit.answerStatusHtml(responders.map(p => p.id), answered);
      }
      return;
    }
    const responder = responders.find(p => !Object.prototype.hasOwnProperty.call(answered, p.id)) || null;
    if (!responder) {
      if (FMQ.app.state.introPlaylistGuess.countdownStarted) return;
      FMQ.app.state.introPlaylistGuess.countdownStarted = true;
      if (FMQ.$("introGuessRevealBtn")) FMQ.$("introGuessRevealBtn").disabled = true;
      c.innerHTML = `<div class="autoRevealCountdown"><div class="muted">Alle Tipps sind gespeichert.</div><div id="introAutoCountdown" class="countNum">3</div><div class="muted">Reveal startet automatisch …</div></div>`;
      let n = 3;
      const tick = setInterval(() => {
        n--;
        if (FMQ.$("introAutoCountdown")) FMQ.$("introAutoCountdown").textContent = String(Math.max(0, n));
        if (n <= 0) {
          clearInterval(tick);
          FMQ.modes.introPlaylistGuess.reveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
        }
      }, 700);
      return;
    }
    c.innerHTML = `<div class="socialTurnLabel">${FMQ.escapeHtml(responder.name)} tippt</div><div class="choiceGrid">${FMQ.app.players.map(p => `<button class="choiceBtn" data-owner="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div>`;
    c.querySelectorAll("[data-owner]").forEach(btn => btn.onclick = () => {
      FMQ.modes.introPlaylistGuess.submitAnswer(responder.id, btn.getAttribute("data-owner"));
      FMQ.modes.introPlaylistGuess.renderGuessUI();
    });
  },
  async reveal() {
    if (FMQ.app.state.introPlaylistGuess.countdownTimer) {
      clearInterval(FMQ.app.state.introPlaylistGuess.countdownTimer);
      FMQ.app.state.introPlaylistGuess.countdownTimer = null;
    }
    await FMQ.stopPlaybackNow?.();
    const sourceId = FMQ.app.state.currentSourcePlayerId;
    const validOwnerIds = FMQ.modes.introPlaylistGuess.matchingPlaylistOwnerIds(FMQ.app.state.currentTrack);
    let cnt = 0;
    const lines = [];
    for (const p of FMQ.activePlayers()) {
      const guessed = FMQ.app.state.introPlaylistGuess.answers[p.id];
      const ok = validOwnerIds.has(guessed);
      if (ok) { FMQ.awardPoints(p.id, 1); cnt++; }
      lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${FMQ.escapeHtml(FMQ.getPlayerName(guessed))} → <b>+${ok ? 1 : 0}</b></div>`);
    }
    const validNames = [...validOwnerIds].map(FMQ.getPlayerName);
    const ownerLabel = validNames.length > 1 ? `In diesen Playlists: ${validNames.join(" / ")}` : `In dieser Playlist: ${validNames[0] || FMQ.getPlayerName(sourceId)}`;
    const scores = FMQ.activePlayers().map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${p.score} Punkte</div></div>`).join("");
    FMQ.$("plGuessPanel").innerHTML = `<div class="socialRevealBig"><div class="playlistRevealLine ${validNames.length > 1 ? "multi" : ""}">${FMQ.escapeHtml(ownerLabel)}</div><div>${cnt} richtig</div><div class="socialPointsBlock">${lines.join("")}</div><h3>Scores</h3><div class="scoreGrid">${scores}</div></div>`;
    FMQ.renderScoreTable();
    FMQ.markFinalRoundIfNeeded();
    if (FMQ.$("introGuessRevealBtn")) FMQ.$("introGuessRevealBtn").disabled = true;
    if (FMQ.$("introGuessNextBtn")) FMQ.$("introGuessNextBtn").disabled = false;
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};

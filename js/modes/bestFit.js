window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Song A oder B. Zwei Songs, die Runde tippt, was die
   Hauptperson wählt. */

FMQ.modes.bestFit = {
  label: "Song A oder B",
  supportsAllGuess: false,
  submitVote(playerId, vote) { FMQ.submitVote?.(playerId, vote) ?? FMQ.submitVoteToSession(FMQ.app.state.social, playerId, vote); },
  submitMainAnswer(playerId, answer) { FMQ.submitMainAnswer?.(playerId, answer) ?? FMQ.submitMainAnswerToSession(FMQ.app.state.social, playerId, answer); },
  expectedVoteIds() {
    const s = FMQ.app.state.social;
    return FMQ.activePlayers().filter(p => p.id !== s?.mainPlayerId).map(p => p.id);
  },
  expectedMainIds() {
    const s = FMQ.app.state.social;
    return FMQ.activePlayers().filter(p => p.id === s?.mainPlayerId).map(p => p.id);
  },
  answerForPlayer(player, answersByPlayer) {
    if (!player || !answersByPlayer) return undefined;
    if (Object.prototype.hasOwnProperty.call(answersByPlayer, player.id)) return answersByPlayer[player.id];
    if (player.remoteId && Object.prototype.hasOwnProperty.call(answersByPlayer, player.remoteId)) return answersByPlayer[player.remoteId];
    return undefined;
  },
  answerStatusHtml(expectedIds, answersByPlayer) {
    if (!expectedIds.length) return `<div class="muted">Keine aktiven Handy-Spieler für diese Eingabe.</div>`;
    return `<div class="multiAnswerStatus">${expectedIds.map(id => {
      const player = FMQ.app.players.find(p => p.id === id || p.remoteId === id);
      const answered = player ? FMQ.modes.bestFit.answerForPlayer(player, answersByPlayer) !== undefined : Object.prototype.hasOwnProperty.call(answersByPlayer || {}, id);
      // Wer noch fehlt, bekommt laufende Equalizer-Balken statt eines
      // statischen Textes. Man sieht auf einen Blick, worauf gewartet wird.
      const anzeige = answered
        ? `<b>hat abgestimmt</b>`
        : `<b>${FMQ.eqBarsHtml()} wartet</b>`;
      return `<div class="multiAnswerRow ${answered ? "done" : "missing"}"><span>${FMQ.escapeHtml(FMQ.getPlayerName(id))}</span>${anzeige}</div>`;
    }).join("")}</div>`;
  },
  allAnswered(expectedIds, answersByPlayer) {
    return expectedIds.every(id => {
      const player = FMQ.app.players.find(p => p.id === id || p.remoteId === id);
      return player ? FMQ.modes.bestFit.answerForPlayer(player, answersByPlayer) !== undefined : Object.prototype.hasOwnProperty.call(answersByPlayer || {}, id);
    });
  },
  clearAutoAdvance() {
    const s = FMQ.app.state.social;
    if (s?.autoAdvanceTimer) clearInterval(s.autoAdvanceTimer);
    if (s) {
      s.autoAdvanceTimer = null;
      s.autoAdvanceKind = null;
      s.autoAdvanceLeft = null;
    }
  },
  scheduleAutoAdvance(kind, callback, seconds = 3, renderTick = null) {
    const s = FMQ.app.state.social;
    if (!s || s.autoAdvanceKind === kind) return;
    FMQ.modes.bestFit.clearAutoAdvance();
    s.autoAdvanceKind = kind;
    s.autoAdvanceLeft = seconds;
    s.autoAdvanceTimer = setInterval(() => {
      const current = FMQ.app.state.social;
      if (!current || current !== s || current.autoAdvanceKind !== kind) {
        clearInterval(s.autoAdvanceTimer);
        return;
      }
      s.autoAdvanceLeft--;
      if (s.autoAdvanceLeft <= 0) {
        FMQ.modes.bestFit.clearAutoAdvance();
        callback();
      } else if (typeof renderTick === "function") {
        renderTick();
      }
    }, 1000);
  },
  countdownHtml(text) {
    const s = FMQ.app.state.social;
    if (!s?.autoAdvanceLeft) return "";
    return `<div class="autoRevealCountdown compact"><div class="muted">${FMQ.escapeHtml(text)}</div><div class="countNum">${s.autoAdvanceLeft}</div></div>`;
  },
  startVotePromptOnce() {
    const s = FMQ.app.state.social;
    if (s.multiVotePromptStarted) return;
    s.multiVotePromptStarted = true;
    s.multiVotePromptId = crypto.randomUUID();
    FMQ.startMultiplayerPrompt?.({
      id: s.multiVotePromptId,
      type: "bestFitVote",
      title: "Song A oder B?",
      text: `Welchen Song findet ${FMQ.getPlayerName(s.mainPlayerId)} besser? Tippe, aber ${FMQ.getPlayerName(s.mainPlayerId)} löst später selbst auf.`,
      options: [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }],
      waitingText: "Warte auf die Auswahl aller anderen Personen!",
      sentText: "Antwort gespeichert. Warte auf die Auswahl aller anderen Personen!",
      recipientIds: FMQ.modes.bestFit.expectedVoteIds()
    });
  },
  startMainPromptOnce() {
    const s = FMQ.app.state.social;
    if (s.multiMainPromptStarted) return;
    s.multiMainPromptStarted = true;
    s.multiMainPromptId = crypto.randomUUID();
    FMQ.startMultiplayerPrompt?.({
      id: s.multiMainPromptId,
      type: "bestFitMain",
      title: "Deine echte Antwort",
      text: `Was findest du besser? Erzähle gern kurz, warum!`,
      options: [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }],
      waitingText: `Warte auf die echte Antwort von ${FMQ.getPlayerName(s.mainPlayerId)} …`,
      sentText: "Echte Antwort gespeichert. Reveal startet gleich …",
      recipientIds: FMQ.modes.bestFit.expectedMainIds()
    });
  },
  finishReveal() {
    const s = FMQ.app.state.social;
    if (!s || s.revealed) return;
    s.revealed = true;
    FMQ.modes.bestFit.clearAutoAdvance();
    const mainName = FMQ.getPlayerName(s.mainPlayerId);
    const truth = s.mainAnswer || "A";
    const lines = [];
    for (const p of FMQ.activePlayers()) {
      if (p.id === s.mainPlayerId) continue;
      const guessed = FMQ.modes.bestFit.answerForPlayer(p, s.answersByPlayer);
      const pts = guessed === truth ? 1 : 0;
      if (pts) FMQ.awardPoints(p.id, pts);
      lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${guessed || "-"} → <b>+${pts}</b></div>`);
    }
    FMQ.stopPlaybackNow?.();
    FMQ.revealMultiplayerPrompt?.({ truth, mode: "bestFit" });
    FMQ.renderModeLikeQuick3({
      heading: `Auflösung: ${mainName}`,
      subtitle: "",
      heroName: "",
      panelClass: "theme-playlist",
      bodyHtml: `<div class="socialRevealBig"><div class="socialTruthLine">${mainName} wählt: <b>Song ${truth}</b></div><div class="muted" >Richtiger Tipp = +1 Punkt</div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row row--center"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
    });
    FMQ.app.state.social = null;
    FMQ.renderScoreTable();
    FMQ.renderMultiplayerPanel?.();
    FMQ.markFinalRoundIfNeeded();
    FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
  },
  getClipSeconds() {
    return FMQ.app.state.bestFitClipSeconds || "20";
  },
  transportHtml() {
    return `<div class="abTransportWrap bestFitTransport"><div class="bestFitTransportSettings"><label>Hörzeit<select id="bestFitClipSecondsSelect"><option value="20">20 Sekunden</option><option value="30">30 Sekunden</option><option value="full">Ganzer Song</option></select></label><label>Startpunkt<select id="bestFitStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select></label></div><div class="abTransport"><button id="playAFromStartBtn" class="big playSongBtn">🅰️ Song A abspielen</button><button id="playBFromStartBtn" class="big playSongBtn">🅱️ Song B abspielen</button><button id="bestFitStopBtn" class="big">⏸️ Stop</button></div></div>`;
  },
  bindTransport(trackA, trackB) {
    FMQ.bindPlayerStartModeSelect("bestFitStartModeSelect");
    const clipSelect = FMQ.$("bestFitClipSecondsSelect");
    if (clipSelect) {
      clipSelect.value = FMQ.modes.bestFit.getClipSeconds();
      clipSelect.onchange = () => { FMQ.app.state.bestFitClipSeconds = clipSelect.value; };
    }
    const play = async track => {
      const mode = FMQ.getBoundStartMode("bestFitStartModeSelect");
      const startMs = FMQ.getStoredStartMs(track, `bestFit:${track.id}`, mode);
      await FMQ.playTrackUri(track.uri, { positionMs: startMs });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = null;
      const secondsRaw = FMQ.modes.bestFit.getClipSeconds();
      if (secondsRaw !== "full") FMQ.app.state.playTimer = setTimeout(() => FMQ.pausePlayback().catch(() => {}), parseInt(secondsRaw, 10) * 1000);
    };
    FMQ.$("playAFromStartBtn").onclick = () => play(trackA).catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("playBFromStartBtn").onclick = () => play(trackB).catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("bestFitStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
  },
  choiceHtml(attr, fallback = false, prompt = "Was findest du besser?", sub = "Erzähl gerne, warum!") {
    const prefix = fallback ? "Fallback: " : "";
    return `<div class="bestFitChoicePanel"><div class="choicePromptBig">${FMQ.escapeHtml(prompt)} <span>${FMQ.escapeHtml(sub)}</span></div><div class="choiceGrid choiceGridBig bestFitPickGrid"><button class="choiceBtn bestFitPickBtn" ${attr}="A">${prefix}Song A wählen</button><button class="choiceBtn bestFitPickBtn" ${attr}="B">${prefix}Song B wählen</button></div></div>`;
  },
  async newSongs() {
    try { await FMQ.pausePlayback(); } catch {}
    clearTimeout(FMQ.app.state.playTimer);
    FMQ.app.state.playTimer = null;
    const s = FMQ.app.state.social;
    FMQ.app.state.bestFitTracks = null;
    FMQ.app.state.currentTrack = null;
    if (s) {
      s.phase = "listen";
      s.answersByPlayer = {};
      s.votes = {};
      s.mainAnswers = {};
      s.mainAnswer = null;
      s.multiVotePromptStarted = false;
      s.multiMainPromptStarted = false;
      s.autoAdvanceKind = null;
    }
    FMQ.resetMultiplayerRound?.();
    await FMQ.prepareTrackForTurn();
    FMQ.modes.bestFit.renderArea();
  },
  renderArea() {
    FMQ.$("modeAreaTitle").textContent = "Song A oder Song B";
    if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "bestFit") FMQ.initSocialRound({ modeId: "bestFit", startPhase: "listen" });
    const s = FMQ.app.state.social;
    const mainName = FMQ.getPlayerName(s.mainPlayerId);
    if (FMQ.isMultiDevice?.()) FMQ.ensureMultiplayerController?.(s.mainPlayerId);
    const trackA = FMQ.app.state.bestFitTracks?.a;
    const trackB = FMQ.app.state.bestFitTracks?.b;
    if (s.phase === "listen") {
      if (!trackA || !trackB) {
        FMQ.renderModeLikeQuick3({ heading: `Song A/B wird vorbereitet …`, subtitle: "", heroName: "", panelClass: "theme-playlist" });
        if (!s.loading) {
          s.loading = true;
          FMQ.prepareTrackForTurn()
            .then(() => { s.loading = false; FMQ.modes.bestFit.renderArea(); })
            .catch(e => FMQ.setGameDebug(e.stack || e.message));
        }
        return;
      }
      FMQ.renderModeLikeQuick3({
        heading: `Welchen Song findet "${mainName}" besser?`,
        subtitle: "",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="bestFitStableArea">${FMQ.modes.bestFit.transportHtml()}<div class="row row--center u-mt-md"><button id="bestFitNewSongsBtn" class="big secondary">🔄 Andere Songs ziehen</button><button id="bestFitContinueBtn" class="primary big">Weiter zur Tipp-Runde</button></div></div>`
      });
      FMQ.modes.bestFit.bindTransport(trackA, trackB);
      FMQ.$("bestFitNewSongsBtn").onclick = () => FMQ.modes.bestFit.newSongs().catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("bestFitContinueBtn").onclick = () => {
        FMQ.modes.bestFit.clearAutoAdvance();
        s.phase = "othersGuessing";
        if (FMQ.isMultiDevice?.()) FMQ.modes.bestFit.startVotePromptOnce();
        FMQ.modes.bestFit.renderArea();
      };
    } else if (s.phase === "othersGuessing") {
      if (FMQ.isMultiDevice?.()) {
        FMQ.modes.bestFit.startVotePromptOnce();
        const expectedIds = FMQ.modes.bestFit.expectedVoteIds();
        const answerMap = { ...s.answersByPlayer };
        const allDone = FMQ.modes.bestFit.allAnswered(expectedIds, answerMap);
        if (allDone) {
          FMQ.modes.bestFit.scheduleAutoAdvance("bestFitToMain", () => {
            s.phase = "mainAnswer";
            FMQ.resetMultiplayerRound?.();
            FMQ.modes.bestFit.renderArea();
          }, 3, () => FMQ.modes.bestFit.renderArea());
        } else {
          FMQ.modes.bestFit.clearAutoAdvance();
        }
        FMQ.renderModeLikeQuick3({
          heading: allDone ? "Alle Tipps sind da" : "Handy-Tipps laufen …",
          subtitle: `Was glaubst du? Welchen Song findet ${mainName} besser?`,
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="bestFitStableArea">${FMQ.modes.bestFit.transportHtml()}${FMQ.modes.bestFit.answerStatusHtml(expectedIds, answerMap)}${allDone ? FMQ.modes.bestFit.countdownHtml("Weiter zur echten Antwort in …") : ""}<div class="row row--center"><button id="bestFitNewSongsBtn" class="big secondary">🔄 Andere Songs ziehen</button></div></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
        FMQ.$("bestFitNewSongsBtn").onclick = () => FMQ.modes.bestFit.newSongs().catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.renderMultiplayerPanel?.();
        return;
      }
      const pid = FMQ.getSocialResponderId();
      if (!pid) {
        s.phase = "mainAnswer";
        FMQ.modes.bestFit.renderArea();
        return;
      }
      FMQ.renderModeLikeQuick3({
        heading: "Tipp-Runde",
        subtitle: "",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="bestFitStableArea"><div class="socialTurnLabel">${FMQ.escapeHtml(FMQ.getPlayerName(pid))} ist dran</div>${FMQ.modes.bestFit.transportHtml()}${FMQ.modes.bestFit.choiceHtml("data-pick", false, `Was glaubst du? Welchen Song findet ${mainName} besser?`, "Tippe auf deinen Favoriten.")}<div class="row row--center"><button id="bestFitNewSongsBtn" class="big secondary">🔄 Andere Songs ziehen</button><button id="bfNextBtn" class="big primary" disabled>Weiter</button></div></div>`
      });
      FMQ.modes.bestFit.bindTransport(trackA, trackB);
      FMQ.$("bestFitNewSongsBtn").onclick = () => FMQ.modes.bestFit.newSongs().catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("modeArea").querySelectorAll("[data-pick]").forEach(btn => btn.onclick = () => {
        FMQ.$("modeArea").querySelectorAll("[data-pick]").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        FMQ.modes.bestFit.submitVote(pid, btn.getAttribute("data-pick"));
        FMQ.$("bfNextBtn").disabled = false;
      });
      FMQ.$("bfNextBtn").onclick = () => {
        s.currentResponderIndex++;
        s.phase = s.currentResponderIndex >= s.respondingPlayersQueue.length ? "mainAnswer" : "othersGuessing";
        FMQ.modes.bestFit.renderArea();
      };
    } else if (s.phase === "mainAnswer") {
      if (FMQ.isMultiDevice?.()) {
        FMQ.modes.bestFit.startMainPromptOnce();
        const expectedIds = FMQ.modes.bestFit.expectedMainIds();
        const hasMainAnswer = !!s.mainAnswer;
        if (hasMainAnswer) FMQ.modes.bestFit.scheduleAutoAdvance("bestFitReveal", () => FMQ.modes.bestFit.finishReveal(), 3, () => FMQ.modes.bestFit.renderArea());
        else FMQ.modes.bestFit.clearAutoAdvance();
        FMQ.renderModeLikeQuick3({
          heading: `${mainName}, was findest du besser?`,
          subtitle: "Erzähl gerne, warum – dann wähle deinen Favoriten.",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="bestFitStableArea">${FMQ.modes.bestFit.transportHtml()}${FMQ.modes.bestFit.answerStatusHtml(expectedIds, s.mainAnswer ? { [s.mainPlayerId]: s.mainAnswer } : {})}${FMQ.modes.bestFit.choiceHtml("data-main-pick", true)}${hasMainAnswer ? FMQ.modes.bestFit.countdownHtml("Echte Antwort ist da. Reveal in …") : ""}<div class="row row--center"><button id="bestFitNewSongsBtn" class="big secondary">🔄 Andere Songs ziehen</button><button id="bfRevealBtn" class="big primary" ${hasMainAnswer ? "" : "disabled"}>Sofort Reveal</button></div></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
        FMQ.$("bestFitNewSongsBtn").onclick = () => FMQ.modes.bestFit.newSongs().catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.modes.bestFit.submitMainAnswer(s.mainPlayerId, btn.getAttribute("data-main-pick"));
          FMQ.$("bfRevealBtn").disabled = false;
        });
        FMQ.$("bfRevealBtn").onclick = () => FMQ.modes.bestFit.finishReveal();
        FMQ.renderMultiplayerPanel?.();
        return;
      }
      FMQ.renderModeLikeQuick3({
        heading: `${mainName}, was findest du besser?`,
        subtitle: "Erzähl gerne, warum – dann wähle deinen Favoriten.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="bestFitStableArea">${FMQ.modes.bestFit.transportHtml()}${FMQ.modes.bestFit.choiceHtml("data-main-pick")}<div class="row row--center"><button id="bestFitNewSongsBtn" class="big secondary">🔄 Andere Songs ziehen</button><button id="bfRevealBtn" class="big primary" disabled>Reveal</button></div></div>`
      });
      FMQ.modes.bestFit.bindTransport(trackA, trackB);
      FMQ.$("bestFitNewSongsBtn").onclick = () => FMQ.modes.bestFit.newSongs().catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(btn => btn.onclick = () => {
        FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        FMQ.modes.bestFit.submitMainAnswer(s.mainPlayerId, btn.getAttribute("data-main-pick"));
        FMQ.$("bfRevealBtn").disabled = false;
      });
      FMQ.$("bfRevealBtn").onclick = () => FMQ.modes.bestFit.finishReveal();
    }
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};

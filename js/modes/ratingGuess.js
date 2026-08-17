window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Song-Bewertung einschätzen. Die anderen raten, welche Note
   die Hauptperson dem Song gibt. */

FMQ.modes.ratingGuess = {
  label: "Song-Bewertung einschätzen",
  supportsAllGuess: false,
  submitVote(playerId, vote) { FMQ.submitVote?.(playerId, vote) ?? FMQ.submitVoteToSession(FMQ.app.state.social, playerId, vote); },
  submitMainAnswer(playerId, answer) { FMQ.submitMainAnswer?.(playerId, answer) ?? FMQ.submitMainAnswerToSession(FMQ.app.state.social, playerId, answer); },
  transportHtml(phase = "guess") {
    const label = phase === "listen" ? "▶️ Song hören" : "▶️ Weiter";
    // Startet deaktiviert: der Song wird asynchron gezogen. Ein Klick in
    // dieser Lücke hätte vorher stumm gar nichts getan.
    return `<div class="row row--center ratingTransportRow"><select id="ratingStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select><button id="ratingPlayResumeBtn" class="big" disabled>${label}</button><button id="ratingStopBtn" class="big">⏸️ Stop</button></div>`;
  },
  bindTransport(phase = "guess") {
    const t = FMQ.app.state.currentTrack;
    if (!t) return;
    FMQ.bindPlayerStartModeSelect("ratingStartModeSelect");
    const play = () => {
      const mode = FMQ.getBoundStartMode("ratingStartModeSelect");
      const startMs = FMQ.getStoredStartMs(t, "rating", mode);
      return FMQ.playTrackUri(t.uri, { positionMs: startMs });
    };
    FMQ.$("ratingPlayResumeBtn").textContent = phase === "listen" ? "▶️ Song hören" : "▶️ Weiter";
    FMQ.$("ratingPlayResumeBtn").disabled = false;
    FMQ.$("ratingPlayResumeBtn").onclick = () => play().catch(() => {});
    FMQ.$("ratingStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
  },
  renderArea() {
    FMQ.$("modeAreaTitle").textContent = "Wie gut findet … diesen Song?";
    if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "ratingGuess") FMQ.initSocialRound({ modeId: "ratingGuess", startPhase: "listen" });
    const s = FMQ.app.state.social;
    const mainName = FMQ.getPlayerName(s.mainPlayerId);
    if (FMQ.isMultiDevice?.()) FMQ.ensureMultiplayerController?.(s.mainPlayerId);
    if (s.phase === "listen") {
      FMQ.renderModeLikeQuick3({
        heading: `Wie findet "${mainName}" diesen Song?`,
        subtitle: "",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("listen")}<div class="row row--center"><button id="ratingListenNextBtn" class="big primary">Weiter zu den Einschätzungen</button></div>`
      });
      if (!FMQ.app.state.currentTrack) {
        FMQ.prepareTrackForTurn().then(() => FMQ.modes.ratingGuess.bindTransport("listen")).catch(e => FMQ.setGameDebug(e.stack || e.message));
      } else {
        FMQ.modes.ratingGuess.bindTransport("listen");
      }
      FMQ.$("ratingListenNextBtn").onclick = async () => {
        if (!FMQ.app.state.currentTrack) await FMQ.prepareTrackForTurn();
        s.phase = "othersGuessing";
        FMQ.modes.ratingGuess.renderArea();
      };
    } else if (s.phase === "othersGuessing") {
      if (FMQ.isMultiDevice?.()) {
        const expectedIds = FMQ.activePlayers().filter(p => p.id !== s.mainPlayerId).map(p => p.id);
        if (!s.multiPromptStarted) {
          s.multiPromptStarted = true;
          FMQ.startMultiplayerPrompt?.({
            id: crypto.randomUUID(),
            type: "ratingGuessAll",
            title: `${mainName}: Bewertung schätzen`,
            text: `Welche Bewertung gibt ${mainName} dem Song?`,
            options: [1,2,3,4,5,6,7,8,9,10].map(v => ({ value: String(v), label: String(v) })),
            waitingText: `${mainName} gibt gleich die echte Bewertung ab.`,
            sentText: "Tipp gespeichert. Bitte warten …",
            recipientIds: expectedIds
          });
        }
        const answerMap = { ...s.answersByPlayer };
        const allDone = expectedIds.every(id => Object.prototype.hasOwnProperty.call(answerMap, id));
        if (allDone) {
          FMQ.modes.bestFit.clearAutoAdvance();
          s.phase = "mainAnswer";
          FMQ.resetMultiplayerRound?.();
          FMQ.modes.ratingGuess.renderArea();
          return;
        }
        FMQ.modes.bestFit.clearAutoAdvance();
        FMQ.renderModeLikeQuick3({ heading: `Wie findet ${mainName} diesen Song?`, subtitle: "Alle außer der Person selbst tippen gleichzeitig am Handy.", heroName: "", panelClass: "theme-playlist", bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("guess")}${FMQ.modes.bestFit.answerStatusHtml(expectedIds, answerMap)}` });
        FMQ.modes.ratingGuess.bindTransport();
        return;
      }
      const pid = FMQ.getSocialResponderId();
      if (!pid) {
        s.phase = "mainAnswer";
        FMQ.modes.ratingGuess.renderArea();
        return;
      }
      const responder = FMQ.getPlayerName(pid);
      FMQ.renderModeLikeQuick3({
        heading: `Wie findet "${mainName}" diesen Song?`,
        subtitle: `Wie bewertet ${mainName} diesen Song (1-10)?`,
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(responder)} ist dran</div>${FMQ.modes.ratingGuess.transportHtml("guess")}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-rate="${v}">${v}</button>`).join("")}</div><div class="row row--center"><button id="ratingNextBtn" class="big primary" disabled>Weiter</button></div>`
      });
      FMQ.modes.ratingGuess.bindTransport();
      FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(btn => btn.onclick = () => {
        FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        FMQ.modes.ratingGuess.submitVote(pid, parseInt(btn.getAttribute("data-rate"), 10));
        FMQ.$("ratingNextBtn").disabled = false;
      });
      FMQ.$("ratingNextBtn").onclick = async () => {
        try { await FMQ.socialPlaybackPause({ key: "rating" }); } catch {}
        s.currentResponderIndex++;
        s.phase = s.currentResponderIndex >= s.respondingPlayersQueue.length ? "mainAnswer" : "othersGuessing";
        FMQ.modes.ratingGuess.renderArea();
      };
    } else if (s.phase === "mainAnswer") {
      if (FMQ.isMultiDevice?.()) {
        if (!s.multiMainPromptStarted) {
          s.multiMainPromptStarted = true;
          FMQ.startMultiplayerPrompt?.({
            id: crypto.randomUUID(),
            type: "ratingGuessMain",
            title: "Deine echte Bewertung",
            text: `${mainName}, wie gut findest du diesen Song wirklich?`,
            options: [1,2,3,4,5,6,7,8,9,10].map(v => ({ value: String(v), label: String(v) })),
            waitingText: `Warte auf die echte Bewertung von ${mainName}.`,
            sentText: "Bewertung gespeichert. Reveal startet gleich …",
            recipientIds: [s.mainPlayerId]
          });
        }
        const hasMainAnswer = !!s.mainAnswer;
        FMQ.modes.bestFit.clearAutoAdvance();
        FMQ.renderModeLikeQuick3({
          heading: `${mainName}, wie gut findest du den Song wirklich?`,
          subtitle: "Sag gern kurz dazu, warum du so bewertest.",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("guess")}${FMQ.modes.bestFit.answerStatusHtml([s.mainPlayerId], s.mainAnswer ? { [s.mainPlayerId]: s.mainAnswer } : {})}<div class="choiceGrid hostFallbackVoteGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn ${String(s.mainAnswer || "") === String(v) ? "selected" : ""}" data-main-rate="${v}">${v}</button>`).join("")}</div><div class="muted u-text-center">${hasMainAnswer ? "Bewertung ist gespeichert. Reveal kann gestartet werden." : `Owner kann am Handy oder hier am Host-Gerät bewerten.`}</div><div class="row row--center"><button id="ratingRevealBtn" class="big primary" ${hasMainAnswer ? "" : "disabled"}>Reveal</button></div>`
        });
        FMQ.modes.ratingGuess.bindTransport();
        FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.modes.ratingGuess.submitMainAnswer(s.mainPlayerId, parseInt(btn.getAttribute("data-main-rate"), 10));
          FMQ.$("ratingRevealBtn").disabled = false;
          FMQ.renderMultiplayerPanel?.();
          setTimeout(() => FMQ.$("ratingRevealBtn")?.click(), 0);
        });
        if (FMQ.$("ratingRevealBtn")) FMQ.$("ratingRevealBtn").onclick = async () => {
          await FMQ.stopPlaybackNow?.();
          const truth = Math.max(1, Math.min(10, parseInt(String(s.mainAnswer || "0"), 10)));
          const lines = [];
          for (const p of FMQ.activePlayers()) {
            if (p.id === s.mainPlayerId) continue;
            const val = parseInt(String(FMQ.modes.bestFit.answerForPlayer(p, s.answersByPlayer) || 0), 10);
            const diff = Math.abs(truth - (val || 0));
            const pts = FMQ.app.config.ratingScoring === "light" ? (diff === 0 ? 2 : diff === 1 ? 1 : 0) : (diff === 0 ? 3 : diff === 1 ? 2 : diff === 2 ? 1 : 0);
            FMQ.awardPoints(p.id, pts);
            lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${val || "-"} → <b>+${pts}</b></div>`);
          }
          const t = FMQ.app.state.currentTrack;
          FMQ.renderModeLikeQuick3({ heading: `Auflösung: ${mainName}`, subtitle: "", heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="socialRevealBig ratingRevealResult"><div class="ratingTruthBadge">${truth}/10</div><div><b>${FMQ.escapeHtml(t.name)}</b> · ${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</div><div class="socialTruthLine">${mainName} sagte: <b>${truth}/10</b></div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row row--center"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>` });
          FMQ.app.state.social = null; FMQ.renderScoreTable(); FMQ.markFinalRoundIfNeeded(); FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
        };
        return;
      }
      FMQ.renderModeLikeQuick3({
        heading: `${mainName}, wie gut findest du den Song wirklich?`,
        subtitle: "",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("guess")}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-main-rate="${v}">${v}</button>`).join("")}</div><div class="row row--center"><button id="ratingRevealBtn" class="big primary" disabled>Reveal</button></div>`
      });
      FMQ.modes.ratingGuess.bindTransport();
      FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(btn => btn.onclick = () => {
        FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        FMQ.modes.ratingGuess.submitMainAnswer(s.mainPlayerId, parseInt(btn.getAttribute("data-main-rate"), 10));
        FMQ.$("ratingRevealBtn").disabled = false;
      });
      FMQ.$("ratingRevealBtn").onclick = async () => {
        await FMQ.stopPlaybackNow?.();
        const truth = Math.max(1, Math.min(10, parseInt(String(s.mainAnswer || "0"), 10)));
        const lines = [];
        for (const p of FMQ.activePlayers()) {
          if (p.id === s.mainPlayerId) continue;
          const val = parseInt(String(s.answersByPlayer?.[p.id] || 0), 10);
          const diff = Math.abs(truth - (val || 0));
          const pts = FMQ.app.config.ratingScoring === "light"
            ? (diff === 0 ? 2 : diff === 1 ? 1 : 0)
            : (diff === 0 ? 3 : diff === 1 ? 2 : diff === 2 ? 1 : 0);
          FMQ.awardPoints(p.id, pts);
          lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${val || "-"} → <b>+${pts}</b></div>`);
        }
        const t = FMQ.app.state.currentTrack;
        FMQ.renderModeLikeQuick3({
          heading: `Auflösung: ${mainName}`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="socialRevealBig"><div><b>${FMQ.escapeHtml(t.name)}</b> · ${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</div><div class="socialTruthLine">"${mainName}" sagte: <b>${truth}/10</b></div><div class="muted" >Punktesystem: ${FMQ.app.config.ratingScoring === "light" ? "Light (2/1/0)" : "Klassisch (3/2/1/0)"}</div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row row--center"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
        });
        FMQ.app.state.social = null;
        FMQ.renderScoreTable();
        FMQ.markFinalRoundIfNeeded();
        FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
      };
    }
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};

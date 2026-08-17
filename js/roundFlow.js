window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Rundenlogik: auflösen, weiterschalten, Spielende und Rückkehr ins Menü. */

FMQ.markFinalRoundIfNeeded = () => {
  if (FMQ.app.config.endType !== "points") return;
  const hasReached = FMQ.app.players.some(p => p.score >= FMQ.app.config.targetPoints);
  if (hasReached && !FMQ.app.state.finalRound.pending) {
    FMQ.app.state.finalRound.pending = true;
    FMQ.app.state.finalRound.roundNumber = FMQ.app.state.round;
  }
};

FMQ.checkFinishAfterNext = () => {
  if (FMQ.app.config.endType !== "points") return null;
  if (!FMQ.app.state.finalRound.pending) return null;
  if (FMQ.app.state.round <= FMQ.app.state.finalRound.roundNumber) return null;
  return [...FMQ.app.players].sort((a, b) => b.score - a.score)[0] || null;
};

FMQ.onReveal = async () => {
  if (!FMQ.app.state.currentTrack) return;
  await FMQ.stopPlaybackNow();
  FMQ.$("playToggleBtn").disabled = true;

  const t = FMQ.app.state.currentTrack;
  const mode = FMQ.app.config.mode;
  const res = FMQ.modes[mode].onReveal();
  if (res?.skipReveal) {
    FMQ.$("revealBox").style.display = "none";
    FMQ.$("revealText").innerHTML = "";
    FMQ.$("revealExtra").innerHTML = "";
    FMQ.$("revealBtn").disabled = !!res.disableReveal;
    FMQ.$("nextBtn").disabled = true;
    FMQ.renderScoreTable();
    return;
  }
  if (FMQ.app.state.speed?.timer) clearInterval(FMQ.app.state.speed.timer);
  FMQ.$("revealBox").style.display = "block";
  FMQ.$("revealText").innerHTML = `<div class="songRevealBlock"><div class="songRevealEyebrow">${FMQ.escapeHtml(res.headline)}</div><div class="songRevealTitle">${FMQ.escapeHtml(t.name)}</div><div class="songRevealArtist">${FMQ.escapeHtml(t.artists.join(", "))}</div><div class="songRevealYear">${t.year}</div><div class="muted">${FMQ.escapeHtml(mode === "introPlaylistGuess" ? `Song ist in Playlist: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}` : `Quelle: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}`)}</div><div class="muted">${FMQ.escapeHtml(res.detail || "")}</div></div>`;

  if (mode === "guessSong") FMQ.modes.guessSong.renderRevealExtras();

  if (mode === "quick3") {
    FMQ.$("revealBox").style.display = "none";
    FMQ.$("quick3RevealContent").innerHTML = `
      <div class="songRevealBlock">
        <div class="songRevealEyebrow">${FMQ.escapeHtml(res.headline)}</div>
        <div class="songRevealTitle">${FMQ.escapeHtml(t.name)}</div>
        <div class="songRevealArtist">${FMQ.escapeHtml(t.artists.join(", "))}</div>
        <div class="songRevealYear">${t.year}</div>
      </div>
    `;
    FMQ.$("quick3ChkTitle").checked = false;
    FMQ.$("quick3ChkArtist").checked = false;
    FMQ.$("quick3ChkYear").checked = false;
    FMQ.$("quick3PtsStatus").textContent = "";
    FMQ.$("quick3ConfirmBtn").disabled = false;
    FMQ.$("quick3RevealOverlay").classList.add("show");
    if (FMQ.$("quick3PlayBtnInline")) FMQ.$("quick3PlayBtnInline").disabled = true;
    if (FMQ.$("quick3StartModeSelectInline")) FMQ.$("quick3StartModeSelectInline").disabled = true;
    if (FMQ.$("quick3LenSelectInline")) FMQ.$("quick3LenSelectInline").disabled = true;
  }

  FMQ.renderScoreTable();
  FMQ.markFinalRoundIfNeeded();
  FMQ.$("revealBtn").disabled = true;
  FMQ.$("nextBtn").disabled = FMQ.app.state.selfCheckPending;
  FMQ.applyAccessibilityLabels();
};

FMQ.finishIntroSession = () => {
  FMQ.applyPendingPlayerActivity({ gameEnd: true });
  FMQ.showScreen("screenWinner");
  if (FMQ.$("winnerTitle")) FMQ.$("winnerTitle").textContent = "Kennenlernen";
  FMQ.$("winnerHeadline").textContent = "Zurück zum Start";
  FMQ.$("winnerSub").textContent = "Keine Punktewertung.";
  if (FMQ.$("finalScoreWrap")) FMQ.$("finalScoreWrap").style.display = "none";
  FMQ.$("finalScoreTable").innerHTML = "";
};

FMQ.finishGame = (winnerPlayer, reason) => {
  FMQ.applyPendingPlayerActivity({ gameEnd: true });
  FMQ.showScreen("screenWinner");
  if (FMQ.$("winnerTitle")) FMQ.$("winnerTitle").textContent = "🏆 Gewinner";
  if (FMQ.$("finalScoreWrap")) FMQ.$("finalScoreWrap").style.display = "";
  FMQ.$("winnerHeadline").textContent = winnerPlayer ? `${winnerPlayer.name} gewinnt!` : "Spiel beendet";
  FMQ.$("winnerSub").textContent = reason || "";
  FMQ.$("finalScoreTable").innerHTML = [...FMQ.app.players]
    .sort((a, b) => b.score - a.score)
    .map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${p.score} Punkte</div></div>`)
    .join("");
};

FMQ.onNext = async () => {
  if (!FMQ.isSocialMode(FMQ.app.config.mode)) await FMQ.stopPlaybackNow();
  const roundBeforeNext = FMQ.app.state.round;
  FMQ.applyPendingPlayerActivity();
  if (FMQ.app.config.endType === "rounds" && FMQ.app.state.round > FMQ.app.config.targetRounds) {
    if (FMQ.app.config.mode === "introFirst3") { FMQ.finishIntroSession(); return; }
    if (FMQ.app.config.mode === "rankingList") { FMQ.modes.rankingList.renderFinal(); return; }
    FMQ.finishGame(FMQ.getWinnerByScore(), `${FMQ.app.config.targetRounds} Runden sind gespielt.`);
    return;
  }
  const winner = FMQ.checkFinishAfterNext();
  if (winner) {
    FMQ.finishGame(winner, `Ziel ${FMQ.getEndTargetText()} wurde in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  FMQ.advanceTurn();
  const roundEnded = FMQ.app.state.round !== roundBeforeNext;
  if (roundEnded) FMQ.applyPendingPlayerActivity({ roundEnd: true });

  const winnerAfterAdvance = FMQ.checkFinishAfterNext();
  if (winnerAfterAdvance) {
    FMQ.finishGame(winnerAfterAdvance, `Ziel ${FMQ.getEndTargetText()} wurde in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  if (FMQ.app.config.endType === "rounds" && FMQ.app.state.round > FMQ.app.config.targetRounds) {
    if (FMQ.app.config.mode === "introFirst3") { FMQ.finishIntroSession(); return; }
    if (FMQ.app.config.mode === "rankingList") { FMQ.modes.rankingList.renderFinal(); return; }
    FMQ.finishGame(FMQ.getWinnerByScore(), `${FMQ.app.config.targetRounds} Runden sind gespielt.`);
    return;
  }

  FMQ.resetTurnUI();
};

FMQ.quitToMenu = async () => {
  try { await FMQ.pausePlayback(); } catch {}
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.$("quick3RevealOverlay").classList.remove("show");
  FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.app.state.setupStep = 3;
  FMQ.showScreen("screenSetup");
  FMQ.refreshPlaylistDropdowns();
  FMQ.resetMultiplayerRound?.();
  FMQ.renderSetupWizard();
  FMQ.setGameDebug("");
};

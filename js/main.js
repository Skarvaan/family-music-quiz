window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: main.js orchestriert Ablauf/Events und verbindet alle Module.

// =========================================================
// ACCESSIBILITY-HELPER
// =========================================================
FMQ.applyAccessibilityLabels = () => {
  document.querySelectorAll("button, select, input").forEach(el => {
    if (el.getAttribute("aria-label")) return;
    const id = el.id || "";
    const txt = (el.textContent || "").trim();
    const labelFromFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : "";
    const wrappedLabel = el.closest("label")?.textContent?.trim() || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const fallback = labelFromFor || wrappedLabel || placeholder || txt || id || "Interaktives Element";
    el.setAttribute("aria-label", fallback);
  });
};

FMQ.renderPlayerSwitchPanel = () => {
  const panel = FMQ.$("playerSwitchPanel");
  if (!panel) return;
  const mode = FMQ.app.state.pauseApplyMode || "next";
  panel.innerHTML = `
    <div class="playerSwitchMode">
      <label for="pauseApplyModeSelect"><b>Pause anwenden</b></label>
      <select id="pauseApplyModeSelect">
        <option value="next" ${mode === "next" ? "selected" : ""}>Bei Weiter / nächstem Einsatz</option>
        <option value="round" ${mode === "round" ? "selected" : ""}>Erst am Rundenende</option>
        <option value="game" ${mode === "game" ? "selected" : ""}>Erst nach Spielende</option>
      </select>
    </div>
    ${FMQ.app.players.map(p => {
      const checked = (typeof p.pendingActive === "boolean" ? p.pendingActive : p.active !== false);
      const pending = typeof p.pendingActive === "boolean" && p.pendingActive !== (p.active !== false);
      return `
        <label class="playerSwitchRow ${pending ? "pending" : ""}">
          <span>${FMQ.escapeHtml(p.name)}${pending ? ` <small>(vorgemerkt)</small>` : ""}</span>
          <input type="checkbox" data-role="active-switch" data-pid="${p.id}" ${checked ? "checked" : ""}>
        </label>
      `;
    }).join("")}
  `;
  const modeSelect = FMQ.$("pauseApplyModeSelect");
  if (modeSelect) modeSelect.onchange = () => { FMQ.app.state.pauseApplyMode = modeSelect.value; FMQ.renderPlayerSwitchPanel(); };
  panel.querySelectorAll('input[data-role="active-switch"]').forEach(inp => inp.onchange = () => {
    const pid = inp.getAttribute("data-pid");
    const p = FMQ.app.players.find(x => x.id === pid);
    if (!p) return;
    p.pendingActive = !!inp.checked;
    const desiredActiveCount = FMQ.app.players.filter(x => (typeof x.pendingActive === "boolean" ? x.pendingActive : x.active !== false)).length;
    if (!desiredActiveCount) {
      p.pendingActive = true;
      inp.checked = true;
      return;
    }
    FMQ.renderPlayerSwitchPanel();
  });
};

FMQ.applyPendingPlayerActivity = ({ roundEnd = false, gameEnd = false } = {}) => {
  const mode = FMQ.app.state.pauseApplyMode || "next";
  if (mode === "round" && !roundEnd && !gameEnd) return false;
  if (mode === "game" && !gameEnd) return false;
  const pending = FMQ.app.players.filter(p => typeof p.pendingActive === "boolean");
  if (!pending.length) return false;
  const nextActiveCount = FMQ.app.players.filter(p => typeof p.pendingActive === "boolean" ? p.pendingActive : p.active !== false).length;
  if (!nextActiveCount) return false;
  let changed = false;
  pending.forEach(p => {
    if ((p.active !== false) !== p.pendingActive) changed = true;
    p.active = p.pendingActive;
    p.pendingActive = undefined;
  });
  if (changed && FMQ.app.state.social?.respondingPlayersQueue) {
    const activeIds = new Set(FMQ.activePlayers().map(p => p.id));
    while (FMQ.app.state.social.respondingPlayersQueue[FMQ.app.state.social.currentResponderIndex]
      && !activeIds.has(FMQ.app.state.social.respondingPlayersQueue[FMQ.app.state.social.currentResponderIndex])) {
      FMQ.app.state.social.currentResponderIndex++;
    }
  }
  FMQ.ensureActiveTurnIndex();
  FMQ.renderPlayerSwitchPanel();
  return changed;
};

FMQ.ensureActiveTurnIndex = () => {
  const cur = FMQ.app.players[FMQ.app.state.turnIndex];
  if (cur && cur.active !== false) return;
  const first = FMQ.activePlayers()[0];
  if (!first) return;
  FMQ.app.state.turnIndex = Math.max(0, FMQ.app.players.findIndex(p => p.id === first.id));
};

FMQ.syncSetupForMode = () => {
  const selectedMode = FMQ.$("modeSelect")?.value || FMQ.app.config.mode;
  const hideEndControls = FMQ.app.config.category === "intro" || selectedMode === "rankingList";
  if (selectedMode === "rankingList") {
    const size = FMQ.app.config.rankingSize || parseInt(FMQ.$("rankingSizeSetupSelect")?.value || "5", 10) || 5;
    FMQ.app.config.endType = "rounds";
    FMQ.app.config.targetRounds = size;
    if (FMQ.$("endTypeSelect")) FMQ.$("endTypeSelect").value = "rounds";
    if (FMQ.$("targetRoundsInput")) FMQ.$("targetRoundsInput").value = String(size);
  }
  if (FMQ.$("endTypeRow")) FMQ.$("endTypeRow").style.display = hideEndControls ? "none" : "";
  if (FMQ.$("endTargetRow")) FMQ.$("endTargetRow").style.display = hideEndControls ? "none" : "";
};

// =========================================================
// TURN-VORBEREITUNG / ZIEHLOGIK
// =========================================================

FMQ.stopPlaybackNow = async () => {
  try { await FMQ.pausePlayback(); } catch {}
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  if (FMQ.app.state.speed?.timer) clearInterval(FMQ.app.state.speed.timer);
  const socialPlayback = FMQ.app.state.socialPlayback || {};
  Object.values(socialPlayback).forEach(pb => { if (pb) pb.startedAt = null; });
  FMQ.app.state.isPlaying = false;
};

FMQ.onNewTrack = async () => {
  const mode = FMQ.app.config.mode;
  if (mode === "bestFit") {
    await FMQ.modes.bestFit.newSongs();
    return;
  }
  await FMQ.stopPlaybackNow();
  FMQ.resetMultiplayerRound?.();
  FMQ.$("revealBox").style.display = "none";
  FMQ.$("revealText").innerHTML = "";
  FMQ.$("revealExtra").innerHTML = "";
  FMQ.$("quick3RevealOverlay").classList.remove("show");
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.selfCheckPending = false;
  FMQ.app.state.speed = null;
  if (FMQ.app.state.social?.autoAdvanceTimer) clearInterval(FMQ.app.state.social.autoAdvanceTimer);
  FMQ.app.state.quick3.randomStartMs = null;
  FMQ.app.state.quick3.answers = {};
  FMQ.app.state.quick3.multiReveal = false;
  if (mode === "introPlaylistGuess") FMQ.app.state.introPlaylistGuess = { answers: {}, responderIndex: 0 };
  if (mode === "rankingList") {
    FMQ.app.state.rankingList.answers = {};
    FMQ.app.state.rankingList.multiPromptTrackId = null;
  }
  if (FMQ.isSocialMode(mode)) FMQ.app.state.social = null;
  FMQ.modes[mode]?.renderArea?.();
  FMQ.$("revealBtn").disabled = mode === "quick3" ? false : true;
  FMQ.$("nextBtn").disabled = true;
  FMQ.renderHeader();
  FMQ.renderScoreTable();
  FMQ.refreshPhoneControls?.();
};
FMQ.prepareTrackForTurn = async () => {
  const mode = FMQ.app.config.mode;
  const draw = mode === "introPlaylistGuess"
    ? FMQ.modes.introPlaylistGuess.drawUniqueTrack()
    : FMQ.drawTrackForCurrentTurn({ risk: "safe" });

  if (!draw?.track) throw new Error("Keine Songs mehr übrig.");
  FMQ.app.state.currentTrack = draw.track;
  FMQ.app.state.currentSourcePlayerId = draw.sourcePlayerId;

  if (mode === "bestFit") {
    const me = FMQ.currentPlayer();
    const ownIds = FMQ.shuffle((me.tracks || []).map(t => t.id).filter(id => id && !FMQ.app.usedTrackIds.has(id)));
    if (ownIds.length < 2) throw new Error("Für Song A/B werden mindestens 2 ungenutzte Songs in der Haupt-Playlist benötigt.");
    const aId = ownIds.pop();
    const bId = ownIds.pop();
    FMQ.app.usedTrackIds.add(aId);
    FMQ.app.usedTrackIds.add(bId);
    FMQ.app.state.bestFitTracks = {
      a: FMQ.app.trackMap.get(aId),
      b: FMQ.app.trackMap.get(bId)
    };
    FMQ.app.state.currentTrack = FMQ.app.state.bestFitTracks.a;
    FMQ.app.state.currentSourcePlayerId = me.id;
  }

  if (mode === "introPlaylistGuess") FMQ.modes.introPlaylistGuess.renderGuessUI();
  if (FMQ.$("screenGame")?.classList.contains("active")) FMQ.renderHeader();
  FMQ.refreshPhoneControls?.();
};

FMQ.resetTurnUI = () => {
  FMQ.resetMultiplayerRound?.();
  FMQ.$("revealBox").style.display = "none";
  FMQ.$("revealText").innerHTML = "";
  FMQ.$("revealExtra").innerHTML = "";
  FMQ.$("quick3RevealOverlay").classList.remove("show");
  FMQ.$("quick3HelpOverlay").classList.remove("show");

  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  if (FMQ.app.state.speed?.timer) clearInterval(FMQ.app.state.speed.timer);
  FMQ.app.state.speed = null;
  FMQ.app.state.isPlaying = false;
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.bestFitTracks = null;
  FMQ.app.state.selfCheckPending = false;
  FMQ.app.state.quick3.randomStartMs = null;
  FMQ.app.state.quick3.answers = {};
  FMQ.app.state.quick3.multiReveal = false;
  if (FMQ.app.state.social?.autoAdvanceTimer) clearInterval(FMQ.app.state.social.autoAdvanceTimer);

  FMQ.$("turnPlayerBanner").style.display = "";
  FMQ.$("gameMetaBanner").style.display = "";
  FMQ.$("readyBtn").style.display = "";
  FMQ.$("playToggleBtn").style.display = "";
  FMQ.$("revealBtn").style.display = "";
  FMQ.$("nextBtn").style.display = "";
  if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = "";
  FMQ.$("quick3Controls").style.display = "none";
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.$("readyBtn").textContent = "▶️ Play-Start";
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = true;
  FMQ.$("nextBtn").disabled = true;
  FMQ.$("playToggleBtn").disabled = true;
  FMQ.$("playToggleBtn").textContent = "↻ Play von vorn";

  const mode = FMQ.app.config.mode;
  if (mode === "introPlaylistGuess") FMQ.app.state.introPlaylistGuess = { answers: {}, responderIndex: 0 };
  FMQ.modes[mode].renderArea();

  if (mode === "quick3" || mode === "rankingList" || mode === "introPlaylistGuess" || mode === "introFirst3") {
    FMQ.$("screenGame").classList.add("quick3Active");
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = mode === "introFirst3" ? "none" : "";
    FMQ.$("quick3Controls").style.display = "flex";
    FMQ.$("revealBtn").disabled = false;
  } else if (mode === "speedGuess") {
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = "";
    FMQ.$("readyBtn").disabled = false;
  } else if (FMQ.isSocialMode(mode)) {
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = "";
  } else {
    FMQ.$("readyBtn").disabled = false;
    FMQ.$("revealBtn").disabled = false;
  }

  FMQ.$("turnFlowHint").textContent = mode === "quick3"
    ? "Ablauf: Clip-Länge wählen → Play-Start/Play-Zufall → Reveal → Punkte eintragen und weiter"
    : FMQ.isSocialMode(mode)
      ? "Ablauf: Alles direkt im Modusbereich (Start, Weiter, Reveal, Nächster Zug)"
    : "Ablauf: Play-Start → optional Stop/Play von vorn → Reveal → Weiter";

  FMQ.renderHeader();
  FMQ.renderScoreTable();
  FMQ.renderPlayerSwitchPanel();
  FMQ.renderMultiplayerPanel?.();
  FMQ.applyAccessibilityLabels();
  FMQ.refreshPhoneControls?.();
};

FMQ.onReady = async () => {
  const mode = FMQ.app.config.mode;
  if (!FMQ.app.state.currentTrack) {
    await FMQ.prepareTrackForTurn();
  }

  await FMQ.playTrackUri(FMQ.app.state.currentTrack.uri, { positionMs: 0 });
  FMQ.app.state.isPlaying = true;
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = false;
  FMQ.$("playToggleBtn").disabled = false;
  FMQ.$("playToggleBtn").textContent = "⏸️ Stop";
  if (mode === "speedGuess") {
    FMQ.modes.speedGuess.startCountdown();
  }
  FMQ.renderHeader();
};

FMQ.onTogglePlay = async () => {
  if (!FMQ.app.state.currentTrack) return;
  if (FMQ.app.state.isPlaying) {
    await FMQ.pausePlayback();
    FMQ.app.state.isPlaying = false;
    FMQ.$("playToggleBtn").textContent = "↻ Play von vorn";
  } else {
    await FMQ.playTrackUri(FMQ.app.state.currentTrack.uri, { positionMs: 0 });
    FMQ.app.state.isPlaying = true;
    FMQ.$("playToggleBtn").textContent = "⏸️ Stop";
  }
};

FMQ.onQuick3Play = async (kind) => {
  if (FMQ.app.state.selfCheckPending) return;
  if (!FMQ.app.state.currentTrack) await FMQ.prepareTrackForTurn();
  const t = FMQ.app.state.currentTrack;
  const startMs = kind === "start"
    ? 0
    : (FMQ.app.state.quick3.randomStartMs ?? (FMQ.app.state.quick3.randomStartMs = FMQ.modes.quick3.randomStartMs(t)));
  await FMQ.modes.quick3.playStored(t, startMs);
  FMQ.$("revealBtn").disabled = false;
};

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
  const owners = (t.owners || []).map(FMQ.getPlayerName).join(", ");

  FMQ.$("revealBox").style.display = "block";
  FMQ.$("revealText").innerHTML = `<div style="font-size:18px; font-weight:900;">${FMQ.escapeHtml(res.headline)}</div><div><b>${FMQ.escapeHtml(t.name)}</b><br><span class="muted">${FMQ.escapeHtml(t.artists.join(", "))}</span><br>Jahr: <b>${t.year}</b><br><span class="muted">${FMQ.escapeHtml(mode === "introPlaylistGuess" ? `Song ist in Playlist: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}` : `Quelle: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}`)}</span><br><span class="muted">${FMQ.escapeHtml(res.detail || "")}</span></div>`;

  if (mode === "guessSong") FMQ.modes.guessSong.renderRevealExtras();
  if (mode === "speedGuess") FMQ.modes.speedGuess.renderRevealExtras();

  if (mode === "quick3") {
    FMQ.$("revealBox").style.display = "none";
    FMQ.$("quick3RevealContent").innerHTML = `
      <div style="font-size:20px; font-weight:900; margin-bottom:8px;">${FMQ.escapeHtml(res.headline)}</div>
      <div>
        <b>${FMQ.escapeHtml(t.name)}</b><br>
        <span class="muted">${FMQ.escapeHtml(t.artists.join(", "))}</span><br>
        Jahr: <b>${t.year}</b>
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

FMQ.onNext = () => {
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

FMQ.startGame = () => {
  FMQ.app.config.mode = FMQ.$("modeSelect").value;
  FMQ.app.config.party = FMQ.$("partySelect").value;
  if (FMQ.app.config.category === "intro") {
    FMQ.app.config.endType = "rounds";
    FMQ.app.config.targetRounds = 1;
  } else {
    FMQ.app.config.endType = FMQ.$("endTypeSelect").value;
    FMQ.app.config.targetPoints = Math.max(1, parseInt(FMQ.$("targetPointsInput").value || "15", 10));
    FMQ.app.config.targetRounds = Math.max(1, parseInt(FMQ.$("targetRoundsInput").value || "5", 10));
  }
  if (FMQ.$("rankingSizeSetupSelect")) FMQ.app.config.rankingSize = parseInt(FMQ.$("rankingSizeSetupSelect").value, 10);
  if (FMQ.app.config.mode === "rankingList") {
    FMQ.app.config.endType = "rounds";
    FMQ.app.config.targetRounds = FMQ.app.config.rankingSize || 5;
  }
  FMQ.resetSession();
  FMQ.resetMultiplayerRound?.();
  FMQ.showScreen("screenGame");
  FMQ.resetTurnUI();
};

FMQ.renderPlayStyleButtons = () => {
  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-category") === FMQ.app.config.category);
  });
};

FMQ.selectSetupCategory = (category) => {
  if (!category) return;
  FMQ.app.config.category = category;
  FMQ.app.config.party = "rotate";
  if (FMQ.$("partySelect")) FMQ.$("partySelect").value = "rotate";
  FMQ.app.state.setupStep = 3;
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.renderSetupWizard();
};

FMQ.selectSetupMode = (modeId) => {
  if (!modeId) return;
  FMQ.$("modeSelect").value = modeId;
  FMQ.app.config.mode = modeId;
  FMQ.renderModeHints();
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.app.state.setupStep = 4;
  FMQ.renderSetupWizard();
};

FMQ.handleSetupPointerNavigation = (event) => {
  if (!FMQ.$("screenSetup")?.classList.contains("active")) return;
  const target = event.target.closest?.("#singleDeviceModeBtn,#multiDeviceModeBtn,[data-category],[data-mode-id]");
  if (!target) return;
  event.preventDefault();
  if (target.id === "singleDeviceModeBtn") {
    FMQ.setDeviceMode?.("single");
    FMQ.showMultiDeviceHint?.("Ein-Gerät-Modus aktiv.");
    return;
  }
  if (target.id === "multiDeviceModeBtn") {
    FMQ.enableMultiDeviceMode?.().catch(e => FMQ.showMultiDeviceHint?.(e.message));
    return;
  }
  if (target.hasAttribute("data-category")) {
    FMQ.suppressSetupClickUntil = Date.now() + 450;
    FMQ.selectSetupCategory(target.getAttribute("data-category"));
    return;
  }
  if (target.hasAttribute("data-mode-id")) {
    FMQ.selectSetupMode(target.getAttribute("data-mode-id"));
  }
};

FMQ.renderModeButtons = () => {
  const modeMeta = [
    { id: "quick3", label: "Song erraten", category: FMQ.MODE_INFO.quick3.category },
    { id: "rankingList", label: FMQ.MODE_INFO.rankingList.label, category: FMQ.MODE_INFO.rankingList.category },
    { id: "ratingGuess", label: "Bewertung 1–10", category: FMQ.MODE_INFO.ratingGuess.category },
    { id: "bestFit", label: FMQ.MODE_INFO.bestFit.label, category: FMQ.MODE_INFO.bestFit.category },
    { id: "introPlaylistGuess", label: "Aus welcher Playlist?", category: FMQ.MODE_INFO.introPlaylistGuess.category },
    { id: "introFirst3", label: FMQ.MODE_INFO.introFirst3.label, category: FMQ.MODE_INFO.introFirst3.category }
  ];
  const allowed = modeMeta.filter(m => m.category === FMQ.app.config.category);
  if (!allowed.some(m => m.id === FMQ.$("modeSelect").value)) {
    FMQ.$("modeSelect").value = allowed[0]?.id || "quick3";
    FMQ.app.config.mode = FMQ.$("modeSelect").value;
    FMQ.renderModeHints();
  }
  FMQ.$("modeButtons").innerHTML = allowed.map(m => `<button class="menu-card modeBtn ${m.id===FMQ.app.config.mode?"active":""}" data-mode-id="${m.id}"><span class="card-title">${m.label}</span><span class="card-subtitle">${FMQ.escapeHtml(FMQ.MODE_INFO[m.id]?.hint || "")}</span></button>`).join("");
  FMQ.$("modeButtons").querySelectorAll("[data-mode-id]").forEach(btn => {
    btn.onclick = () => FMQ.selectSetupMode(btn.getAttribute("data-mode-id"));
  });
};

FMQ.setupCanProceed = () => {
  const step = FMQ.app.state.setupStep || 1;
  if (step === 1) return true;
  if (step === 2) return !!FMQ.app.config.category;
  if (step === 3) return !!FMQ.$("modeSelect").value;
  if (step === 4) {
    const playlistSelects = [...document.querySelectorAll('select[data-role="playlist"]')];
    const uiHasAllPlaylists = playlistSelects.length > 0 && playlistSelects.every(sel => !!sel.value);
    const modelHasAllPlaylists = FMQ.app.players.length > 0 && FMQ.app.players.every(p => p.playlistId && (p.tracks?.length || 0) >= 5 && p.spanMin && p.spanMax);
    return uiHasAllPlaylists && modelHasAllPlaylists;
  }
  return true;
};

FMQ.renderSetupWizard = () => {
  const step = FMQ.app.state.setupStep || 1;
  document.querySelectorAll(".setupStep").forEach(el => {
    el.classList.toggle("active", parseInt(el.getAttribute("data-setup-step"), 10) === step);
  });

  const nav = FMQ.$("setupNav");
  const continueBtn = FMQ.$("setupContinueBtn");
  const backBtn = FMQ.$("setupBackBtn");
  if (nav) nav.style.display = step <= 1 ? "none" : "grid";
  if (backBtn) backBtn.disabled = step <= 1;
  if (continueBtn) {
    continueBtn.textContent = step === 4 ? "Spiel starten" : "Weiter →";
    continueBtn.disabled = !FMQ.setupCanProceed();
    continueBtn.style.visibility = step === 2 || step === 3 ? "hidden" : "visible";
  }

  const loginBtn = FMQ.$("loginBtn");
  if (loginBtn) loginBtn.textContent = FMQ.storage.token ? "Spotify verbunden" : "Spotify verbinden";
  const startBtn = FMQ.$("setupNextBtn");
  if (startBtn) startBtn.textContent = FMQ.isMultiDevice?.() ? "Weiter zur Modusauswahl" : "Ein-Gerät-Modus starten";

  if (step === 4 && FMQ.storage.token && !FMQ.app.playlists.length && !FMQ.app.loadingPlaylists) {
    FMQ.app.loadingPlaylists = true;
    FMQ.loadMyPlaylists().catch(() => {}).finally(() => { FMQ.app.loadingPlaylists = false; });
  }

  if (step === 1 && !FMQ.storage.token) {
    FMQ.$("setupStepHint").textContent = "Spotify verbinden, damit im Setup Playlists geladen werden können.";
  } else if (step === 4 && !FMQ.setupCanProceed()) {
    FMQ.$("setupStepHint").textContent = "Bitte für jeden Spieler eine Playlist mit mindestens 5 Tracks laden.";
  } else {
    FMQ.$("setupStepHint").textContent = "";
  }
  FMQ.renderPlayStyleButtons();
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.renderDeviceModePanel?.();
  FMQ.renderMultiplayerPanel?.();
  FMQ.applyAccessibilityLabels();
  FMQ.refreshPhoneControls?.();
};


FMQ.goToSetupStep = (step) => {
  FMQ.app.state.setupStep = Math.max(1, Math.min(4, step));
  try {
    FMQ.renderSetupWizard();
  } catch (e) {
    document.querySelectorAll(".setupStep").forEach(el => {
      el.classList.toggle("active", parseInt(el.getAttribute("data-setup-step"), 10) === FMQ.app.state.setupStep);
    });
    const nav = FMQ.$("setupNav");
    if (nav) nav.style.display = FMQ.app.state.setupStep <= 1 ? "none" : "grid";
    if (FMQ.$("setupContinueBtn")) FMQ.$("setupContinueBtn").style.visibility = FMQ.app.state.setupStep === 4 ? "visible" : "hidden";
    FMQ.setDebug(e.stack || e.message);
  }
};

FMQ.init = async () => {
  if (!FMQ.setupPointerNavigationBound) {
    FMQ.setupPointerNavigationBound = true;
    document.addEventListener("pointerdown", FMQ.handleSetupPointerNavigation, true);
    document.addEventListener("click", event => {
      if ((FMQ.suppressSetupClickUntil || 0) > Date.now()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }
  if (FMQ.$("setupNextBtn")) FMQ.$("setupNextBtn").onclick = () => {
    if (!FMQ.isMultiDevice?.()) FMQ.setDeviceMode?.("single");
    FMQ.goToSetupStep(2);
  };
  if (FMQ.$("setupBackBtn")) FMQ.$("setupBackBtn").onclick = () => FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) - 1);
  if (FMQ.$("setupContinueBtn")) FMQ.$("setupContinueBtn").onclick = () => {
    if (!FMQ.setupCanProceed()) return;
    if (FMQ.app.state.setupStep === 4) {
      FMQ.startGame();
      return;
    }
    FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) + 1);
  };

  FMQ.$("redirectUriPill").textContent = FMQ.REDIRECT_URI;

  FMQ.$("quick3HelpCloseBtn").onclick = () => FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("quick3ConfirmBtn").onclick = () => {
    const me = FMQ.currentPlayer();
    const result = FMQ.modes.quick3.submitAnswer(me.id, {
      title: FMQ.$("quick3ChkTitle").checked,
      artist: FMQ.$("quick3ChkArtist").checked,
      year: FMQ.$("quick3ChkYear").checked
    });
    const pts = result.points;
    FMQ.app.state.selfCheckPending = false;
    FMQ.$("quick3PtsStatus").innerHTML = `<span class="ok">+${pts} Punkte bestätigt</span>`;
    FMQ.$("quick3ConfirmBtn").disabled = true;
    FMQ.renderScoreTable();
    setTimeout(() => {
      FMQ.$("quick3RevealOverlay").classList.remove("show");
      FMQ.$("nextBtn").disabled = false;
      FMQ.onNext();
    }, 220);
  };
  FMQ.$("loginBtn").onclick = () => FMQ.loginSpotify().catch(() => FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!");
  if (FMQ.$("logoutBtn")) FMQ.$("logoutBtn").onclick = () => FMQ.logoutSpotify();
  if (FMQ.$("loadMyPlaylistsBtn")) FMQ.$("loadMyPlaylistsBtn").onclick = () => FMQ.loadMyPlaylists().catch(() => { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; });
  FMQ.$("buildPlayersBtn").onclick = () => FMQ.buildPlayersConfig();
  FMQ.$("modeSelect").onchange = () => { FMQ.renderModeHints(); FMQ.renderModeButtons(); FMQ.syncSetupForMode(); FMQ.renderSetupWizard(); };
  FMQ.$("targetPlusBtn").onclick = () => {
    const endType = FMQ.$("endTypeSelect").value;
    const fieldId = endType === "points" ? "targetPointsInput" : "targetRoundsInput";
    const max = endType === "points" ? 999 : 50;
    const def = endType === "points" ? "15" : "5";
    FMQ.$(fieldId).value = String(Math.min(max, parseInt(FMQ.$(fieldId).value || def, 10) + 1));
  };
  FMQ.$("targetMinusBtn").onclick = () => {
    const endType = FMQ.$("endTypeSelect").value;
    const fieldId = endType === "points" ? "targetPointsInput" : "targetRoundsInput";
    const def = endType === "points" ? "15" : "5";
    FMQ.$(fieldId).value = String(Math.max(1, parseInt(FMQ.$(fieldId).value || def, 10) - 1));
  };
  FMQ.$("endTypeSelect").onchange = () => {
    const points = FMQ.$("endTypeSelect").value === "points";
    FMQ.$("targetLabelText").textContent = points ? "Punkte" : "Runden";
    FMQ.$("targetPointsInput").style.display = points ? "" : "none";
    FMQ.$("targetRoundsInput").style.display = points ? "none" : "";
    FMQ.renderSetupWizard();
  };
  const rebuildFromPlayerCount = () => {
    FMQ.buildPlayersConfig();
    FMQ.renderSetupWizard();
  };
  FMQ.$("playerPlusBtn").onclick = () => {
    FMQ.$("playerCountInput").value = String(Math.min(15, parseInt(FMQ.$("playerCountInput").value || "0", 10) + 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerMinusBtn").onclick = () => {
    FMQ.$("playerCountInput").value = String(Math.max(FMQ.isMultiDevice?.() ? 0 : 1, parseInt(FMQ.$("playerCountInput").value || "1", 10) - 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerCountInput").addEventListener("change", rebuildFromPlayerCount);
  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.onclick = () => FMQ.selectSetupCategory(btn.getAttribute("data-category"));
  });
  FMQ.$("setupBackBtn").onclick = () => FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) - 1);
  FMQ.$("setupNextBtn").onclick = () => {
    if (!FMQ.isMultiDevice?.()) FMQ.setDeviceMode?.("single");
    FMQ.goToSetupStep(2);
  };
  FMQ.$("setupContinueBtn").onclick = () => {
    if (!FMQ.setupCanProceed()) return;
    if (FMQ.app.state.setupStep === 4) {
      FMQ.startGame();
      return;
    }
    FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) + 1);
  };
  FMQ.$("readyBtn").onclick = () => FMQ.onReady().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("playToggleBtn").onclick = () => FMQ.onTogglePlay().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("revealBtn").onclick = () => FMQ.onReveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
  if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").onclick = () => FMQ.onNewTrack().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("nextBtn").onclick = () => FMQ.onNext();
  FMQ.$("quitBtn").onclick = () => FMQ.quitToMenu();
  FMQ.$("endBtn").onclick = () => FMQ.quitToMenu();

  FMQ.buildPlayersConfig();
  FMQ.renderDeviceModePanel?.();
  FMQ.renderPlayerSwitchPanel();
  FMQ.$("endTypeSelect").dispatchEvent(new Event("change"));
  FMQ.syncSetupForMode();
  FMQ.renderModeHints();
  FMQ.refreshConnStatus();
  FMQ.renderSetupWizard();
  FMQ.applyAccessibilityLabels();

  try { await FMQ.handleOAuthCallbackIfPresent(); } catch (e) { FMQ.setDebug(e.stack || e.message); }
  if (FMQ.storage.token && !FMQ.app.playlists.length) {
    try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FMQ.init();
});

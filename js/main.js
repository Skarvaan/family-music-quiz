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
  panel.innerHTML = FMQ.app.players.map(p => `
    <label class="playerSwitchRow">
      <span>${FMQ.escapeHtml(p.name)}</span>
      <input type="checkbox" data-role="active-switch" data-pid="${p.id}" ${p.active !== false ? "checked" : ""}>
    </label>
  `).join("");
  panel.querySelectorAll('input[data-role="active-switch"]').forEach(inp => inp.onchange = async () => {
    const pid = inp.getAttribute("data-pid");
    const p = FMQ.app.players.find(x => x.id === pid);
    if (!p) return;
    p.active = !!inp.checked;
    if (!FMQ.activePlayers().length) {
      p.active = true;
      inp.checked = true;
      return;
    }
    if (!p.active && FMQ.currentPlayer()?.id === p.id && FMQ.$("screenGame").classList.contains("active")) {
      try { await FMQ.pausePlayback(); } catch {}
      FMQ.advanceTurn();
      FMQ.resetTurnUI();
      return;
    }
    FMQ.renderHeader();
    FMQ.renderScoreTable();
  });
};

// =========================================================
// TURN-VORBEREITUNG / ZIEHLOGIK
// =========================================================
FMQ.prepareTrackForTurn = async () => {
  const mode = FMQ.app.config.mode;
  const draw = mode === "playlistGuess"
    ? FMQ.drawTrackForCurrentTurn({ forceFromAny: true })
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

  if (mode === "yearRange") {
    const me = FMQ.currentPlayer();
    const built = FMQ.modes.yearRange.buildOptionsForYear(draw.track.year, FMQ.app.state.yearRange.step, me.spanMin, me.spanMax);
    FMQ.app.state.yearRange.options = built.buckets;
    FMQ.app.state.yearRange.correctIdx = built.correctIdx;
    FMQ.modes.yearRange.renderChoices();
  }
  if (mode === "playlistGuess") FMQ.modes.playlistGuess.renderGuessUI();
};

FMQ.resetTurnUI = () => {
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

  FMQ.$("readyBtn").style.display = "";
  FMQ.$("playToggleBtn").style.display = "";
  FMQ.$("revealBtn").style.display = "";
  FMQ.$("nextBtn").style.display = "";
  FMQ.$("quick3Controls").style.display = "none";
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.$("readyBtn").textContent = "▶️ Play-Start";
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = true;
  FMQ.$("nextBtn").disabled = true;
  FMQ.$("playToggleBtn").disabled = true;
  FMQ.$("playToggleBtn").textContent = "↻ Play von vorn";

  const mode = FMQ.app.config.mode;
  FMQ.modes[mode].renderArea();

  if (mode === "yearRange") {
    FMQ.app.state.yearRange = { step: 10, points: FMQ.modes.yearRange.stepPoints(10), options: [], correctIdx: -1, picks: new Map() };
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
  } else if (mode === "quick3") {
    FMQ.$("screenGame").classList.add("quick3Active");
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    FMQ.$("quick3Controls").style.display = "flex";
    FMQ.$("revealBtn").disabled = false;
  } else if (mode === "speedGuess") {
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    FMQ.$("readyBtn").disabled = false;
  } else if (FMQ.isSocialMode(mode)) {
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
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
  FMQ.applyAccessibilityLabels();
};

FMQ.onReady = async () => {
  const mode = FMQ.app.config.mode;
  if (!FMQ.app.state.currentTrack) {
    await FMQ.prepareTrackForTurn();
  }
  FMQ.showRangeOverlay(false);

  await FMQ.playTrackUri(FMQ.app.state.currentTrack.uri, { positionMs: 0 });
  FMQ.app.state.isPlaying = true;
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = false;
  FMQ.$("playToggleBtn").disabled = false;
  FMQ.$("playToggleBtn").textContent = "⏸️ Stop";
  if (mode === "speedGuess") {
    FMQ.modes.speedGuess.startCountdown();
  }
  if (mode === "yearRange" && FMQ.modes.yearRange.syncControlStates) FMQ.modes.yearRange.syncControlStates();
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
  try { await FMQ.pausePlayback(); } catch {}
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.app.state.isPlaying = false;
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
  FMQ.$("revealText").innerHTML = `<div style="font-size:18px; font-weight:900;">${FMQ.escapeHtml(res.headline)}</div><div><b>${FMQ.escapeHtml(t.name)}</b><br><span class="muted">${FMQ.escapeHtml(t.artists.join(", "))}</span><br>Jahr: <b>${t.year}</b><br><span class="muted">${FMQ.escapeHtml(mode === "playlistGuess" ? `Song ist in Playlist(s): ${owners}` : `Quelle: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}`)}</span><br><span class="muted">${FMQ.escapeHtml(res.detail || "")}</span></div>`;

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
    if (FMQ.$("quick3PlayStartBtnInline")) FMQ.$("quick3PlayStartBtnInline").disabled = true;
    if (FMQ.$("quick3PlayRandomBtnInline")) FMQ.$("quick3PlayRandomBtnInline").disabled = true;
    if (FMQ.$("quick3LenSelectInline")) FMQ.$("quick3LenSelectInline").disabled = true;
  }

  FMQ.renderScoreTable();
  FMQ.markFinalRoundIfNeeded();
  FMQ.$("revealBtn").disabled = true;
  FMQ.$("nextBtn").disabled = FMQ.app.state.selfCheckPending;
  if (mode === "yearRange" && FMQ.modes.yearRange.syncControlStates) FMQ.modes.yearRange.syncControlStates();
  FMQ.applyAccessibilityLabels();
};

FMQ.finishGame = (winnerPlayer, reason) => {
  FMQ.showRangeOverlay(false);
  FMQ.showScreen("screenWinner");
  FMQ.$("winnerHeadline").textContent = winnerPlayer ? `${winnerPlayer.name} gewinnt!` : "Spiel beendet";
  FMQ.$("winnerSub").textContent = reason || "";
  FMQ.$("finalScoreTable").innerHTML = [...FMQ.app.players]
    .sort((a, b) => b.score - a.score)
    .map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${p.score} Punkte</div></div>`)
    .join("");
};

FMQ.onNext = () => {
  if (FMQ.app.config.endType === "rounds" && FMQ.app.state.round > FMQ.app.config.targetRounds) {
    FMQ.finishGame(FMQ.getWinnerByScore(), `${FMQ.app.config.targetRounds} Runden sind gespielt.`);
    return;
  }
  const winner = FMQ.checkFinishAfterNext();
  if (winner) {
    FMQ.finishGame(winner, `Ziel ${FMQ.getEndTargetText()} wurde in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  FMQ.advanceTurn();

  const winnerAfterAdvance = FMQ.checkFinishAfterNext();
  if (winnerAfterAdvance) {
    FMQ.finishGame(winnerAfterAdvance, `Ziel ${FMQ.getEndTargetText()} wurde in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  if (FMQ.app.config.endType === "rounds" && FMQ.app.state.round > FMQ.app.config.targetRounds) {
    FMQ.finishGame(FMQ.getWinnerByScore(), `${FMQ.app.config.targetRounds} Runden sind gespielt.`);
    return;
  }

  FMQ.resetTurnUI();
};

FMQ.quitToMenu = async () => {
  try { await FMQ.pausePlayback(); } catch {}
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.showRangeOverlay(false);
  FMQ.$("quick3RevealOverlay").classList.remove("show");
  FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.app.state.setupStep = 3;
  FMQ.showScreen("screenSetup");
  FMQ.renderSetupWizard();
  FMQ.setGameDebug("");
};

FMQ.startGame = () => {
  FMQ.app.config.mode = FMQ.$("modeSelect").value;
  FMQ.app.config.party = FMQ.$("partySelect").value;
  FMQ.app.config.endType = FMQ.$("endTypeSelect").value;
  FMQ.app.config.targetPoints = Math.max(1, parseInt(FMQ.$("targetPointsInput").value || "15", 10));
  FMQ.app.config.targetRounds = Math.max(1, parseInt(FMQ.$("targetRoundsInput").value || "5", 10));
  FMQ.resetSession();
  FMQ.showScreen("screenGame");
  FMQ.resetTurnUI();
};

FMQ.renderPlayStyleButtons = () => {
  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-category") === FMQ.app.config.category);
  });
};

FMQ.renderModeButtons = () => {
  const modeMeta = [
    { id: "quick3", label: `A) ${FMQ.MODE_INFO.quick3.label}`, category: FMQ.MODE_INFO.quick3.category },
    { id: "yearRange", label: `B) ${FMQ.MODE_INFO.yearRange.label}`, category: FMQ.MODE_INFO.yearRange.category },
    { id: "ratingGuess", label: `C) ${FMQ.MODE_INFO.ratingGuess.label}`, category: FMQ.MODE_INFO.ratingGuess.category },
    { id: "bestFit", label: `D) ${FMQ.MODE_INFO.bestFit.label}`, category: FMQ.MODE_INFO.bestFit.category }
  ];
  const allowed = modeMeta.filter(m => m.category === FMQ.app.config.category);
  if (!allowed.some(m => m.id === FMQ.$("modeSelect").value)) {
    FMQ.$("modeSelect").value = allowed[0]?.id || "quick3";
    FMQ.app.config.mode = FMQ.$("modeSelect").value;
    FMQ.renderModeHints();
  }
  FMQ.$("modeButtons").innerHTML = allowed.map(m => `<button class="modeBtn ${m.id===FMQ.app.config.mode?"active":""}" data-mode-id="${m.id}">${m.label}</button>`).join("");
  FMQ.$("modeButtons").querySelectorAll("[data-mode-id]").forEach(btn => {
    btn.onclick = () => {
      FMQ.$("modeSelect").value = btn.getAttribute("data-mode-id");
      FMQ.app.config.mode = FMQ.$("modeSelect").value;
      FMQ.renderModeHints();
      FMQ.renderModeButtons();
      FMQ.renderSetupWizard();
    };
  });
};

FMQ.setupCanProceed = () => {
  const step = FMQ.app.state.setupStep || 1;
  if (step === 1) return !!FMQ.storage.token;
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
  if (step === 1) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 1 · Spotify verbinden";
    FMQ.$("setupWizardSub").textContent = "Verbinde zuerst den Spotify-Host-Account.";
    FMQ.$("setupNextBtn").textContent = "Weiter →";
  } else if (step === 2) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 2 · Hauptkategorie";
    FMQ.$("setupWizardSub").textContent = "Ich & meine Playlist oder Wer kennt meinen Geschmack?";
  } else if (step === 3) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 3 · Modus";
    FMQ.$("setupWizardSub").textContent = "Wähle den Spielmodus als große Schaltfläche.";
  } else if (step === 4) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 4 · Punkte & Spieler";
    FMQ.$("setupWizardSub").textContent = "Lege Endziel (Punkte oder Runden) und Spieleranzahl fest.";
  }
  FMQ.$("setupBackBtn").disabled = step <= 1;
  FMQ.$("setupNextBtn").style.display = "";
  FMQ.$("setupNextBtn").textContent = step === 4 ? "Starten!" : "Weiter →";
  FMQ.$("setupNextBtn").disabled = !FMQ.setupCanProceed();
  if (step === 1 && !FMQ.storage.token) {
    FMQ.$("setupStepHint").textContent = "Verbinde zuerst Spotify, dann wird „Weiter“ aktiv.";
  } else if (step === 4 && !FMQ.setupCanProceed()) {
    FMQ.$("setupStepHint").textContent = "Bitte für jeden Spieler eine Playlist laden (mind. 5 Tracks), dann kannst du starten.";
  } else {
    FMQ.$("setupStepHint").textContent = "";
  }
  FMQ.renderPlayStyleButtons();
  FMQ.renderModeButtons();
  FMQ.applyAccessibilityLabels();
};

FMQ.init = async () => {
  FMQ.$("redirectUriPill").textContent = FMQ.REDIRECT_URI;

  FMQ.$("quick3HelpCloseBtn").onclick = () => FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("quick3ConfirmBtn").onclick = () => {
    const me = FMQ.currentPlayer();
    const pts =
      (FMQ.$("quick3ChkTitle").checked ? 1 : 0) +
      (FMQ.$("quick3ChkArtist").checked ? 1 : 0) +
      (FMQ.$("quick3ChkYear").checked ? 1 : 0);
    FMQ.awardPoints(me.id, pts);
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
  FMQ.$("rangeOverlay").querySelectorAll("[data-step]").forEach(btn => btn.onclick = () => {
    const step = parseInt(btn.dataset.step, 10);
    FMQ.app.state.yearRange.step = step;
    FMQ.app.state.yearRange.points = FMQ.modes.yearRange.stepPoints(step);
    FMQ.showRangeOverlay(false);
    FMQ.$("readyBtn").disabled = false;
  });

  FMQ.$("loginBtn").onclick = () => FMQ.loginSpotify().catch(() => FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!");
  if (FMQ.$("logoutBtn")) FMQ.$("logoutBtn").onclick = () => FMQ.logoutSpotify();
  if (FMQ.$("loadMyPlaylistsBtn")) FMQ.$("loadMyPlaylistsBtn").onclick = () => FMQ.loadMyPlaylists().catch(() => { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; });
  FMQ.$("buildPlayersBtn").onclick = () => FMQ.buildPlayersConfig();
  FMQ.$("modeSelect").onchange = () => { FMQ.renderModeHints(); FMQ.renderModeButtons(); FMQ.renderSetupWizard(); };
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
    FMQ.$("playerCountInput").value = String(Math.min(8, parseInt(FMQ.$("playerCountInput").value || "1", 10) + 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerMinusBtn").onclick = () => {
    FMQ.$("playerCountInput").value = String(Math.max(1, parseInt(FMQ.$("playerCountInput").value || "1", 10) - 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerCountInput").addEventListener("change", rebuildFromPlayerCount);
  document.querySelectorAll("[data-category]").forEach(btn => {
    btn.onclick = () => {
      const category = btn.getAttribute("data-category");
      FMQ.app.config.category = category;
      FMQ.app.config.party = "rotate";
      FMQ.$("partySelect").value = "rotate";
      FMQ.renderModeButtons();
      FMQ.renderSetupWizard();
    };
  });
  FMQ.$("setupBackBtn").onclick = () => {
    FMQ.app.state.setupStep = Math.max(1, FMQ.app.state.setupStep - 1);
    FMQ.renderSetupWizard();
  };
  FMQ.$("setupNextBtn").onclick = () => {
    if (!FMQ.setupCanProceed()) return;
    if (FMQ.app.state.setupStep === 4) {
      FMQ.startGame();
      return;
    }
    FMQ.app.state.setupStep = Math.min(4, FMQ.app.state.setupStep + 1);
    FMQ.renderSetupWizard();
  };
  FMQ.$("readyBtn").onclick = () => FMQ.onReady().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("playToggleBtn").onclick = () => FMQ.onTogglePlay().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("revealBtn").onclick = () => FMQ.onReveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("nextBtn").onclick = () => FMQ.onNext();
  FMQ.$("quitBtn").onclick = () => FMQ.quitToMenu();
  FMQ.$("endBtn").onclick = () => FMQ.quitToMenu();

  FMQ.buildPlayersConfig();
  FMQ.renderPlayerSwitchPanel();
  FMQ.$("endTypeSelect").dispatchEvent(new Event("change"));
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

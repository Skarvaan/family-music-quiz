window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: main.js orchestriert Ablauf/Events und verbindet alle Module.

FMQ.prepareTrackForTurn = async () => {
  const mode = FMQ.app.config.mode;
  const draw = mode === "playlistGuess"
    ? FMQ.drawTrackForCurrentTurn({ forceFromAny: true })
    : mode === "timeline"
      ? FMQ.drawTrackForCurrentTurn({ risk: FMQ.app.state.timeline.chosenRisk || "safe" })
      : FMQ.drawTrackForCurrentTurn({ risk: "safe" });

  if (!draw?.track) throw new Error("Keine Songs mehr übrig.");
  FMQ.app.state.currentTrack = draw.track;
  FMQ.app.state.currentSourcePlayerId = draw.sourcePlayerId;

  if (mode === "yearRange") {
    const built = FMQ.modes.yearRange.buildOptionsForYear(draw.track.year, FMQ.app.state.yearRange.step);
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
  FMQ.app.state.isPlaying = false;
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.selfCheckPending = false;
  FMQ.app.state.quick3.randomStartMs = null;

  FMQ.$("readyBtn").style.display = "";
  FMQ.$("playToggleBtn").style.display = "";
  FMQ.$("revealBtn").style.display = "";
  FMQ.$("nextBtn").style.display = "";
  FMQ.$("quick3Controls").style.display = "none";
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = true;
  FMQ.$("nextBtn").disabled = true;
  FMQ.$("playToggleBtn").disabled = true;
  FMQ.$("playToggleBtn").textContent = "▶️ Play";

  const mode = FMQ.app.config.mode;
  FMQ.modes[mode].renderArea();

  if (mode === "timeline") {
    FMQ.app.state.timeline.chosenRisk = "safe";
    FMQ.showRiskOverlay(true);
    FMQ.$("readyBtn").disabled = false;
    FMQ.$("revealBtn").disabled = false;
    FMQ.app.state.timeline.chosenSlot = FMQ.currentPlayer().timelineCards.length;
    FMQ.modes.timeline.renderArea();
  } else if (mode === "yearRange") {
    FMQ.app.state.yearRange = { step: null, points: 0, options: [], correctIdx: -1, picks: new Map() };
    FMQ.showRangeOverlay(true);
    FMQ.$("readyBtn").disabled = true;
  } else if (mode === "quick3") {
    FMQ.$("screenGame").classList.add("quick3Active");
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    FMQ.$("quick3Controls").style.display = "flex";
    FMQ.$("revealBtn").disabled = false;
  } else {
    FMQ.$("readyBtn").disabled = false;
    FMQ.$("revealBtn").disabled = false;
  }

  FMQ.$("turnFlowHint").textContent = mode === "quick3"
    ? "Ablauf: Clip-Länge wählen → Play-Start/Play-Zufall → Reveal → Punkte eintragen und weiter"
    : "Ablauf: Bereit → Reveal → Weiter";

  FMQ.renderHeader();
  FMQ.renderScoreTable();
};

FMQ.onReady = async () => {
  await FMQ.prepareTrackForTurn();
  FMQ.showRiskOverlay(false);
  FMQ.showRangeOverlay(false);

  await FMQ.playTrackUri(FMQ.app.state.currentTrack.uri, { positionMs: 0 });
  FMQ.app.state.isPlaying = true;
  FMQ.$("readyBtn").disabled = true;
  FMQ.$("revealBtn").disabled = false;
  FMQ.$("playToggleBtn").disabled = false;
  FMQ.$("playToggleBtn").textContent = "⏸️ Stop";
  FMQ.renderHeader();
};

FMQ.onTogglePlay = async () => {
  if (!FMQ.app.state.currentTrack) return;
  if (FMQ.app.state.isPlaying) {
    await FMQ.pausePlayback();
    FMQ.app.state.isPlaying = false;
    FMQ.$("playToggleBtn").textContent = "▶️ Play";
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
  const hasReached = FMQ.app.players.some(p => p.score >= FMQ.app.config.targetPoints);
  if (hasReached && !FMQ.app.state.finalRound.pending) {
    FMQ.app.state.finalRound.pending = true;
    FMQ.app.state.finalRound.roundNumber = FMQ.app.state.round;
  }
};

FMQ.checkFinishAfterNext = () => {
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
  const owners = (t.owners || []).map(FMQ.getPlayerName).join(", ");

  FMQ.$("revealBox").style.display = "block";
  FMQ.$("revealText").innerHTML = `<div style="font-size:18px; font-weight:900;">${FMQ.escapeHtml(res.headline)}</div><div><b>${FMQ.escapeHtml(t.name)}</b><br><span class="muted">${FMQ.escapeHtml(t.artists.join(", "))}</span><br>Jahr: <b>${t.year}</b><br><span class="muted">${FMQ.escapeHtml(mode === "playlistGuess" ? `Song ist in Playlist(s): ${owners}` : `Quelle: ${FMQ.getPlayerName(FMQ.app.state.currentSourcePlayerId)}`)}</span><br><span class="muted">${FMQ.escapeHtml(res.detail || "")}</span></div>`;

  if (mode === "guessSong") FMQ.modes.guessSong.renderRevealExtras();

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
};

FMQ.finishGame = (winnerPlayer, reason) => {
  FMQ.showRiskOverlay(false);
  FMQ.showRangeOverlay(false);
  FMQ.showScreen("screenWinner");
  FMQ.$("winnerHeadline").textContent = winnerPlayer ? `${winnerPlayer.name} gewinnt!` : "Spiel beendet";
  FMQ.$("winnerSub").textContent = reason || "";
  FMQ.$("finalScoreTable").innerHTML = ["<tr><th>Spieler</th><th>Punkte</th></tr>", ...[...FMQ.app.players].sort((a, b) => b.score - a.score).map(p => `<tr><td>${FMQ.escapeHtml(p.name)}</td><td><b>${p.score}</b></td></tr>`)].join("");
};

FMQ.onNext = () => {
  const winner = FMQ.checkFinishAfterNext();
  if (winner) {
    FMQ.finishGame(winner, `Zielpunkte wurden in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  FMQ.advanceTurn();

  const winnerAfterAdvance = FMQ.checkFinishAfterNext();
  if (winnerAfterAdvance) {
    FMQ.finishGame(winnerAfterAdvance, `Zielpunkte wurden in Runde ${FMQ.app.state.finalRound.roundNumber} erreicht. Runde wurde fair zu Ende gespielt.`);
    return;
  }

  FMQ.resetTurnUI();
};

FMQ.quitToMenu = async () => {
  try { await FMQ.pausePlayback(); } catch {}
  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.showRiskOverlay(false);
  FMQ.showRangeOverlay(false);
  FMQ.$("quick3RevealOverlay").classList.remove("show");
  FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("screenGame").classList.remove("quick3Active");
  FMQ.app.state.setupStep = 1;
  FMQ.showScreen("screenSetup");
  FMQ.renderSetupWizard();
  FMQ.setGameDebug("");
};

FMQ.startGame = () => {
  FMQ.app.config.mode = FMQ.$("modeSelect").value;
  FMQ.app.config.party = FMQ.$("partySelect").value;
  FMQ.app.config.targetPoints = Math.max(1, parseInt(FMQ.$("targetPointsInput").value || "15", 10));
  FMQ.resetSession();
  FMQ.showScreen("screenGame");
  FMQ.resetTurnUI();
};

FMQ.renderPlayStyleButtons = () => {
  document.querySelectorAll("[data-play-style]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-play-style") === FMQ.app.config.party);
  });
};

FMQ.renderModeButtons = () => {
  const modeMeta = [
    { id: "timeline", label: "Timeline (Einordnen)", party: ["rotate"] },
    { id: "guessSong", label: "Song raten", party: ["rotate"] },
    { id: "quick3", label: "3-Sekunden Challenge", party: ["rotate"] },
    { id: "yearRange", label: "Zeitraum raten (MC)", party: ["rotate", "allguess"] },
    { id: "playlistGuess", label: "Welche Playlist ist das?", party: ["rotate", "allguess"] }
  ];
  const allowed = modeMeta.filter(m => m.party.includes(FMQ.app.config.party));
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

FMQ.renderSetupSummary = () => {
  const players = FMQ.app.players.map(p => `<li>${FMQ.escapeHtml(p.name)} · ${FMQ.escapeHtml(p.playlistName || "keine Playlist")}</li>`).join("");
  FMQ.$("setupSummary").innerHTML = `
    <div class="summaryCard">
      <h2 style="margin-bottom:8px;">Deine Einstellungen</h2>
      <div><b>Spielart:</b> ${FMQ.app.config.party === "allguess" ? "Party-Modus" : "Eigene Playlists / Reihum"}</div>
      <div><b>Modus:</b> ${FMQ.escapeHtml(FMQ.modes[FMQ.$("modeSelect").value]?.label || FMQ.$("modeSelect").value)}</div>
      <div><b>Zielpunkte:</b> ${FMQ.$("targetPointsInput").value}</div>
      <div><b>Spieler:</b> ${FMQ.app.players.length}</div>
      <ul>${players}</ul>
    </div>
  `;
};

FMQ.setupCanProceed = () => {
  const step = FMQ.app.state.setupStep || 1;
  if (step === 1) return !!FMQ.storage.token;
  if (step === 2) return !!FMQ.app.config.party;
  if (step === 3) return !!FMQ.$("modeSelect").value;
  if (step === 4) {
    const playlistSelects = [...document.querySelectorAll('select[data-role="playlist"]')];
    const uiHasAllPlaylists = playlistSelects.length > 0 && playlistSelects.every(sel => !!sel.value);
    const modelHasAllPlaylists = FMQ.app.players.length > 0 && FMQ.app.players.every(p => p.playlistId && (p.tracks?.length || 0) >= 5 && p.refYear);
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
    FMQ.$("setupWizardTitle").textContent = "Schritt 2 · Spielart";
    FMQ.$("setupWizardSub").textContent = "Wähle zwischen Reihum und Party-Modus.";
  } else if (step === 3) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 3 · Modus";
    FMQ.$("setupWizardSub").textContent = "Wähle den Spielmodus als große Schaltfläche.";
  } else if (step === 4) {
    FMQ.$("setupWizardTitle").textContent = "Schritt 4 · Punkte & Spieler";
    FMQ.$("setupWizardSub").textContent = "Lege Zielpunkte und Spieleranzahl fest.";
  } else {
    FMQ.$("setupWizardTitle").textContent = "Schritt 5 · Zusammenfassung";
    FMQ.$("setupWizardSub").textContent = "Prüfe alles und starte das Spiel.";
    FMQ.renderSetupSummary();
  }
  FMQ.$("setupBackBtn").disabled = step <= 1;
  FMQ.$("setupNextBtn").style.display = step >= 5 ? "none" : "";
  FMQ.$("setupNextBtn").disabled = !FMQ.setupCanProceed();
  if (step === 1 && !FMQ.storage.token) {
    FMQ.$("setupStepHint").textContent = "Verbinde zuerst Spotify, dann wird „Weiter“ aktiv.";
  } else if (step === 4 && !FMQ.setupCanProceed()) {
    FMQ.$("setupStepHint").textContent = "Bitte für jeden Spieler eine Playlist laden (mind. 5 Tracks), dann kannst du weiter.";
  } else {
    FMQ.$("setupStepHint").textContent = "";
  }
  FMQ.renderPlayStyleButtons();
  FMQ.renderModeButtons();
};

FMQ.init = async () => {
  FMQ.$("redirectUriPill").textContent = FMQ.REDIRECT_URI;

  FMQ.$("overlaySafeBtn").onclick = () => { FMQ.app.state.timeline.chosenRisk = "safe"; FMQ.showRiskOverlay(false); };
  FMQ.$("overlayWagnisBtn").onclick = () => { FMQ.app.state.timeline.chosenRisk = "wagnis"; FMQ.showRiskOverlay(false); };
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

  FMQ.$("loginBtn").onclick = () => FMQ.loginSpotify().catch(e => FMQ.setDebug(e.message));
  FMQ.$("logoutBtn").onclick = () => FMQ.logoutSpotify();
  FMQ.$("loadMyPlaylistsBtn").onclick = () => FMQ.loadMyPlaylists().catch(e => { FMQ.$("playlistStatus").textContent = "❌ " + e.message; FMQ.setDebug(e.stack || e.message); });
  FMQ.$("buildPlayersBtn").onclick = () => FMQ.buildPlayersConfig();
  FMQ.$("modeSelect").onchange = () => { FMQ.renderModeHints(); FMQ.renderModeButtons(); FMQ.renderSetupWizard(); };
  FMQ.$("targetPlusBtn").onclick = () => {
    FMQ.$("targetPointsInput").value = String(Math.min(999, parseInt(FMQ.$("targetPointsInput").value || "15", 10) + 1));
  };
  FMQ.$("targetMinusBtn").onclick = () => {
    FMQ.$("targetPointsInput").value = String(Math.max(1, parseInt(FMQ.$("targetPointsInput").value || "15", 10) - 1));
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
  document.querySelectorAll("[data-play-style]").forEach(btn => {
    btn.onclick = () => {
      const style = btn.getAttribute("data-play-style");
      FMQ.app.config.party = style;
      FMQ.$("partySelect").value = style;
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
    FMQ.app.state.setupStep = Math.min(5, FMQ.app.state.setupStep + 1);
    FMQ.renderSetupWizard();
  };
  FMQ.$("startGameBtn").onclick = () => FMQ.startGame();
  FMQ.$("readyBtn").onclick = () => FMQ.onReady().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("playToggleBtn").onclick = () => FMQ.onTogglePlay().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("revealBtn").onclick = () => FMQ.onReveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("nextBtn").onclick = () => FMQ.onNext();
  FMQ.$("quitBtn").onclick = () => FMQ.quitToMenu();
  FMQ.$("endBtn").onclick = () => FMQ.quitToMenu();

  FMQ.buildPlayersConfig();
  FMQ.renderModeHints();
  FMQ.refreshConnStatus();
  FMQ.renderSetupWizard();

  try { await FMQ.handleOAuthCallbackIfPresent(); } catch (e) { FMQ.setDebug(e.stack || e.message); }
  if (FMQ.storage.token && !FMQ.app.playlists.length) {
    try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "❌ " + e.message; }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FMQ.init();
});

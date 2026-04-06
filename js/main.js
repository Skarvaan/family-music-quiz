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

  clearTimeout(FMQ.app.state.playTimer);
  FMQ.app.state.playTimer = null;
  FMQ.app.state.isPlaying = false;
  FMQ.app.state.currentTrack = null;
  FMQ.app.state.currentSourcePlayerId = null;
  FMQ.app.state.selfCheckPending = false;
  FMQ.app.state.quick3.randomStartMs = null;

  FMQ.$("readyBtn").style.display = "";
  FMQ.$("playToggleBtn").style.display = "";
  FMQ.$("quick3Controls").style.display = "none";
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
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("quick3Controls").style.display = "flex";
  } else {
    FMQ.$("readyBtn").disabled = false;
    FMQ.$("revealBtn").disabled = false;
  }

  FMQ.$("turnFlowHint").textContent = mode === "quick3"
    ? "Ablauf: Clip-Länge wählen → Play-Start/Play-Zufall (beliebig wiederholen) → Reveal → Selbst-Check → Weiter"
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
  if (mode === "quick3") FMQ.modes.quick3.renderRevealExtras();
  if (mode === "quick3") {
    if (FMQ.$("quick3PlayStartBtn")) FMQ.$("quick3PlayStartBtn").disabled = true;
    if (FMQ.$("quick3PlayRandomBtn")) FMQ.$("quick3PlayRandomBtn").disabled = true;
    if (FMQ.$("quick3LenSelect")) FMQ.$("quick3LenSelect").disabled = true;
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
  FMQ.showScreen("screenSetup");
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

FMQ.init = async () => {
  FMQ.$("redirectUriPill").textContent = FMQ.REDIRECT_URI;

  FMQ.$("overlaySafeBtn").onclick = () => { FMQ.app.state.timeline.chosenRisk = "safe"; FMQ.showRiskOverlay(false); };
  FMQ.$("overlayWagnisBtn").onclick = () => { FMQ.app.state.timeline.chosenRisk = "wagnis"; FMQ.showRiskOverlay(false); };
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
  FMQ.$("modeSelect").onchange = () => FMQ.renderModeHints();
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

  try { await FMQ.handleOAuthCallbackIfPresent(); } catch (e) { FMQ.setDebug(e.stack || e.message); }
  if (FMQ.storage.token && !FMQ.app.playlists.length) {
    try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "❌ " + e.message; }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FMQ.init();
});

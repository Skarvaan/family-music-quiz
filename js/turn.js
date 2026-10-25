window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Spielablauf: Zug vorbereiten, abspielen, auflösen, weiterschalten,
   Pausen anwenden und das Spiel beenden. */

/* Ein einzelner Zug: Song ziehen, abspielen, Oberfläche zurücksetzen. */

FMQ.ensureActiveTurnIndex = () => {
  const cur = FMQ.app.players[FMQ.app.state.turnIndex];
  if (cur && cur.active !== false) return;
  const first = FMQ.activePlayers().find(p => p.spectator !== true) || FMQ.activePlayers()[0];
  if (!first) return;
  FMQ.app.state.turnIndex = Math.max(0, FMQ.app.players.findIndex(p => p.id === first.id));
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
  FMQ.app.state.quick3.advanceAfterSelfCheck = false;
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

  if (mode === "bestFit") {
    const me = FMQ.currentPlayer();
    const ownIds = FMQ.shuffle((me?.tracks || []).map(t => t.id).filter(id => id && !FMQ.isTrackUsed(id)));
    if (ownIds.length < 2) throw new Error("Für Song A/B werden mindestens 2 ungenutzte Songs in der Haupt-Playlist benötigt.");
    const aId = ownIds.pop();
    const bId = ownIds.pop();
    FMQ.app.state.bestFitTracks = {
      a: FMQ.app.trackMap.get(aId),
      b: FMQ.app.trackMap.get(bId)
    };
    FMQ.markTrackUsed(FMQ.app.state.bestFitTracks.a);
    FMQ.markTrackUsed(FMQ.app.state.bestFitTracks.b);
    FMQ.app.state.currentTrack = FMQ.app.state.bestFitTracks.a;
    FMQ.app.state.currentSourcePlayerId = me.id;
  } else {
    const draw = mode === "introPlaylistGuess"
      ? FMQ.modes.introPlaylistGuess.drawUniqueTrack()
      : FMQ.drawTrackForCurrentTurn({ risk: "safe" });
    if (!draw?.track) throw new Error("Keine Songs mehr übrig.");
    FMQ.app.state.currentTrack = draw.track;
    FMQ.app.state.currentSourcePlayerId = draw.sourcePlayerId;
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
  FMQ.app.state.quick3.advanceAfterSelfCheck = false;
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
  if (["storyPrompt", "promptDuel", "introPlaylistGuess"].includes(mode)) FMQ.$("turnPlayerBanner").style.display = "none";
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
  } else if (FMQ.isSocialMode(mode) || ["storyPrompt", "promptDuel"].includes(mode)) {
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = ["storyPrompt", "promptDuel"].includes(mode) ? "none" : "";
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

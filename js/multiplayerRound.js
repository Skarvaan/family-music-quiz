window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Ablauf einer Runde über mehrere Geräte: Fragen stellen, Antworten sammeln. */

FMQ.submitAnswer = (playerId, answer) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitAnswerToSession(session, playerId, answer);
  FMQ.renderMultiplayerPanel?.();
  return answer;
};

FMQ.submitVote = (playerId, vote) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitVoteToSession(session, playerId, vote);
  FMQ.renderMultiplayerPanel?.();
  return vote;
};

FMQ.submitMainAnswer = (playerId, answer) => {
  const session = FMQ.app.state.social;
  if (!session) return null;
  FMQ.submitMainAnswerToSession(session, playerId, answer);
  FMQ.renderMultiplayerPanel?.();
  return answer;
};

FMQ.handleMultiplayerAnswer = (payload) => {
  const mode = FMQ.app.config.mode;
  FMQ.multiplayer.answeredPlayerIds.add(payload.playerId);
  if (payload.type === "bestFitVote" || payload.type === "bestFitAll" || payload.type === "bestFitMain") {
    const s = FMQ.app.state.social;
    if (payload.playerId === s?.mainPlayerId) FMQ.submitMainAnswer(payload.playerId, payload.answer);
    else FMQ.submitVote(payload.playerId, payload.answer);
  } else if (payload.type === "ratingGuessAll" || payload.type === "ratingGuessMain") {
    const s = FMQ.app.state.social;
    if (payload.playerId === s?.mainPlayerId) FMQ.submitMainAnswer(payload.playerId, parseInt(payload.answer, 10));
    else FMQ.submitVote(payload.playerId, parseInt(payload.answer, 10));
  } else if (payload.type === "quick3SelfCheck") {
    FMQ.modes.quick3.submitAnswer(payload.playerId, payload.answer || {});
  } else if (payload.type === "introPlaylistGuess") {
    FMQ.modes.introPlaylistGuess.submitAnswer(payload.playerId, payload.answer);
    FMQ.modes.introPlaylistGuess.renderGuessUI?.();
    FMQ.renderMultiplayerPanel?.();
    return;
  } else if (payload.type === "rankingList") {
    FMQ.modes.rankingList.submitAnswer(payload.playerId, { track: FMQ.app.state.currentTrack, rank: parseInt(payload.answer, 10) });
  } else if (payload.type === "songChallengeShared") {
    FMQ.modes.songChallenge.submitShared(payload.playerId, payload.answer);
  } else if (payload.type === "songChallengeDuelSubmit") {
    FMQ.modes.songChallenge.submitDuel(payload.playerId, payload.answer, FMQ.multiplayer.prompt?.meta || {});
  } else if (payload.type === "songChallengeDuelVote") {
    FMQ.modes.songChallenge.submitVote(payload.playerId, payload.answer, FMQ.multiplayer.prompt?.meta || {});
  }
  if (FMQ.modes[mode]?.renderArea) FMQ.modes[mode].renderArea();
  if (payload.type === "ratingGuessMain") setTimeout(() => FMQ.$("ratingRevealBtn")?.click(), 0);
};

FMQ.getMultiplayerExpectedIds = ({ includeMain = false } = {}) => {
  const s = FMQ.app.state.social;
  const ids = FMQ.activePlayers()
    .filter(p => includeMain ? p.id === s?.mainPlayerId : p.id !== s?.mainPlayerId)
    .map(p => p.remoteId || p.id);
  return ids;
};

FMQ.hasAnsweredAll = (expectedIds, answersByPlayer = {}) => expectedIds.every(id => Object.prototype.hasOwnProperty.call(answersByPlayer, id));

FMQ.startMultiplayerPrompt = (payload) => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.prompt = payload;
  FMQ.multiplayer.answeredPlayerIds = new Set();
  FMQ.multiplayer.socket.emit("host:startPrompt", payload, res => {
    if (!res?.ok) FMQ.setGameDebug?.(res?.error || "Prompt konnte nicht gestartet werden.");
  });
};

FMQ.resetMultiplayerRound = () => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.prompt = null;
  FMQ.multiplayer.answeredPlayerIds = new Set();
  FMQ.multiplayer.socket.emit("host:resetRound", {});
};

FMQ.revealMultiplayerPrompt = (payload = {}) => {
  if (!FMQ.isMultiDevice() || !FMQ.multiplayer.socket) return;
  FMQ.multiplayer.socket.emit("host:reveal", payload);
};

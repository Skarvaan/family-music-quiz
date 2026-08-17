window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Songziehung, Punktevergabe und die Anzeige von Punktestand und Kopfzeile. */

FMQ.drawFromDeck = (deck) => {
  while (deck.length) {
    const id = deck.pop();
    if (!id || FMQ.isTrackUsed(id)) continue;
    const track = FMQ.app.trackMap.get(id) || null;
    if (track) FMQ.markTrackUsed(track);
    return track;
  }
  return null;
};

FMQ.drawTrackForCurrentTurn = ({ risk = null, forceFromAny = false } = {}) => {
  const me = FMQ.currentPlayer();
  const active = FMQ.musicPlayers();
  if (!me || !active.length) return null;
  const drawFromPlayer = (p) => {
    const deck = FMQ.shuffle((p.tracks || []).map(t => t.id).filter(id => id && !FMQ.isTrackUsed(id)));
    while (deck.length) {
      const id = deck.pop();
      const track = FMQ.app.trackMap.get(id);
      if (track) {
        FMQ.markTrackUsed(track);
        return { track, sourcePlayerId: p.id };
      }
    }
    return null;
  };

  if (forceFromAny) {
    const activeIds = new Set(active.map(p => p.id));
    const candidateIds = [...FMQ.app.trackMap.entries()]
      .filter(([, t]) => (t.owners || []).some(id => activeIds.has(id)))
      .map(([id]) => id)
      .filter(id => !FMQ.isTrackUsed(id));
    const track = FMQ.drawFromDeck(FMQ.shuffle(candidateIds));
    if (!track) return null;
    const owners = (track.owners || []).filter(id => activeIds.has(id));
    return { track, sourcePlayerId: owners[Math.floor(Math.random() * owners.length)] || me.id };
  }

  if (risk === "wagnis" && active.length >= 2) {
    const src = FMQ.shuffle(active.filter(p => p.id !== me.id))[0];
    const res = src && drawFromPlayer(src);
    if (res) return res;
  }

  return drawFromPlayer(me) || FMQ.drawTrackForCurrentTurn({ forceFromAny: true });
};

FMQ.awardPoints = (pid, delta) => {
  const p = FMQ.app.players.find(x => x.id === pid);
  if (p) p.score += delta;
};

FMQ.renderScoreTable = () => {
  FMQ.$("scoreTable").innerHTML = FMQ.app.players
    .map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${FMQ.app.config.endType === "points" ? `${p.score} / ${FMQ.app.config.targetPoints}` : `${p.score} Punkte`}</div><div class="span">Spanne: ${p.spanMin && p.spanMax ? `${p.spanMin}–${p.spanMax}` : "–"}</div></div>`)
    .join("");
};

FMQ.renderHeader = () => {
  const me = FMQ.currentPlayer();
  if (!me) return;
  FMQ.$("gameModeLabel").textContent = FMQ.modes[FMQ.app.config.mode]?.label || FMQ.app.config.mode;
  FMQ.$("gameModeSub").textContent = FMQ.app.config.party === "allguess" ? "Alle raten" : "Reihum";
  FMQ.$("roundLabel").textContent = `Runde ${FMQ.app.state.round}`;
  FMQ.$("turnPlayerName").textContent = me.name;
  FMQ.$("turnInfo").textContent = `Spanne: ${(me.spanMin && me.spanMax) ? `${me.spanMin}–${me.spanMax}` : "?"}`;
  FMQ.$("globalUsedLabel").textContent = String(FMQ.app.usedTrackIds.size);
};

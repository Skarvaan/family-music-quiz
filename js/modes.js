window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: modes.js enthält nur modus-spezifische Render- und Spielregeln.

FMQ.renderModeLikeQuick3 = ({ heading, subtitle, bodyHtml, panelClass = "", heroName = undefined }) => {
  const me = FMQ.currentPlayer();
  const hero = heroName === undefined ? (me?.name || "") : (heroName || "");
  FMQ.$("modeArea").innerHTML = `
    <div class="quick3Hero">
      <div class="name">${FMQ.escapeHtml(hero)}</div>
      <div class="sub muted">${FMQ.escapeHtml(subtitle || "")}</div>
    </div>
    <div class="quick3Stage">
      <div class="quick3Panel ${panelClass}">
        <h3>${FMQ.escapeHtml(heading)}</h3>
        ${bodyHtml || ""}
      </div>
    </div>
  `;
  if (typeof FMQ.applyAccessibilityLabels === "function") FMQ.applyAccessibilityLabels();
};

FMQ.initSocialRound = ({ modeId, startPhase = "othersGuessing" }) => {
  const mainPlayerId = FMQ.app.state.currentSourcePlayerId || FMQ.currentPlayer().id;
  const activePlayers = FMQ.activePlayers();
  FMQ.app.state.social = {
    modeId,
    phase: startPhase,
    mainPlayerId,
    respondingPlayersQueue: activePlayers.filter(p => p.id !== mainPlayerId).map(p => p.id),
    currentResponderIndex: 0,
    answers: new Map(),
    answersByPlayer: {},
    votes: {},
    mainAnswers: {},
    mainAnswer: null
  };
};
FMQ.getSocialResponderId = () => {
  const s = FMQ.app.state.social;
  if (!s) return null;
  return s.respondingPlayersQueue[s.currentResponderIndex] || null;
};

FMQ.submitAnswerToSession = (session, playerId, answer) => {
  if (!session.answersByPlayer) session.answersByPlayer = {};
  session.answersByPlayer[playerId] = answer;
  if (session.answers?.set) session.answers.set(playerId, answer);
};
FMQ.submitVoteToSession = (session, playerId, vote) => {
  if (!session.votes) session.votes = {};
  session.votes[playerId] = vote;
  FMQ.submitAnswerToSession(session, playerId, vote);
};
FMQ.submitMainAnswerToSession = (session, playerId, answer) => {
  if (!session.mainAnswers) session.mainAnswers = {};
  session.mainAnswers[playerId] = answer;
  session.mainAnswer = answer;
};


FMQ.getStoredStartMs = (track, key, mode = "start") => {
  if (mode !== "random") return 0;
  FMQ.app.state.modeStartMs = FMQ.app.state.modeStartMs || {};
  const storeKey = `${key}:${track.id}`;
  if (typeof FMQ.app.state.modeStartMs[storeKey] === "number") return FMQ.app.state.modeStartMs[storeKey];
  const dur = track.durationMs || 180000;
  const min = Math.floor(dur * 0.25);
  const max = Math.max(min, Math.floor(dur * 0.7));
  const start = max <= min ? Math.floor(dur / 2) : Math.floor(min + Math.random() * (max - min));
  FMQ.app.state.modeStartMs[storeKey] = start;
  return start;
};

FMQ.socialPlaybackStart = async (uri, { fromStart = false, key = "default" } = {}) => {
  if (!FMQ.app.state.socialPlayback) FMQ.app.state.socialPlayback = {};
  if (!FMQ.app.state.socialPlayback[key]) FMQ.app.state.socialPlayback[key] = { uri, posMs: 0, startedAt: null, basePosMs: 0 };
  const pb = FMQ.app.state.socialPlayback[key];
  if (fromStart || pb.uri !== uri) pb.posMs = 0;
  pb.uri = uri;
  pb.basePosMs = pb.posMs || 0;
  pb.startedAt = Date.now();
  await FMQ.playTrackUri(uri, { positionMs: pb.basePosMs });
  FMQ.app.state.isPlaying = true;
};

FMQ.socialPlaybackPause = async ({ key = "default" } = {}) => {
  const pb = FMQ.app.state.socialPlayback?.[key];
  if (pb?.startedAt) {
    pb.posMs = Math.max(0, pb.basePosMs + (Date.now() - pb.startedAt));
    pb.startedAt = null;
  }
  await FMQ.pausePlayback();
  FMQ.app.state.isPlaying = false;
};

// =========================================================
// MODUS-DEFINITIONEN
// =========================================================
FMQ.modes = {
  guessSong: {
    label: "Song erkennen",
    supportsAllGuess: false,
    submitAnswer(playerId, answer) {
      const pts = (answer.title ? 1 : 0) + (answer.artist ? 1 : 0) + (answer.year ? 1 : 0);
      FMQ.awardPoints(playerId, pts);
      return { points: pts };
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Song raten";
      FMQ.renderModeLikeQuick3({
        heading: "Song raten",
        subtitle: "Höre den Song und bestätige nach Reveal deinen Selbst-Check.",
        panelClass: "theme-guess"
      });
    },
    onReveal() {
      FMQ.app.state.selfCheckPending = true;
      return { headline: "Auflösung", detail: "Selbst-Check notwendig" };
    },
    renderRevealExtras() {
      const me = FMQ.currentPlayer();
      FMQ.$("revealExtra").innerHTML = `
        <div class="box" style="box-shadow:none;">
          <h2>Selbst-Check</h2>
          <div class="selfCheckList">
            <label class="selfCheckItem"><input type="checkbox" id="chkTitle"> Titel (1)</label>
            <label class="selfCheckItem"><input type="checkbox" id="chkArtist"> Interpret (1)</label>
            <label class="selfCheckItem"><input type="checkbox" id="chkYear"> Jahr (1)</label>
          </div>
          <div class="row selfCheckActions">
            <button id="confirmGuessPtsBtn" class="primary">Punkte bestätigen</button>
            <span class="muted" id="guessPtsStatus"></span>
          </div>
        </div>
      `;
      FMQ.$("confirmGuessPtsBtn").onclick = () => {
        const result = FMQ.modes.guessSong.submitAnswer(me.id, {
          title: FMQ.$("chkTitle").checked,
          artist: FMQ.$("chkArtist").checked,
          year: FMQ.$("chkYear").checked
        });
        const pts = result.points;
        FMQ.app.state.selfCheckPending = false;
        FMQ.$("guessPtsStatus").innerHTML = `<span class="ok">+${pts} Punkte bestätigt</span>`;
        FMQ.$("confirmGuessPtsBtn").disabled = true;
        FMQ.$("nextBtn").disabled = false;
        FMQ.renderScoreTable();
      };
    }
  },
  speedGuess: {
    label: "Zeitdruck",
    supportsAllGuess: false,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Zeitdruck";
      FMQ.renderModeLikeQuick3({
        heading: "Zeitdruck",
        subtitle: "Je länger du brauchst, desto weniger Punkte. Stoppe, wenn du sicher bist.",
        panelClass: "theme-guess",
        bodyHtml: `<div class="speedWrap"><div class="speedBar"><div id="speedBarFill" class="speedBarFill"></div></div><div class="speedStats"><b>Punkte: <span id="speedPtsLabel">4</span></b> · Nächster Abzug in <span id="speedTickLabel">6</span>s</div><div class="row" style="justify-content:center;"><button id="speedStopBtn" class="big primary">Stop, ich weiß es!</button></div><div class="row" style="justify-content:center;"><button id="speedRevealInlineBtn" class="big" disabled>Reveal</button></div></div>`
      });
      FMQ.$("speedStopBtn").onclick = async () => {
        try { await FMQ.pausePlayback(); } catch {}
        FMQ.app.state.speed = FMQ.app.state.speed || { currentPoints: 4 };
        FMQ.app.state.speed.locked = true;
        FMQ.$("speedRevealInlineBtn").disabled = false;
        FMQ.$("speedStopBtn").disabled = true;
      };
      FMQ.$("speedRevealInlineBtn").onclick = () => FMQ.$("revealBtn").click();
    },
    startCountdown() {
      FMQ.app.state.speed = { currentPoints: 4, timer: null, elapsed: 0, stepSec: 6, locked: false };
      const tick = () => {
        const s = FMQ.app.state.speed;
        if (!s || s.locked) return;
        s.elapsed += 0.2;
        const dec = Math.floor(s.elapsed / s.stepSec);
        s.currentPoints = Math.max(0, 4 - dec);
        const untilNext = Math.max(0, s.stepSec - (s.elapsed % s.stepSec));
        const total = 4 * s.stepSec;
        const leftPct = Math.max(0, ((total - s.elapsed) / total) * 100);
        if (FMQ.$("speedPtsLabel")) FMQ.$("speedPtsLabel").textContent = String(s.currentPoints);
        if (FMQ.$("speedTickLabel")) FMQ.$("speedTickLabel").textContent = String(Math.ceil(untilNext));
        if (FMQ.$("speedBarFill")) FMQ.$("speedBarFill").style.width = `${leftPct}%`;
      };
      FMQ.app.state.speed.timer = setInterval(tick, 200);
    },
    onReveal() {
      FMQ.app.state.selfCheckPending = true;
      return { headline: "Auflösung", detail: "Selbst-Check wie im Ausschnitt-Modus." };
    },
    renderRevealExtras() {
      const me = FMQ.currentPlayer();
      FMQ.$("revealExtra").innerHTML = `
        <div class="box" style="box-shadow:none;">
          <h2>Selbst-Check</h2>
          <div class="selfCheckList">
            <label class="selfCheckItem"><input type="checkbox" id="speedChkTitle"> Titel (1)</label>
            <label class="selfCheckItem"><input type="checkbox" id="speedChkArtist"> Interpret (1)</label>
            <label class="selfCheckItem"><input type="checkbox" id="speedChkYear"> Jahr (1)</label>
          </div>
          <div class="row" style="justify-content:center;">
            <button id="speedConfirmBtn" class="big primary">Punkte eintragen und weiter</button>
          </div>
        </div>
      `;
      FMQ.$("speedConfirmBtn").onclick = () => {
        const selfPts = (FMQ.$("speedChkTitle").checked ? 1 : 0) + (FMQ.$("speedChkArtist").checked ? 1 : 0) + (FMQ.$("speedChkYear").checked ? 1 : 0);
        const timePts = Math.max(0, FMQ.app.state.speed?.currentPoints ?? 0);
        FMQ.awardPoints(me.id, selfPts + timePts);
        FMQ.app.state.selfCheckPending = false;
        FMQ.renderScoreTable();
        FMQ.markFinalRoundIfNeeded();
        FMQ.onNext();
      };
    }
  },
  quick3: {
    label: "Songausschnitt raten",
    supportsAllGuess: false,
    submitAnswer(playerId, answer) {
      FMQ.app.state.quick3.answers[playerId] = answer;
      return FMQ.modes.guessSong.submitAnswer(playerId, answer);
    },
    renderArea() {
      const me = FMQ.currentPlayer();
      FMQ.$("modeAreaTitle").textContent = "Songausschnitt raten";
      FMQ.$("modeArea").innerHTML = `
        <div class="quick3Hero">
          <div class="name">${FMQ.escapeHtml(me.name)}</div>
          <div class="sub muted">Wähle Sekunden und starte mit Play-Start oder Play-Zufall.</div>
          <div class="row" style="justify-content:center; margin-top:8px;">
            <button id="quick3HelpBtn">Anleitung</button>
          </div>
        </div>
        <div class="quick3Stage">
          <div class="quick3Panel">
            <div class="quick3Controls" id="quick3InlineControls">
              <select id="quick3LenSelectInline">
                <option value="3">3 Sekunden</option>
                <option value="5">5 Sekunden</option>
                <option value="10">10 Sekunden</option>
                <option value="full">Ganzer Song</option>
              </select>
              <button id="quick3PlayStartBtnInline" class="big">▶️ Play-Start</button>
              <button id="quick3PlayRandomBtnInline" class="big">🎲 Play-Zufall</button>
            </div>
            <div class="revealCenter">
              <button id="revealBtnInline" class="big">Reveal</button>
            </div>
          </div>
        </div>
      `;
      FMQ.$("quick3LenSelectInline").value = String(FMQ.app.state.quick3.clipSeconds);
      FMQ.$("quick3LenSelectInline").onchange = () => {
        const nextVal = FMQ.$("quick3LenSelectInline").value;
        FMQ.app.state.quick3.clipSeconds = nextVal === "full" ? "full" : parseInt(nextVal, 10);
      };
      FMQ.$("quick3PlayStartBtnInline").onclick = () => FMQ.onQuick3Play("start").catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("quick3PlayRandomBtnInline").onclick = () => FMQ.onQuick3Play("random").catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("quick3HelpBtn").onclick = () => FMQ.$("quick3HelpOverlay").classList.add("show");
      FMQ.$("revealBtnInline").onclick = () => FMQ.$("revealBtn").click();
    },
    getClipSeconds() { return FMQ.app.state.quick3.clipSeconds || 3; },
    randomStartMs(track) {
      const dur = track.durationMs || 180000;
      const clipSeconds = this.getClipSeconds();
      const clip = clipSeconds === "full" ? 15000 : clipSeconds * 1000;
      const min = 20000;
      const max = Math.max(min, dur - 20000 - clip);
      return max <= min ? 0 : Math.floor(min + Math.random() * (max - min));
    },
    async playStored(track, startMs) {
      await FMQ.playTrackUri(track.uri, { positionMs: startMs });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = null;
      const clipSeconds = this.getClipSeconds();
      if (clipSeconds !== "full") {
        FMQ.app.state.playTimer = setTimeout(async () => {
          try { await FMQ.pausePlayback(); } catch {}
          FMQ.app.state.isPlaying = false;
        }, clipSeconds * 1000);
      }
      FMQ.app.state.isPlaying = true;
    },
    onReveal() {
      FMQ.app.state.selfCheckPending = true;
      return { headline: "Auflösung", detail: "Selbst-Check notwendig" };
    },
    renderRevealExtras() { FMQ.modes.guessSong.renderRevealExtras(); }
  },
  rankingList: {
    label: "Ranking Liste",
    supportsAllGuess: false,
    submitAnswer(playerId, answer) {
      const st = FMQ.app.state.rankingList;
      st.answers[playerId] = answer;
      const size = st.size || 5;
      const list = st.lists[playerId] || [];
      const next = list.filter(item => item.track.id !== answer.track.id);
      next.splice(Math.max(0, answer.rank - 1), 0, { track: answer.track, rank: answer.rank });
      st.lists[playerId] = next.slice(0, size);
    },
    isPlayerComplete(playerId) {
      return (FMQ.app.state.rankingList.lists[playerId] || []).length >= (FMQ.app.state.rankingList.size || 5);
    },
    isComplete() {
      return FMQ.activePlayers().every(p => FMQ.modes.rankingList.isPlayerComplete(p.id));
    },
    renderRanking(playerId) {
      const size = FMQ.app.state.rankingList.size || 5;
      const list = FMQ.app.state.rankingList.lists[playerId] || [];
      return `<div class="rankingSlots ${size === 10 ? "twoCols" : ""}">${Array.from({ length: size }, (_, i) => {
        const item = list[i];
        return `<div class="rankingSlot" data-rank="${i + 1}"><div class="rankBadge">${i + 1}</div><div>${item ? `<b>${FMQ.escapeHtml(item.track.name)}</b><br><span class="muted">${FMQ.escapeHtml(item.track.artists.join(", "))} · ${item.track.year}</span>` : `<span class="muted">Leer</span>`}</div></div>`;
      }).join("")}</div>`;
    },
    async playCurrent() {
      if (!FMQ.app.state.currentTrack) await FMQ.prepareTrackForTurn();
      const t = FMQ.app.state.currentTrack;
      const startMode = FMQ.$("rankingStartModeSelect")?.value || "start";
      const startMs = FMQ.getStoredStartMs(t, `ranking:${FMQ.currentPlayer().id}`, startMode);
      await FMQ.playTrackUri(t.uri, { positionMs: startMs });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = null;
      const secondsRaw = FMQ.$("rankingLenSelect")?.value || "3";
      if (secondsRaw !== "full") {
        FMQ.app.state.playTimer = setTimeout(() => FMQ.pausePlayback().catch(() => {}), parseInt(secondsRaw, 10) * 1000);
      }
    },
    renderArea() {
      const me = FMQ.currentPlayer();
      const st = FMQ.app.state.rankingList;
      FMQ.$("modeAreaTitle").textContent = "Ranking Liste";
      if (!FMQ.app.state.currentTrack) {
        FMQ.renderModeLikeQuick3({ heading: `Ranking von ${me.name}`, subtitle: "Nächster Song wird gezogen …", heroName: "", panelClass: "theme-playlist" });
        FMQ.prepareTrackForTurn().then(() => FMQ.modes.rankingList.renderArea()).catch(e => FMQ.setGameDebug(e.stack || e.message));
        return;
      }
      const t = FMQ.app.state.currentTrack;
      FMQ.renderModeLikeQuick3({
        heading: `Ranking von ${me.name}`,
        subtitle: "Ziehe das Song-Kärtchen auf einen Platz. Belegte Plätze rutschen nach hinten.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="row" style="justify-content:center;"><label><b>Vorauswahl</b></label><select id="rankingSizeSelect"><option value="5">Top 5</option><option value="10">Top 10</option></select></div><div class="quick3Controls" style="justify-content:center; margin-top:10px;"><select id="rankingLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganzer Song</option></select><select id="rankingStartModeSelect"><option value="start">Von Anfang</option><option value="random">Zufall aus der Mitte</option></select><button id="rankingPlayBtn" class="big">▶️ Song hören</button><button id="rankingStopBtn" class="big">⏸️ Stop</button></div><div id="rankingCurrentCard" class="rankingSongCard" draggable="true"><b>${FMQ.escapeHtml(t.name)}</b><br><span>${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</span><div class="muted">Drag mich auf einen Platz</div></div><div id="rankingSlotsWrap" style="margin-top:12px;">${FMQ.modes.rankingList.renderRanking(me.id)}</div><div class="row" style="justify-content:center; margin-top:10px;"><button id="rankingNextBtn" class="big primary" disabled>Weiter</button></div>`
      });
      FMQ.$("rankingSizeSelect").value = String(st.size || 5);
      FMQ.$("rankingSizeSelect").onchange = () => { st.size = parseInt(FMQ.$("rankingSizeSelect").value, 10); FMQ.modes.rankingList.renderArea(); };
      FMQ.$("rankingLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
      FMQ.$("rankingLenSelect").onchange = () => {
        const v = FMQ.$("rankingLenSelect").value;
        FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
      };
      FMQ.$("rankingPlayBtn").onclick = () => FMQ.modes.rankingList.playCurrent().catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("rankingStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
      const card = FMQ.$("rankingCurrentCard");
      card.ondragstart = e => e.dataTransfer.setData("text/plain", FMQ.app.state.currentTrack.id);
      const placeAt = rank => {
        FMQ.modes.rankingList.submitAnswer(me.id, { track: FMQ.app.state.currentTrack, rank });
        FMQ.$("rankingSlotsWrap").innerHTML = FMQ.modes.rankingList.renderRanking(me.id);
        FMQ.$("rankingNextBtn").disabled = false;
        bindSlots();
      };
      const bindSlots = () => {
        FMQ.$("rankingSlotsWrap").querySelectorAll("[data-rank]").forEach(slot => {
          slot.ondragover = e => e.preventDefault();
          slot.ondrop = e => { e.preventDefault(); placeAt(parseInt(slot.getAttribute("data-rank"), 10)); };
          slot.onclick = () => placeAt(parseInt(slot.getAttribute("data-rank"), 10));
        });
      };
      bindSlots();
      FMQ.$("rankingNextBtn").onclick = () => FMQ.onNext();
    },
    renderFinal() {
      FMQ.pausePlayback().catch(() => {});
      FMQ.renderModeLikeQuick3({ heading: "Finale Top-Listen", subtitle: "Wähle einen Spieler, um die gespeicherte Liste zu sehen.", heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="choiceGrid" style="justify-content:center;">${FMQ.activePlayers().map(p => `<button class="choiceBtn" data-final-ranking="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div><div id="finalRankingList" style="margin-top:12px;"></div><div class="row" style="justify-content:center; margin-top:10px;"><button id="rankingEndBtn" class="big primary">Beenden</button></div>` });
      FMQ.$("modeArea").querySelectorAll("[data-final-ranking]").forEach(btn => btn.onclick = () => {
        const pid = btn.getAttribute("data-final-ranking");
        FMQ.$("finalRankingList").innerHTML = `<h3>${FMQ.escapeHtml(FMQ.getPlayerName(pid))}</h3>${FMQ.modes.rankingList.renderRanking(pid)}`;
      });
      FMQ.$("rankingEndBtn").onclick = () => FMQ.quitToMenu();
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  },
  introPlaylistGuess: {
    label: "Aus welcher Playlist ist das?",
    supportsAllGuess: false,
    submitAnswer(playerId, answer) {
      FMQ.app.state.introPlaylistGuess.answers[playerId] = answer;
    },
    drawUniqueTrack() {
      const active = FMQ.activePlayers();
      const counts = new Map();
      for (const p of active) {
        const seen = new Set();
        for (const t of p.tracks || []) {
          const key = FMQ.trackIdentityKey(t);
          if (key) seen.add(key);
        }
        for (const key of seen) counts.set(key, (counts.get(key) || 0) + 1);
      }
      const candidates = [];
      for (const p of active) {
        for (const t of p.tracks || []) {
          if (!t?.id || FMQ.app.usedTrackIds.has(t.id)) continue;
          if ((counts.get(FMQ.trackIdentityKey(t)) || 0) !== 1) continue;
          candidates.push({ track: t, sourcePlayerId: p.id });
        }
      }
      const draw = FMQ.shuffle(candidates)[0] || null;
      if (draw?.track?.id) FMQ.app.usedTrackIds.add(draw.track.id);
      return draw;
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Aus welcher Playlist ist das?";
      FMQ.renderModeLikeQuick3({
        heading: "Aus welcher Playlist ist das?",
        subtitle: "Erst hören, dann tippt jeweils die gerade angezeigte Person.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="quick3Controls" style="justify-content:center;"><select id="introGuessLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganzer Song</option></select><button id="introGuessPlayStartBtn" class="big">▶️ Play-Start</button><button id="introGuessPlayRandomBtn" class="big">🎲 Play-Zufall</button></div><div id="plGuessPanel" style="margin-top:12px;"></div><div class="row" style="justify-content:center; margin-top:10px;"><button id="introGuessRevealBtn" class="big" disabled>Reveal</button><button id="introGuessNextBtn" class="big primary" disabled>Weiter</button></div>`
      });
      FMQ.$("introGuessLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
      FMQ.$("introGuessLenSelect").onchange = () => {
        const v = FMQ.$("introGuessLenSelect").value;
        FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
      };
      const afterPlay = () => { FMQ.modes.introPlaylistGuess.renderGuessUI(); };
      FMQ.$("introGuessPlayStartBtn").onclick = () => FMQ.onQuick3Play("start").then(afterPlay).catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("introGuessPlayRandomBtn").onclick = () => FMQ.onQuick3Play("random").then(afterPlay).catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("introGuessRevealBtn").onclick = () => FMQ.modes.introPlaylistGuess.reveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("introGuessNextBtn").onclick = () => FMQ.onNext();
    },
    renderGuessUI() {
      const c = FMQ.$("plGuessPanel");
      const activePlayers = FMQ.activePlayers();
      const responder = activePlayers[FMQ.app.state.introPlaylistGuess.responderIndex] || null;
      if (!responder) {
        c.innerHTML = `<div class="muted">Alle Tipps sind gespeichert.</div>`;
        FMQ.$("introGuessRevealBtn").disabled = false;
        return;
      }
      c.innerHTML = `<div class="socialTurnLabel">${FMQ.escapeHtml(responder.name)} tippt</div><div class="choiceGrid">${activePlayers.map(p => `<button class="choiceBtn" data-owner="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div>`;
      c.querySelectorAll("[data-owner]").forEach(btn => btn.onclick = () => {
        FMQ.modes.introPlaylistGuess.submitAnswer(responder.id, btn.getAttribute("data-owner"));
        FMQ.app.state.introPlaylistGuess.responderIndex++;
        FMQ.modes.introPlaylistGuess.renderGuessUI();
      });
    },
    async reveal() {
      try { await FMQ.pausePlayback(); } catch {}
      clearTimeout(FMQ.app.state.playTimer);
      const sourceId = FMQ.app.state.currentSourcePlayerId;
      let cnt = 0;
      const lines = [];
      for (const p of FMQ.activePlayers()) {
        const guessed = FMQ.app.state.introPlaylistGuess.answers[p.id];
        const ok = guessed === sourceId;
        if (ok) { FMQ.awardPoints(p.id, 1); cnt++; }
        lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${FMQ.escapeHtml(FMQ.getPlayerName(guessed))} → <b>+${ok ? 1 : 0}</b></div>`);
      }
      const scores = FMQ.activePlayers().map(p => `<div class="scoreCard"><div class="name">${FMQ.escapeHtml(p.name)}</div><div class="pts">${p.score} Punkte</div></div>`).join("");
      FMQ.$("plGuessPanel").innerHTML = `<div class="socialRevealBig"><div class="socialTruthLine">Richtig: ${FMQ.escapeHtml(FMQ.getPlayerName(sourceId))}</div><div>${cnt} richtig</div><div class="socialPointsBlock">${lines.join("")}</div><h3>Scores</h3><div class="scoreGrid">${scores}</div></div>`;
      FMQ.renderScoreTable();
      FMQ.markFinalRoundIfNeeded();
      if (FMQ.$("introGuessRevealBtn")) FMQ.$("introGuessRevealBtn").disabled = true;
      if (FMQ.$("introGuessNextBtn")) FMQ.$("introGuessNextBtn").disabled = false;
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  },
  // =========================================================
  // SOCIAL MODUS 1: Song-Bewertung einschätzen
  // =========================================================
  ratingGuess: {
    label: "Song-Bewertung einschätzen",
    supportsAllGuess: false,
    submitVote(playerId, vote) { FMQ.submitVoteToSession(FMQ.app.state.social, playerId, vote); },
    submitMainAnswer(playerId, answer) { FMQ.submitMainAnswerToSession(FMQ.app.state.social, playerId, answer); },
    transportHtml(phase = "guess") {
      const label = phase === "listen" ? "▶️ Song hören" : "▶️ Weiter";
      return `<div class="row ratingTransportRow" style="justify-content:center;"><select id="ratingStartModeSelect"><option value="start">Von Anfang</option><option value="random">Zufall aus der Mitte</option></select><button id="ratingPlayResumeBtn" class="big">${label}</button><button id="ratingStopBtn" class="big">⏸️ Stop</button></div>`;
    },
    bindTransport(phase = "guess") {
      const t = FMQ.app.state.currentTrack;
      if (!t) return;
      const play = () => {
        const mode = FMQ.$("ratingStartModeSelect")?.value || "start";
        const startMs = FMQ.getStoredStartMs(t, "rating", mode);
        return FMQ.playTrackUri(t.uri, { positionMs: startMs });
      };
      FMQ.$("ratingPlayResumeBtn").textContent = phase === "listen" ? "▶️ Song hören" : "▶️ Weiter";
      FMQ.$("ratingPlayResumeBtn").onclick = () => play().catch(() => {});
      FMQ.$("ratingStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Wie gut findet … diesen Song?";
      if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "ratingGuess") FMQ.initSocialRound({ modeId: "ratingGuess", startPhase: "listen" });
      const s = FMQ.app.state.social;
      const mainName = FMQ.getPlayerName(s.mainPlayerId);
      if (s.phase === "listen") {
        FMQ.renderModeLikeQuick3({
          heading: `Wie findet "${mainName}" diesen Song?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("listen")}<div class="row" style="justify-content:center;"><button id="ratingListenNextBtn" class="big primary">Weiter zu den Einschätzungen</button></div>`
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
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(responder)} ist dran</div>${FMQ.modes.ratingGuess.transportHtml("guess")}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingNextBtn" class="big primary" disabled>Weiter</button></div>`
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
        FMQ.renderModeLikeQuick3({
          heading: `${mainName}, wie gut findest du den Song wirklich?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `${FMQ.modes.ratingGuess.transportHtml("guess")}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-main-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.modes.ratingGuess.bindTransport();
        FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.modes.ratingGuess.submitMainAnswer(s.mainPlayerId, parseInt(btn.getAttribute("data-main-rate"), 10));
          FMQ.$("ratingRevealBtn").disabled = false;
        });
        FMQ.$("ratingRevealBtn").onclick = async () => {
          try { await FMQ.socialPlaybackPause({ key: "rating" }); } catch {}
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
            bodyHtml: `<div class="socialRevealBig"><div><b>${FMQ.escapeHtml(t.name)}</b> · ${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</div><div class="socialTruthLine">"${mainName}" sagte: <b>${truth}/10</b></div><div class="muted" style="font-size:16px;">Punktesystem: ${FMQ.app.config.ratingScoring === "light" ? "Light (2/1/0)" : "Klassisch (3/2/1/0)"}</div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row" style="justify-content:center;"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
          });
          FMQ.app.state.social = null;
          FMQ.renderScoreTable();
          FMQ.markFinalRoundIfNeeded();
          FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
        };
      }
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  },
  // =========================================================
  // SOCIAL MODUS 2: Was weiß ich wirklich?
  // =========================================================
  knowledgeGuess: {
    label: "Was weiß ich wirklich?",
    supportsAllGuess: false,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Was weiß ich wirklich?";
      if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "knowledgeGuess") FMQ.initSocialRound({ modeId: "knowledgeGuess", startPhase: "listen" });
      const s = FMQ.app.state.social;
      const mainName = FMQ.getPlayerName(s.mainPlayerId);
      if (s.phase === "listen") {
        FMQ.renderModeLikeQuick3({
          heading: `Was weiß "${mainName}" wirklich?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-range",
          bodyHtml: `<div class="quick3Controls" style="justify-content:center;"><select id="knowLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganze Hörprobe</option></select><button id="knowPlayStartBtn" class="big primary">▶️ Anfang</button><button id="knowPlayRandomBtn" class="big">🎲 Zufall</button></div><div class="row" style="justify-content:center; margin-top:12px;"><button id="knowStartGuessBtn" class="big" disabled>Weiter</button></div>`
        });
        FMQ.$("knowLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
        FMQ.$("knowLenSelect").onchange = () => {
          const v = FMQ.$("knowLenSelect").value;
          FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
        };
        const afterPlay = () => { FMQ.$("knowStartGuessBtn").disabled = false; };
        FMQ.$("knowPlayStartBtn").onclick = () => FMQ.onQuick3Play("start").then(afterPlay).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowPlayRandomBtn").onclick = () => FMQ.onQuick3Play("random").then(afterPlay).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowStartGuessBtn").onclick = () => { s.phase = "othersGuessing"; FMQ.modes.knowledgeGuess.renderArea(); };
      } else if (s.phase === "othersGuessing") {
        const pid = FMQ.getSocialResponderId();
        const responder = FMQ.getPlayerName(pid);
        FMQ.renderModeLikeQuick3({
          heading: `Was weiß "${mainName}" wirklich?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-range",
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(responder)} ist dran</div><div class="quick3Controls" style="justify-content:center; margin-bottom:10px;"><select id="knowLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganze Hörprobe</option></select><button id="knowPlayStartBtn" class="big">▶️ Anfang</button><button id="knowPlayRandomBtn" class="big">🎲 Zufall</button></div><div class="socialCheckGrid"><label class="socialCheckItem"><input type="checkbox" id="kArtist"> <span>Interpret</span></label><label class="socialCheckItem"><input type="checkbox" id="kTitle"> <span>Songtitel</span></label><label class="socialCheckItem"><input type="checkbox" id="kYear"> <span>Jahr</span></label></div><div class="row" style="justify-content:center;"><button id="knowNextBtn" class="big primary">Weiter</button></div>`
        });
        FMQ.$("knowLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
        FMQ.$("knowLenSelect").onchange = () => {
          const v = FMQ.$("knowLenSelect").value;
          FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
        };
        FMQ.$("knowPlayStartBtn").onclick = () => FMQ.onQuick3Play("start").catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowPlayRandomBtn").onclick = () => FMQ.onQuick3Play("random").catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowNextBtn").onclick = () => {
          s.answers.set(pid, { artist: FMQ.$("kArtist").checked, title: FMQ.$("kTitle").checked, year: FMQ.$("kYear").checked });
          s.currentResponderIndex++;
          s.phase = s.currentResponderIndex >= s.respondingPlayersQueue.length ? "mainAnswer" : "othersGuessing";
          FMQ.modes.knowledgeGuess.renderArea();
        };
      } else if (s.phase === "mainAnswer") {
        FMQ.renderModeLikeQuick3({
          heading: `Was weiß "${mainName}" wirklich?`,
          subtitle: `${mainName} ist dran`,
          heroName: "",
          panelClass: "theme-range",
          bodyHtml: `<div class="quick3Controls" style="justify-content:center; margin-bottom:10px;"><select id="knowLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganze Hörprobe</option></select><button id="knowPlayStartBtn" class="big">▶️ Anfang</button><button id="knowPlayRandomBtn" class="big">🎲 Zufall</button></div><div class="socialCheckGrid"><label class="socialCheckItem"><input type="checkbox" id="knowTruthArtist"> <span>Interpret</span></label><label class="socialCheckItem"><input type="checkbox" id="knowTruthTitle"> <span>Songtitel</span></label><label class="socialCheckItem"><input type="checkbox" id="knowTruthYear"> <span>Jahr</span></label></div><div class="row" style="justify-content:center;"><button id="knowRevealBtn" class="big primary">Reveal</button></div>`
        });
        FMQ.$("knowLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
        FMQ.$("knowLenSelect").onchange = () => {
          const v = FMQ.$("knowLenSelect").value;
          FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
        };
        FMQ.$("knowPlayStartBtn").onclick = () => FMQ.onQuick3Play("start").catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowPlayRandomBtn").onclick = () => FMQ.onQuick3Play("random").catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("knowRevealBtn").onclick = () => {
          s.mainAnswer = { artist: FMQ.$("knowTruthArtist").checked, title: FMQ.$("knowTruthTitle").checked, year: FMQ.$("knowTruthYear").checked };
          const truth = s.mainAnswer;
          FMQ.awardPoints(s.mainPlayerId, (truth.artist?1:0)+(truth.title?1:0)+(truth.year?1:0));
          const lines = [];
          for (const p of FMQ.app.players) {
            if (p.id===s.mainPlayerId) continue;
            let pts = 0;
            const guess = s.answers.get(p.id) || {};
            if ((guess.artist || false) === truth.artist) pts++;
            if ((guess.title || false) === truth.title) pts++;
            if ((guess.year || false) === truth.year) pts++;
            FMQ.awardPoints(p.id, pts);
            lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> +${pts}</div>`);
          }
          const t = FMQ.app.state.currentTrack;
          FMQ.renderModeLikeQuick3({
            heading: `Auflösung: ${mainName}`,
            subtitle: "",
            heroName: "",
            panelClass: "theme-range",
            bodyHtml: `<div class="socialRevealBig"><div><b>${FMQ.escapeHtml(t.name)}</b> · ${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</div><div class="socialTruthLine">${mainName} wusste: <b>${truth.artist ? "Interpret " : ""}${truth.title ? "Titel " : ""}${truth.year ? "Jahr" : ""}</b></div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row" style="justify-content:center;"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
          });
          FMQ.app.state.social = null;
          FMQ.renderScoreTable();
          FMQ.markFinalRoundIfNeeded();
          FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
        };
      }
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  },
  // =========================================================
  // KENNENLERNEN MODUS 2: Meine ersten 3 Songs
  // =========================================================
  introFirst3: {
    label: "Meine ersten 3 Songs",
    supportsAllGuess: false,
    async playClip(track, seconds = 10) {
      if (!track) return;
      await FMQ.playTrackUri(track.uri, { positionMs: 0 });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = null;
      if (seconds !== "full") {
        FMQ.app.state.playTimer = setTimeout(() => {
          FMQ.pausePlayback().catch(() => {});
        }, seconds * 1000);
      }
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Meine ersten 3 Songs";
      const me = FMQ.currentPlayer();
      const top = (me?.tracks || []).slice(0, 3);
      const labels = ["Song 1", "Song 2", "Song 3"];
      FMQ.renderModeLikeQuick3({
        heading: `Die ersten 3 Songs von "${FMQ.escapeHtml(me?.name || "")}"`,
        subtitle: "Locker reinhören: 10 Sekunden, 20 Sekunden oder ganzer Song.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div>${top.map((t, i) => `<div class="abTransport"><span class="pill">${i + 1}) ${labels[i]}</span><button class="big" data-first3-play="${i}" data-seconds="10">▶️ 10 Sek.</button><button class="big" data-first3-play="${i}" data-seconds="20">▶️ 20 Sek.</button><button class="big" data-first3-play="${i}" data-seconds="full">▶️ Ganzer Song</button></div>`).join("")}</div><div class="abTransport"><button id="iceStopBtn" class="big">⏸️ Stop</button></div><div class="muted" id="iceTrackInfo" style="text-align:center; margin-top:8px;">${top.length ? "Spiele Song 1, 2 oder 3 kurz an." : "Zu wenig Songs in der Playlist."}</div><div class="row" style="justify-content:center; margin-top:10px;"><button id="iceNextBtn" class="big primary">Weiter</button></div>`
      });
      FMQ.$("modeArea").querySelectorAll("[data-first3-play]").forEach(btn => btn.onclick = () => {
        const idx = parseInt(btn.getAttribute("data-first3-play"), 10);
        const secondsRaw = btn.getAttribute("data-seconds");
        const seconds = secondsRaw === "full" ? "full" : parseInt(secondsRaw, 10);
        const t = top[idx];
        if (!t) return;
        FMQ.modes.introFirst3.playClip(t, seconds).then(() => {
          FMQ.$("iceTrackInfo").textContent = `${labels[idx]} · ${seconds === "full" ? "Ganzer Song" : `${seconds} Sek.`}: ${t.name} · ${t.artists.join(", ")}`;
        }).catch(e => FMQ.setGameDebug(e.stack || e.message));
      });
      FMQ.$("iceStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
      FMQ.$("iceNextBtn").onclick = () => FMQ.onNext();
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  },
  // =========================================================
  // SOCIAL MODUS 4: Song A oder B
  // =========================================================
  bestFit: {
    label: "Song A oder B",
    supportsAllGuess: false,
    submitVote(playerId, vote) { FMQ.submitVoteToSession(FMQ.app.state.social, playerId, vote); },
    submitMainAnswer(playerId, answer) { FMQ.submitMainAnswerToSession(FMQ.app.state.social, playerId, answer); },
    transportHtml() {
      return `<div class="abTransport"><button id="playAFromStartBtn" class="big">🅰️ ▶️ Song A</button><button id="playBFromStartBtn" class="big">🅱️ ▶️ Song B</button><button id="bestFitStopBtn" class="big">⏸️ Stop</button></div>`;
    },
    bindTransport(trackA, trackB) {
      FMQ.$("playAFromStartBtn").onclick = () => FMQ.socialPlaybackStart(trackA.uri, { fromStart: true, key: "bestFitA" }).catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("playBFromStartBtn").onclick = () => FMQ.socialPlaybackStart(trackB.uri, { fromStart: true, key: "bestFitB" }).catch(e => FMQ.setGameDebug(e.stack || e.message));
      FMQ.$("bestFitStopBtn").onclick = async () => {
        try { await FMQ.socialPlaybackPause({ key: "bestFitA" }); } catch {}
        try { await FMQ.socialPlaybackPause({ key: "bestFitB" }); } catch {}
      };
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Song A oder Song B";
      if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "bestFit") FMQ.initSocialRound({ modeId: "bestFit", startPhase: "listen" });
      const s = FMQ.app.state.social;
      const mainName = FMQ.getPlayerName(s.mainPlayerId);
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
          bodyHtml: `${FMQ.modes.bestFit.transportHtml()}<div class="row" style="justify-content:center; margin-top:10px;"><button id="bestFitContinueBtn" class="primary big">Weiter zur Tipp-Runde</button></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
        FMQ.$("bestFitContinueBtn").onclick = () => { s.phase = "othersGuessing"; FMQ.modes.bestFit.renderArea(); };
      } else if (s.phase === "othersGuessing") {
        const pid = FMQ.getSocialResponderId();
        if (!pid) {
          s.phase = "mainAnswer";
          FMQ.modes.bestFit.renderArea();
          return;
        }
        FMQ.renderModeLikeQuick3({
          heading: `Welchen Song findet "${mainName}" besser?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(FMQ.getPlayerName(pid))} ist dran</div>${FMQ.modes.bestFit.transportHtml()}<div class="choiceGrid choiceGridBig" style="margin-top:10px;"><button class="choiceBtn abChoiceBig" data-pick="A">Song A</button><button class="choiceBtn abChoiceBig" data-pick="B">Song B</button></div><div class="row" style="justify-content:center;"><button id="bfNextBtn" class="big primary" disabled>Weiter</button></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
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
        FMQ.renderModeLikeQuick3({
          heading: `Welchen Song findet "${mainName}" besser?`,
          subtitle: `${mainName} ist dran`,
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `${FMQ.modes.bestFit.transportHtml()}<div class="choiceGrid choiceGridBig"><button class="choiceBtn abChoiceBig" data-main-pick="A">Song A</button><button class="choiceBtn abChoiceBig" data-main-pick="B">Song B</button></div><div class="row" style="justify-content:center;"><button id="bfRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
        FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.modes.bestFit.submitMainAnswer(s.mainPlayerId, btn.getAttribute("data-main-pick"));
          FMQ.$("bfRevealBtn").disabled = false;
        });
        FMQ.$("bfRevealBtn").onclick = () => {
          const truth = s.mainAnswer || "A";
          const lines = [];
          for (const p of FMQ.activePlayers()) {
            if (p.id === s.mainPlayerId) continue;
            const guessed = s.answersByPlayer?.[p.id];
            const pts = guessed === truth ? 1 : 0;
            if (pts) FMQ.awardPoints(p.id, pts);
            lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${guessed || "-"} → <b>+${pts}</b></div>`);
          }
          FMQ.pausePlayback().catch(() => {});
          FMQ.renderModeLikeQuick3({
            heading: `Auflösung: ${mainName}`,
            subtitle: "",
            heroName: "",
            panelClass: "theme-playlist",
            bodyHtml: `<div class="socialRevealBig"><div class="socialTruthLine">${mainName} wählt: <b>Song ${truth}</b></div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row" style="justify-content:center;"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
          });
          FMQ.app.state.social = null;
          FMQ.renderScoreTable();
          FMQ.markFinalRoundIfNeeded();
          FMQ.$("socialDoneBtn").onclick = () => FMQ.onNext();
        };
      }
    },
    onReveal() { return { skipReveal: true, disableReveal: true }; }
  }
};

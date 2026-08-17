window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Song-Geschichten und Song-Duell. Beide laufen über
   Prompts auf den Handys und brauchen den Mehrgeräte-Modus. */

FMQ.modes.songChallenge = {
  label: "Song-Geschichten",
  supportsAllGuess: false,
  promptPools() { return window.FMQ_SONG_PROMPTS || { storyPrompts: [], duelPrompts: [] }; },
  pickPrompt(type = "shared") {
    return FMQ.promptBag.draw(type, 1)[0];
  },
  pickPrompts(type = "shared", count = 1) {
    return FMQ.promptBag.draw(type, count);
  },
  trackOptionsFor(player) {
    return (player?.tracks || []).slice(0, 300).map(t => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      artistName: (t.artists || []).join(", "),
      year: t.year || "",
      albumReleaseDate: t.albumReleaseDate || ""
    }));
  },
  tracksByPlayer(players) {
    const out = {};
    players.forEach(p => { out[p.remoteId || p.id] = this.trackOptionsFor(p); });
    return out;
  },
  ensureState() {
    if (!FMQ.app.state.songChallenge) {
      FMQ.app.state.songChallenge = {
        mode: FMQ.app.config.songChallengeType || FMQ.app.config.mode || "storyPrompt",
        phase: "start",
        submissions: {},
        revealIndex: 0,
        duels: [],
        currentDuelIndex: 0
      };
    }
    return FMQ.app.state.songChallenge;
  },
  playerName(id) { return FMQ.getPlayerName(id); },
  activeIds() { return FMQ.activePlayers().map(p => p.remoteId || p.id); },
  musicIds() { return FMQ.musicPlayers().map(p => p.remoteId || p.id); },
  renderArea() {
    FMQ.$("modeAreaTitle").textContent = FMQ.MODE_INFO[FMQ.app.config.mode]?.label || this.label;
    if (!FMQ.isMultiDevice?.()) {
      FMQ.renderModeLikeQuick3({ heading: "Nur im Mehrgeräte-Modus", subtitle: "Song-Challenges erscheinen nur, wenn Handys in der Lobby genutzt werden.", heroName: "", panelClass: "theme-playlist" });
      return;
    }
    const st = this.ensureState();
    if (st.mode === "promptDuel") this.renderDuel(st);
    else this.renderShared(st);
    FMQ.renderScoreTable();
    FMQ.refreshPhoneControls?.();
  },
  startShared(st) {
    const prompt = this.pickPrompt("shared");
    st.mode = "storyPrompt";
    st.phase = "selecting";
    st.promptId = prompt.id;
    st.promptText = prompt.text;
    st.submissions = {};
    st.revealIndex = 0;
    FMQ.startMultiplayerPrompt?.({
      id: crypto.randomUUID(),
      type: "songChallengeShared",
      kind: "songSelect",
      title: "Wähle deinen Song",
      text: prompt.text,
      tracksByPlayer: this.tracksByPlayer(FMQ.musicPlayers()),
      recipientIds: this.musicIds(),
      waitingText: "Die Personen mit eigener Playlist wählen gerade ihren Song.",
      sentText: "Song eingeloggt. Warte auf die anderen …",
      meta: { challengeMode: "storyPrompt", promptId: prompt.id }
    });
    this.renderArea();
  },
  renderShared(st) {
    const ids = this.musicIds();
    if (st.phase === "start") {
      FMQ.renderModeLikeQuick3({
        heading: "Song-Geschichten starten",
        subtitle: "Alle bekommen denselben Prompt und wählen je einen Song aus der eigenen Playlist.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div class="challengeTypeGrid"><button id="startSharedChallengeBtn" class="big primary">Song-Geschichten starten</button></div>`
      });
      FMQ.$("startSharedChallengeBtn").onclick = () => this.startShared(st);
      return;
    }
    const done = Object.keys(st.submissions || {}).length;
    if (st.phase === "selecting") {
      FMQ.renderModeLikeQuick3({
        heading: "Song-Geschichten",
        subtitle: st.promptText,
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `${FMQ.modes.bestFit.answerStatusHtml(ids, st.submissions || {})}<div class="challengeProgress"><b>${done}/${ids.length}</b> Spieler fertig</div><div class="row row--center"><button id="sharedRevealStartBtn" class="big primary">${done >= ids.length ? "Reveal starten" : "Reveal starten (Notfall)"}</button></div><div class="muted u-text-center">Notfall: fehlende Antworten werden als Platzhalter gezeigt.</div>`
      });
      FMQ.$("sharedRevealStartBtn").onclick = () => { st.phase = "reveal"; FMQ.revealMultiplayerPrompt?.({ mode: "songChallengeShared" }); this.renderArea(); };
      return;
    }
    const submissions = ids.map(id => ({ playerId: id, track: st.submissions[id] }));
    const cur = submissions[st.revealIndex] || null;
    const hasTrack = !!cur?.track;
    if (FMQ.isMultiDevice?.() && cur?.playerId) FMQ.ensureMultiplayerController?.(cur.playerId);
    FMQ.renderModeLikeQuick3({
      heading: "Reveal",
      subtitle: st.promptText,
      heroName: "",
      panelClass: "theme-playlist",
      bodyHtml: cur ? `<div class="challengeRevealPrompt"><div class="eyebrow">Frage / Prompt</div><div>${FMQ.escapeHtml(st.promptText)}</div></div><div class="challengeRevealCard"><div class="pill">${st.revealIndex + 1}/${submissions.length}</div><div class="muted">${FMQ.escapeHtml(this.playerName(cur.playerId))}</div>${hasTrack ? `<div class="songRevealTitle">${FMQ.escapeHtml(cur.track.name)}</div><div class="songRevealArtist">${FMQ.escapeHtml(cur.track.artistName)}</div>` : `<div class="songRevealTitle">Hier hätte ein Song sein können!</div><div class="songRevealArtist">Keine Antwort eingereicht.</div>`}</div><div class="quick3Controls quick3Controls--center">${hasTrack ? `<select id="challengeStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select><button id="challengePlayBtn" class="big primary">▶️ Song abspielen</button><button id="challengeStopBtn" class="big">⏸️ Stop</button>` : ""}<button id="challengeNextBtn" class="big secondary">${st.revealIndex + 1 >= submissions.length ? "Challenge beenden" : "Nächster Song"}</button></div>` : `<div class="muted">Keine Spieler mit eigener Playlist in dieser Runde.</div><button id="challengeDoneBtn" class="big primary">Zurück</button>`
    });
    if (FMQ.$("challengeStartModeSelect")) FMQ.bindPlayerStartModeSelect("challengeStartModeSelect");
    if (FMQ.$("challengePlayBtn")) FMQ.$("challengePlayBtn").onclick = () => { const mode = FMQ.getBoundStartMode("challengeStartModeSelect"); const startMs = FMQ.getStoredStartMs(cur.track, `challenge:${cur.playerId}`, mode); FMQ.playTrackUri(cur.track.uri, { positionMs: startMs }).catch(e => FMQ.setGameDebug(e.stack || e.message)); };
    if (FMQ.$("challengeStopBtn")) FMQ.$("challengeStopBtn").onclick = () => FMQ.stopPlaybackNow?.().catch(e => FMQ.setGameDebug(e.stack || e.message));
    if (FMQ.$("challengeNextBtn")) FMQ.$("challengeNextBtn").onclick = async () => { try { await FMQ.stopPlaybackNow?.(); } catch {} if (st.revealIndex + 1 >= submissions.length) { FMQ.app.state.songChallenge = null; FMQ.resetMultiplayerRound?.(); } else st.revealIndex++; this.renderArea(); };
    if (FMQ.$("challengeDoneBtn")) FMQ.$("challengeDoneBtn").onclick = () => { FMQ.app.state.songChallenge = null; this.renderArea(); };
  },
  createDuels() {
    const players = FMQ.shuffle(FMQ.musicPlayers());
    if (players.length < 2) return [];
    // Vorab so viele verschiedene Prompts ziehen, wie Duelle
    // entstehen. Kein Modulo mehr, also keine Doppelungen
    // innerhalb einer Runde.
    const needed = players.length === 2 ? 2 : players.length;
    const prompts = this.pickPrompts("duel", needed);
    const duels = [];
    const add = (a, b) => {
      const prompt = prompts[duels.length] || this.pickPrompt("duel");
      duels.push({ duelId: crypto.randomUUID(), promptId: prompt.id, promptText: prompt.text, playerAId: a.remoteId || a.id, playerBId: b.remoteId || b.id, submissionA: null, submissionB: null, votes: {}, winner: null, voteStarted: false });
    };
    if (players.length === 2) { add(players[0], players[1]); add(players[0], players[1]); return duels; }
    for (let i = 0; i < players.length; i++) add(players[i], players[(i + 1) % players.length]);
    return duels;
  },
  assignmentsByPlayer(duels = []) {
    const out = {};
    duels.forEach((duel) => {
      const add = (playerId, side) => {
        out[playerId] = out[playerId] || [];
        out[playerId].push({ duelId: duel.duelId, side, promptText: duel.promptText });
      };
      add(duel.playerAId, "A");
      add(duel.playerBId, "B");
    });
    return out;
  },
  startAllDuelPrompts(st) {
    if (st.duelPromptStarted) return;
    st.duelPromptStarted = true;
    FMQ.startMultiplayerPrompt?.({
      id: crypto.randomUUID(),
      type: "songChallengeDuelSubmit",
      kind: "multiSongSelect",
      title: "Wähle deine zwei Duell-Songs",
      text: "Wechsle zwischen deinen Prompts, wähle jeweils einen Song aus und schicke beide zusammen ab.",
      tracksByPlayer: this.tracksByPlayer(FMQ.musicPlayers()),
      assignmentsByPlayer: this.assignmentsByPlayer(st.duels),
      recipientIds: Object.keys(this.assignmentsByPlayer(st.duels)),
      waitingText: "Die Duell-Songs werden gerade ausgewählt.",
      sentText: "Deine Duell-Songs sind eingeloggt. Bitte warten …",
      meta: { challengeMode: "promptDuel" }
    });
  },
  duelNeedsVote(duel) { return !!(duel?.submissionA && duel?.submissionB); },
  voteIdsForDuel(duel) {
    if (!this.duelNeedsVote(duel)) return [];
    const outside = this.activeIds().filter(id => id !== duel.playerAId && id !== duel.playerBId);
    return outside.length ? outside : this.activeIds();
  },
  voteDuelsByPlayer(duels = []) {
    const out = {};
    this.activeIds().forEach(id => { out[id] = []; });
    duels.filter(duel => this.duelNeedsVote(duel)).forEach(duel => {
      const voteIds = this.voteIdsForDuel(duel);
      voteIds.forEach(id => {
        out[id] = out[id] || [];
        out[id].push({
          duelId: duel.duelId,
          promptText: duel.promptText,
          songA: { name: duel.submissionA?.name || "Song A", artistName: duel.submissionA?.artistName || "" },
          songB: { name: duel.submissionB?.name || "Song B", artistName: duel.submissionB?.artistName || "" }
        });
      });
    });
    return out;
  },
  currentDuel(st) { return (st.duels || [])[st.currentDuelIndex || 0] || null; },
  voteDuelsForCurrentByPlayer(duel) {
    const out = {};
    this.activeIds().forEach(id => { out[id] = []; });
    if (!this.duelNeedsVote(duel)) return out;
    this.voteIdsForDuel(duel).forEach(id => {
      out[id] = [{
        duelId: duel.duelId,
        promptText: duel.promptText,
        songA: { name: duel.submissionA?.name || "Song A", artistName: duel.submissionA?.artistName || "" },
        songB: { name: duel.submissionB?.name || "Song B", artistName: duel.submissionB?.artistName || "" }
      }];
    });
    return out;
  },
  startCurrentDuelVote(st, duel) {
    if (!duel || duel.votePromptStarted || duel.winner) return;
    duel.votePromptStarted = true;
    FMQ.startMultiplayerPrompt?.({
      id: crypto.randomUUID(),
      type: "songChallengeDuelVote",
      kind: "multiDuelVote",
      title: "Song-Duell Voting",
      text: "Stimme nur dieses eine Duell ab. Danach werden Namen und Punkte gezeigt.",
      voteDuelsByPlayer: this.voteDuelsForCurrentByPlayer(duel),
      recipientIds: this.voteIdsForDuel(duel),
      waitingText: "Warte bitte: Dieses Duell wird gerade abgestimmt.",
      sentText: "Voting gespeichert. Bitte warten …",
      meta: { challengeMode: "promptDuel", duelId: duel.duelId }
    });
  },
  currentDuelVotesComplete(duel) {
    return !this.duelNeedsVote(duel) || Object.keys(duel.votes || {}).length >= this.voteIdsForDuel(duel).length;
  },
  duelTransportHtml() {
    return `<div class="abTransportWrap duelHostTransport"><select id="duelStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select><div class="abTransport"><button id="duelPlayABtn" class="big playSongBtn">🅰️ Song A abspielen</button><button id="duelPlayBBtn" class="big playSongBtn">🅱️ Song B abspielen</button><button id="duelStopBtn" class="big">⏸️ Pause</button></div></div>`;
  },
  bindDuelTransport(duel) {
    FMQ.bindPlayerStartModeSelect("duelStartModeSelect");
    const play = async (track, key) => {
      if (!track?.uri) return;
      const mode = FMQ.getBoundStartMode("duelStartModeSelect");
      const startMs = FMQ.getStoredStartMs(track, `duel:${duel.duelId}:${key}`, mode);
      await FMQ.playTrackUri(track.uri, { positionMs: startMs });
    };
    if (FMQ.$("duelPlayABtn")) FMQ.$("duelPlayABtn").onclick = () => play(duel.submissionA, "A").catch(e => FMQ.setGameDebug(e.stack || e.message));
    if (FMQ.$("duelPlayBBtn")) FMQ.$("duelPlayBBtn").onclick = () => play(duel.submissionB, "B").catch(e => FMQ.setGameDebug(e.stack || e.message));
    if (FMQ.$("duelStopBtn")) FMQ.$("duelStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
    if (FMQ.$("duelPlayABtn")) FMQ.$("duelPlayABtn").disabled = !duel.submissionA?.uri;
    if (FMQ.$("duelPlayBBtn")) FMQ.$("duelPlayBBtn").disabled = !duel.submissionB?.uri;
  },
  resolveCurrentDuel(st, duel) {
    if (!duel || duel.winner) return;
    if (duel.submissionA && !duel.submissionB) {
      FMQ.awardPoints(duel.playerAId, 1);
      duel.voteCountA = 1; duel.voteCountB = 0; duel.winner = "A"; duel.autoResolved = true;
    } else if (duel.submissionB && !duel.submissionA) {
      FMQ.awardPoints(duel.playerBId, 1);
      duel.voteCountA = 0; duel.voteCountB = 1; duel.winner = "B"; duel.autoResolved = true;
    } else if (!duel.submissionA && !duel.submissionB) {
      duel.voteCountA = 0; duel.voteCountB = 0; duel.winner = "none"; duel.autoResolved = true;
    } else {
      const a = Object.values(duel.votes || {}).filter(v => v === "A").length;
      const b = Object.values(duel.votes || {}).filter(v => v === "B").length;
      if (a >= b) FMQ.awardPoints(duel.playerAId, 1);
      if (b >= a) FMQ.awardPoints(duel.playerBId, 1);
      duel.voteCountA = a; duel.voteCountB = b; duel.winner = a === b ? "tie" : (a > b ? "A" : "B");
    }
    FMQ.resetMultiplayerRound?.();
    st.phase = "duelResult";
    this.renderArea();
  },
  finishDuelRound(st) {
    FMQ.resetMultiplayerRound?.();
    if (FMQ.app.state.round >= FMQ.app.config.targetRounds) {
      FMQ.finishGame(FMQ.getWinnerByScore(), `${FMQ.app.config.targetRounds} Song-Duell-Runden sind gespielt.`);
      return;
    }
    FMQ.app.state.round++;
    FMQ.app.state.songChallenge = { mode: "promptDuel", phase: "start", submissions: {}, revealIndex: 0, duels: [], currentDuelIndex: 0 };
    FMQ.renderHeader();
    this.renderArea();
  },
  renderDuel(st) {
    if (st.phase === "start") {
      FMQ.renderModeLikeQuick3({ heading: "Song-Duell", subtitle: `Runde ${FMQ.app.state.round}/${FMQ.app.config.targetRounds}: Jeder bekommt zwei Prompts auf dem Handy, wählt Songs aus und danach wird Duell für Duell abgestimmt.`, heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="row row--center"><button id="startDuelChallengeBtn" class="big primary">Runde starten</button></div>` });
      FMQ.$("startDuelChallengeBtn").onclick = () => { st.duels = this.createDuels(); st.phase = "duelSelecting"; st.currentDuelIndex = 0; st.duelPromptStarted = false; this.renderArea(); };
      return;
    }
    if (st.phase === "duelSelecting") {
      this.startAllDuelPrompts(st);
      const readyDuels = (st.duels || []).filter(duel => duel.submissionA && duel.submissionB).length;
      const readyPlayers = Object.keys(st.duelSubmissionsByPlayer || {}).length;
      const totalPlayers = this.activeIds().length;
      const allReady = st.duels.length > 0 && readyDuels >= st.duels.length;
      if (allReady) {
        FMQ.resetMultiplayerRound?.();
        st.phase = "duelVoting";
        st.currentDuelIndex = 0;
        this.renderArea();
        return;
      }
      FMQ.renderModeLikeQuick3({ heading: "Song-Duell Auswahl", subtitle: "Die Prompts sind auf den Handys. Der Host zeigt bewusst keine einzelnen Prompts, bis abgestimmt wird.", heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="challengeProgress"><b>${readyPlayers}/${totalPlayers}</b> Spieler fertig · <b>${readyDuels}/${st.duels.length}</b> Duelle bereit</div><div class="muted u-text-center">Jede Person kann beide Prompts direkt auf dem Handy auswählen und dann abschicken.</div><div class="row row--center"><button id="duelEmergencyVoteBtn" class="big secondary">Notfall: Voting jetzt starten</button></div><div class="muted u-text-center">Fehlende Songs werden als Platzhalter angezeigt; der vorhandene Gegensong erhält beim Auflösen automatisch den Punkt.</div>` });
      FMQ.$("duelEmergencyVoteBtn").onclick = () => { FMQ.resetMultiplayerRound?.(); st.phase = "duelVoting"; st.currentDuelIndex = 0; st.emergencyStarted = true; this.renderArea(); };
      return;
    }
    if (st.phase === "duelVoting") {
      const duel = this.currentDuel(st);
      if (!duel) { st.phase = "done"; this.renderArea(); return; }
      this.startCurrentDuelVote(st, duel);
      const voteIds = this.voteIdsForDuel(duel);
      const complete = this.currentDuelVotesComplete(duel);
      const voteInfo = this.duelNeedsVote(duel) ? `${Object.keys(duel.votes || {}).length}/${voteIds.length} Stimmen` : "Kein Voting nötig · Notfall-Platzhalter";
      if (complete && st.autoResolveDuelId !== duel.duelId) {
        st.autoResolveDuelId = duel.duelId;
        setTimeout(async () => {
          if (st.phase !== "duelVoting" || this.currentDuel(st)?.duelId !== duel.duelId || duel.winner) return;
          await FMQ.stopPlaybackNow?.();
          this.resolveCurrentDuel(st, duel);
        }, 900);
      }
      const body = `<div class="duelHostFocus"><div class="pill">Duell ${(st.currentDuelIndex || 0) + 1}/${st.duels.length}</div><div class="challengeRevealPrompt compact"><div class="eyebrow">Prompt</div><div>${FMQ.escapeHtml(duel.promptText)}</div></div>${this.duelTransportHtml()}<div class="duelSongs anonymous"><div><b>Song A</b><br>${FMQ.escapeHtml(duel.submissionA?.name || "Hier hätte ein Song sein können!")}<br><span class="muted">${FMQ.escapeHtml(duel.submissionA?.artistName || "Keine Antwort")}</span></div><div><b>Song B</b><br>${FMQ.escapeHtml(duel.submissionB?.name || "Hier hätte ein Song sein können!")}<br><span class="muted">${FMQ.escapeHtml(duel.submissionB?.artistName || "Keine Antwort")}</span></div></div><div class="muted u-text-center">${voteInfo}</div>${complete ? `<div class="autoRevealCountdown compact"><div class="muted">Alle Stimmen sind da</div><div class="countNum">🎉</div><div class="muted">Reveal startet automatisch …</div></div>` : FMQ.modes.bestFit.answerStatusHtml(voteIds, duel.votes || {})}<div class="row row--center"><button id="duelResolveCurrentBtn" class="big primary" ${complete ? "" : "disabled"}>${complete ? "Sofort aufdecken" : "Reveal & Punkte für dieses Duell"}</button><button id="duelEmergencyResolveBtn" class="big secondary">Notfall-Reveal</button></div></div>`;
      FMQ.renderModeLikeQuick3({ heading: "Song-Duell Voting", subtitle: "Ein Prompt nach dem anderen: anhören, abstimmen, reveal, nächster Prompt.", heroName: "", panelClass: "theme-playlist", bodyHtml: body });
      this.bindDuelTransport(duel);
      if (FMQ.$("duelResolveCurrentBtn")) FMQ.$("duelResolveCurrentBtn").onclick = async () => { await FMQ.stopPlaybackNow?.(); this.resolveCurrentDuel(st, duel); };
      if (FMQ.$("duelEmergencyResolveBtn")) FMQ.$("duelEmergencyResolveBtn").onclick = async () => { await FMQ.stopPlaybackNow?.(); this.resolveCurrentDuel(st, duel); };
      return;
    }
    if (st.phase === "duelResult") {
      const duel = this.currentDuel(st);
      if (!duel) { st.phase = "done"; this.renderArea(); return; }
      const finalDuel = (st.currentDuelIndex || 0) + 1 >= (st.duels || []).length;
      const row = `<div class="duelVoteHostCard duelResultCelebration"><div class="confettiBurst">🎉</div><div class="pill">Duell ${(st.currentDuelIndex || 0) + 1}${duel.autoResolved ? " · Notfall" : ""}</div><b>${FMQ.escapeHtml(duel.promptText)}</b><div class="duelSongs"><div><b>A · ${FMQ.escapeHtml(this.playerName(duel.playerAId))}</b><br>${FMQ.escapeHtml(duel.submissionA?.name || "Hier hätte ein Song sein können!")}<br><span class="pointBadge">${FMQ.escapeHtml(duel.voteCountA || 0)} ${duel.autoResolved ? "Auto-Punkte" : "Stimmen"}</span></div><div><b>B · ${FMQ.escapeHtml(this.playerName(duel.playerBId))}</b><br>${FMQ.escapeHtml(duel.submissionB?.name || "Hier hätte ein Song sein können!")}<br><span class="pointBadge">${FMQ.escapeHtml(duel.voteCountB || 0)} ${duel.autoResolved ? "Auto-Punkte" : "Stimmen"}</span></div></div></div>`;
      FMQ.renderModeLikeQuick3({ heading: "Song-Duell Reveal", subtitle: finalDuel ? "Alle Duelle dieser Runde sind aufgelöst." : "Danach kommt der nächste Prompt.", heroName: "", panelClass: "theme-playlist", bodyHtml: `${row}<div class="row row--center"><button id="duelNextPromptBtn" class="big primary">${finalDuel ? "Runde abschließen" : "Nächster Prompt"}</button></div>` });
      FMQ.$("duelNextPromptBtn").onclick = () => { st.autoResolveDuelId = null; if (finalDuel) st.phase = "done"; else { st.currentDuelIndex++; st.phase = "duelVoting"; } this.renderArea(); };
      return;
    }
    if (st.phase === "done") {
      const finalRound = FMQ.app.state.round >= FMQ.app.config.targetRounds;
      const resultRows = (st.duels || []).map((duel, idx) => `<div class="duelVoteHostCard"><div class="pill">Duell ${idx + 1}${duel.autoResolved ? " · Notfall" : ""}</div><b>${FMQ.escapeHtml(duel.promptText)}</b><div class="duelSongs"><div><b>A · ${FMQ.escapeHtml(this.playerName(duel.playerAId))}</b><br>${FMQ.escapeHtml(duel.submissionA?.name || "Hier hätte ein Song sein können!")}<br><span class="muted">${FMQ.escapeHtml(duel.voteCountA || 0)} ${duel.autoResolved ? "Auto-Punkte" : "Stimmen"}</span></div><div><b>B · ${FMQ.escapeHtml(this.playerName(duel.playerBId))}</b><br>${FMQ.escapeHtml(duel.submissionB?.name || "Hier hätte ein Song sein können!")}<br><span class="muted">${FMQ.escapeHtml(duel.voteCountB || 0)} ${duel.autoResolved ? "Auto-Punkte" : "Stimmen"}</span></div></div></div>`).join("");
      FMQ.renderModeLikeQuick3({ heading: "Song-Duell Runde beendet", subtitle: "Alle Prompts wurden einzeln aufgelöst. Bereit für die nächste Runde?", heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="duelVoteHostList">${resultRows}</div><button id="challengeRestartBtn" class="big primary">${finalRound ? "Spiel beenden" : "Nächste Runde"}</button>` });
      FMQ.$("challengeRestartBtn").onclick = () => this.finishDuelRound(st);
      return;
    }
    FMQ.app.state.songChallenge = null;
    this.renderArea();
  },
  submitShared(playerId, track) { const st = this.ensureState(); FMQ.markTrackUsed?.(track); st.submissions[playerId] = track; },
  submitDuel(playerId, answer, meta = {}) {
    const st = this.ensureState();
    st.duelSubmissionsByPlayer = st.duelSubmissionsByPlayer || {};
    const entries = answer && !answer.uri && typeof answer === "object"
      ? Object.entries(answer)
      : [[meta.duelId || st.duels?.[st.currentDuelIndex]?.duelId, answer]];
    entries.forEach(([duelId, track]) => {
      const duel = (st.duels || []).find(d => d.duelId === duelId);
      if (!duel || !track) return;
      FMQ.markTrackUsed?.(track);
      if (playerId === duel.playerAId) duel.submissionA = track;
      if (playerId === duel.playerBId) duel.submissionB = track;
    });
    st.duelSubmissionsByPlayer[playerId] = true;
  },
  submitVote(playerId, vote, meta = {}) {
    const st = this.ensureState();
    const entries = vote && typeof vote === "object" && !Array.isArray(vote)
      ? Object.entries(vote)
      : [[meta.duelId || st.duels?.[st.currentDuelIndex]?.duelId, vote]];
    entries.forEach(([duelId, choice]) => {
      const duel = (st.duels || []).find(d => d.duelId === duelId);
      if (!duel || !["A", "B"].includes(choice)) return;
      if (!this.voteIdsForDuel(duel).includes(playerId)) return;
      duel.votes[playerId] = choice;
    });
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};
FMQ.modes.storyPrompt = Object.assign(Object.create(FMQ.modes.songChallenge), { label: "Song-Geschichten" });
FMQ.modes.promptDuel = Object.assign(Object.create(FMQ.modes.songChallenge), { label: "Song-Duell" });

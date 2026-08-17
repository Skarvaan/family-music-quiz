window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Ranking Liste. Song für Song eine persönliche Top-5 oder
   Top-10 aufbauen. Ohne Sieger. */

FMQ.modes.rankingList = {
  label: "Ranking Liste",
  supportsAllGuess: false,
  submitAnswer(playerId, answer) {
    const st = FMQ.app.state.rankingList;
    st.answers[playerId] = answer;
    const size = st.size || 5;
    const rank = Math.max(1, Math.min(size, answer.rank || 1));
    const next = Array.from({ length: size }, (_, i) => (st.lists[playerId] || [])[i] || null);
    const lockedAtRank = next[rank - 1];
    if (lockedAtRank && lockedAtRank.track.id !== answer.track.id) return;
    for (let i = 0; i < next.length; i++) {
      if (next[i]?.track?.id === answer.track.id) next[i] = null;
    }
    next[rank - 1] = { track: answer.track, rank };
    st.lists[playerId] = next;
  },
  isPlayerComplete(playerId) {
    return (FMQ.app.state.rankingList.lists[playerId] || []).filter(Boolean).length >= (FMQ.app.state.rankingList.size || 5);
  },
  isComplete() {
    return FMQ.activePlayers().every(p => FMQ.modes.rankingList.isPlayerComplete(p.id));
  },
  renderRanking(playerId, preview = null) {
    const size = FMQ.app.state.rankingList.size || 5;
    const list = Array.from({ length: size }, (_, i) => (FMQ.app.state.rankingList.lists[playerId] || [])[i] || null);
    if (preview?.track && preview.rank) {
      for (let i = 0; i < list.length; i++) {
        if (list[i]?.track?.id === preview.track.id) list[i] = null;
      }
      list[preview.rank - 1] = { track: preview.track, rank: preview.rank, preview: true };
    }
    return `<div class="rankingSlots ${size === 10 ? "twoCols" : ""}">${Array.from({ length: size }, (_, i) => {
      const item = list[i];
      const cls = `rankingSlot ${item?.preview ? "pending" : ""} ${item && !item.preview ? "occupied" : ""}`.trim();
      return `<div class="${cls}" data-rank="${i + 1}"><div class="rankBadge">${i + 1}</div><div>${item ? `<b>${FMQ.escapeHtml(item.track.name)}</b><br><span class="muted">${FMQ.escapeHtml(item.track.artists.join(", "))} · ${item.track.year}${item.preview ? " · noch nicht fixiert" : ""}</span>` : `<span class="muted">Leer</span>`}</div></div>`;
    }).join("")}</div>`;
  },
  async playCurrent() {
    if (!FMQ.app.state.currentTrack) await FMQ.prepareTrackForTurn();
    const t = FMQ.app.state.currentTrack;
    const startMode = FMQ.getBoundStartMode("rankingStartModeSelect");
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
    if (FMQ.isMultiDevice?.()) {
      const expectedIds = [FMQ.currentPlayer()?.id].filter(Boolean);
      if (t && st.multiPromptTrackId !== t.id) {
        st.multiPromptTrackId = t.id;
        st.answers = {};
        FMQ.startMultiplayerPrompt?.({
          id: crypto.randomUUID(),
          type: "rankingList",
          title: "Ranking einordnen",
          text: `Auf welchen Platz kommt dieser Song?`,
          options: Array.from({ length: st.size || 5 }, (_, i) => ({ value: String(i + 1), label: `Platz ${i + 1}` })),
          waitingText: "Warte auf die Auswahl aller anderen Personen!",
          sentText: "Platz gespeichert. Bitte warten …",
          recipientIds: expectedIds
        });
      }
      const allDone = expectedIds.every(id => Object.prototype.hasOwnProperty.call(st.answers || {}, id));
      if (allDone) FMQ.modes.bestFit.scheduleAutoAdvance("rankingNext", () => FMQ.onNext());
    }
    FMQ.renderModeLikeQuick3({
      heading: `Ranking von ${me.name}`,
      subtitle: "Klicke den Song auf einen freien festen Platz. Erst mit Weiter wird er fixiert.",
      heroName: "",
      panelClass: "theme-playlist",
      bodyHtml: `<div class="pill">${st.size === 10 ? "Top 10" : "Top 5"}</div><div class="quick3Controls quick3Controls--center u-mt-md"><select id="rankingLenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option><option value="full">Ganzer Song</option></select><select id="rankingStartModeSelect"><option value="start">Von Anfang an</option><option value="random">Zufällig mittig</option></select><button id="rankingPlayBtn" class="big">▶️ Song hören</button><button id="rankingStopBtn" class="big">⏸️ Stop</button></div><div id="rankingCurrentCard" class="rankingSongCard"><b>${FMQ.escapeHtml(t.name)}</b><br><span>${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</span><div class="muted">Leeren Platz anklicken, dann mit Weiter fixieren</div></div><div id="rankingSlotsWrap" class="u-mt-md">${FMQ.modes.rankingList.renderRanking(me.id)}</div>${FMQ.isMultiDevice?.() ? FMQ.modes.bestFit.answerStatusHtml([FMQ.currentPlayer()?.id].filter(Boolean), st.answers) : ""}${FMQ.isMultiDevice?.() && [FMQ.currentPlayer()?.id].filter(Boolean).every(p => Object.prototype.hasOwnProperty.call(st.answers || {}, p)) ? FMQ.modes.bestFit.countdownHtml("Ranking ist gespeichert. Weiter in …") : ""}<div class="row row--center u-mt-lg"><button id="rankingNextBtn" class="big primary" ${FMQ.isMultiDevice?.() ? "" : "disabled"}>Weiter</button></div>`
    });
    FMQ.$("rankingLenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
    FMQ.$("rankingLenSelect").onchange = () => {
      const v = FMQ.$("rankingLenSelect").value;
      FMQ.app.state.quick3.clipSeconds = v === "full" ? "full" : parseInt(v, 10);
    };
    FMQ.bindPlayerStartModeSelect("rankingStartModeSelect");
    FMQ.$("rankingPlayBtn").onclick = () => FMQ.modes.rankingList.playCurrent().catch(e => FMQ.setGameDebug(e.stack || e.message));
    FMQ.$("rankingStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
    let pendingRank = null;
    const previewAt = rank => {
      const existing = (st.lists[me.id] || [])[rank - 1];
      if (existing && existing.track.id !== FMQ.app.state.currentTrack.id) return;
      pendingRank = rank;
      FMQ.$("rankingSlotsWrap").innerHTML = FMQ.modes.rankingList.renderRanking(me.id, { track: FMQ.app.state.currentTrack, rank });
      FMQ.$("rankingNextBtn").disabled = false;
      bindSlots();
    };
    const bindSlots = () => {
      FMQ.$("rankingSlotsWrap").querySelectorAll("[data-rank]").forEach(slot => {
        const rank = parseInt(slot.getAttribute("data-rank"), 10);
        const existing = (st.lists[me.id] || [])[rank - 1];
        slot.onclick = () => previewAt(rank);
        if (existing && existing.track.id !== FMQ.app.state.currentTrack.id) slot.setAttribute("aria-disabled", "true");
      });
    };
    bindSlots();
    FMQ.$("rankingNextBtn").onclick = () => {
      if (!pendingRank) return;
      FMQ.modes.rankingList.submitAnswer(me.id, { track: FMQ.app.state.currentTrack, rank: pendingRank });
      FMQ.onNext();
    };
  },
  renderFinal() {
    FMQ.pausePlayback().catch(() => {});
    FMQ.showScreen("screenGame");
    FMQ.$("screenGame").classList.add("quick3Active");
    FMQ.$("gameModeLabel").textContent = "Ranking Finale";
    FMQ.$("roundLabel").textContent = "Finale";
    FMQ.$("scoreTable").innerHTML = "";
    FMQ.$("turnPlayerBanner").style.display = "none";
    FMQ.$("gameMetaBanner").style.display = "";
    FMQ.$("modeAreaTitle").textContent = "Finale Top-Listen";
    FMQ.$("readyBtn").style.display = "none";
    FMQ.$("playToggleBtn").style.display = "none";
    FMQ.$("revealBtn").style.display = "none";
    FMQ.$("nextBtn").style.display = "none";
    FMQ.$("quick3Controls").style.display = "none";
    if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").style.display = "none";
    FMQ.renderModeLikeQuick3({ heading: "Finale Top-Listen", subtitle: "Es gibt keinen Gewinner – tippe einen Namen, um die Top-Liste ein-/auszublenden.", heroName: "", panelClass: "theme-playlist", bodyHtml: `<div class="choiceGrid choiceGrid--center">${FMQ.activePlayers().map(p => `<button class="choiceBtn" data-final-ranking="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div><div id="finalRankingList" class="u-mt-md"></div><div class="row row--center u-mt-md"><button id="rankingEndBtn" class="big primary">Zurück zum Start</button></div>` });
    let openPid = null;
    FMQ.$("modeArea").querySelectorAll("[data-final-ranking]").forEach(btn => btn.onclick = () => {
      const pid = btn.getAttribute("data-final-ranking");
      openPid = openPid === pid ? null : pid;
      FMQ.$("modeArea").querySelectorAll("[data-final-ranking]").forEach(x => x.classList.toggle("selected", x.getAttribute("data-final-ranking") === openPid));
      FMQ.$("finalRankingList").innerHTML = openPid ? `<h3>${FMQ.escapeHtml(FMQ.getPlayerName(openPid))}</h3>${FMQ.modes.rankingList.renderRanking(openPid)}` : "";
    });
    FMQ.$("rankingEndBtn").onclick = () => FMQ.quitToMenu();
  },
  onReveal() { return { skipReveal: true, disableReveal: true }; }
};

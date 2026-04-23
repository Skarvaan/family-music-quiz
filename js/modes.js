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
};

FMQ.initSocialRound = ({ modeId, startPhase = "othersGuessing" }) => {
  const mainPlayerId = FMQ.app.state.currentSourcePlayerId || FMQ.currentPlayer().id;
  FMQ.app.state.social = {
    modeId,
    phase: startPhase,
    mainPlayerId,
    respondingPlayersQueue: FMQ.app.players.filter(p => p.id !== mainPlayerId).map(p => p.id),
    currentResponderIndex: 0,
    answers: new Map(),
    mainAnswer: null
  };
};
FMQ.getSocialResponderId = () => {
  const s = FMQ.app.state.social;
  if (!s) return null;
  return s.respondingPlayersQueue[s.currentResponderIndex] || null;
};

FMQ.modes = {
  guessSong: {
    label: "Song erkennen",
    supportsAllGuess: false,
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
        const pts = (FMQ.$("chkTitle").checked ? 1 : 0) + (FMQ.$("chkArtist").checked ? 1 : 0) + (FMQ.$("chkYear").checked ? 1 : 0);
        FMQ.awardPoints(me.id, pts);
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
        subtitle: "Punkte sinken mit der Zeit. Klicke „Reveal“, wenn du deine Antwort abgeben willst.",
        panelClass: "theme-guess",
        bodyHtml: `<div style="margin-top:10px;"><b>Aktuelle Punkte: <span id="speedPtsLabel">4</span></b></div>`
      });
    },
    onReveal() {
      FMQ.app.state.selfCheckPending = true;
      return { headline: "Auflösung", detail: "War deine Antwort richtig?" };
    },
    renderRevealExtras() {
      const me = FMQ.currentPlayer();
      FMQ.$("revealExtra").innerHTML = `
        <div class="box" style="box-shadow:none;">
          <h2>Treffer?</h2>
          <div class="row"><button id="speedYesBtn" class="primary">Ja, richtig</button><button id="speedNoBtn">Nein</button></div>
        </div>
      `;
      const pts = Math.max(0, FMQ.app.state.speed?.currentPoints ?? 0);
      FMQ.$("speedYesBtn").onclick = () => {
        FMQ.awardPoints(me.id, pts);
        FMQ.app.state.selfCheckPending = false;
        FMQ.$("nextBtn").disabled = false;
        FMQ.$("speedYesBtn").disabled = true;
        FMQ.$("speedNoBtn").disabled = true;
        FMQ.renderScoreTable();
      };
      FMQ.$("speedNoBtn").onclick = () => {
        FMQ.app.state.selfCheckPending = false;
        FMQ.$("nextBtn").disabled = false;
        FMQ.$("speedYesBtn").disabled = true;
        FMQ.$("speedNoBtn").disabled = true;
      };
    }
  },
  quick3: {
    label: "Songausschnitt raten",
    supportsAllGuess: false,
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
  yearRange: {
    label: "Zeitraum raten (MC)",
    supportsAllGuess: true,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Zeitraum raten";
      FMQ.renderModeLikeQuick3({
        heading: "Zeitraum raten",
        subtitle: "Wähle den richtigen Zeitraum.",
        panelClass: "theme-range",
        bodyHtml: `<div id="yearChoices"></div><div id="allGuessPanel" style="margin-top:10px;"></div>`
      });
    },
    stepPoints(step) { return step === 10 ? 1 : step === 5 ? 2 : step === 2 ? 3 : 4; },
    buildOptionsForYear(year, step, spanMin, spanMax) {
      const nowYear = new Date().getFullYear();
      const minBound = Number.isFinite(spanMin) ? spanMin : 1900;
      const maxBound = Math.min(Number.isFinite(spanMax) ? spanMax : nowYear, nowYear);
      const bucket = step === 1 ? year : Math.floor(year / step) * step;
      const allStarts = [];
      for (let s = minBound; s <= maxBound; s += step) allStarts.push(s);
      if (!allStarts.includes(bucket)) allStarts.push(bucket);
      const sortedStarts = [...new Set(allStarts)].sort((a, b) => a - b);
      const pos = Math.max(0, sortedStarts.indexOf(bucket));
      const from = Math.max(0, Math.min(pos - 1, sortedStarts.length - 4));
      const starts = sortedStarts.slice(from, from + 4);
      const buckets = starts.map(s => {
        const end = step === 1 ? s : Math.min(s + step - 1, maxBound);
        return { start: s, end };
      });
      return { buckets, correctIdx: buckets.findIndex(b => b.start === bucket) };
    },
    renderChoices() {
      const step = FMQ.app.state.yearRange.step;
      const buckets = FMQ.app.state.yearRange.options;
      FMQ.$("yearChoices").innerHTML = `<div class="choiceGrid">${buckets.map((b, i) => `<button class="choiceBtn" data-choice="${i}">${step === 10 ? `${b.start}er` : step === 1 ? `${b.start}` : `${b.start}–${b.end}`}</button>`).join("")}</div>`;
      FMQ.app.state.yearRange.picks = new Map();
      if (FMQ.app.config.party === "rotate") {
        FMQ.$("yearChoices").querySelectorAll("[data-choice]").forEach(btn => btn.onclick = () => {
          FMQ.$("yearChoices").querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.app.state.yearRange.picks.set(FMQ.currentPlayer().id, parseInt(btn.dataset.choice, 10));
          FMQ.$("revealBtn").disabled = false;
        });
        FMQ.$("allGuessPanel").innerHTML = "";
      } else {
        FMQ.$("allGuessPanel").innerHTML = FMQ.app.players.map(p => `
          <div class="row" style="margin:8px 0;">
            <span class="pill">${FMQ.escapeHtml(p.name)}</span>
            <div class="choiceGrid" data-player-pick="${p.id}">
              ${buckets.map((b,i)=>`<button class="choiceBtn" data-choice="${i}" data-pid="${p.id}">${i+1}</button>`).join("")}
            </div>
          </div>
        `).join("");
        FMQ.$("allGuessPanel").querySelectorAll("[data-choice][data-pid]").forEach(btn => {
          btn.onclick = () => {
            const pid = btn.getAttribute("data-pid");
            const row = FMQ.$("allGuessPanel").querySelector(`[data-player-pick="${pid}"]`);
            row.querySelectorAll(".choiceBtn").forEach(x=>x.classList.remove("selected"));
            btn.classList.add("selected");
            FMQ.app.state.yearRange.picks.set(pid, parseInt(btn.getAttribute("data-choice"), 10));
            FMQ.$("revealBtn").disabled = FMQ.app.state.yearRange.picks.size !== FMQ.app.players.length;
          };
        });
      }
    },
    onReveal() {
      if (FMQ.app.config.party === "allguess") {
        let cnt = 0;
        for (const p of FMQ.app.players) {
          const correct = FMQ.app.state.yearRange.picks.get(p.id) === FMQ.app.state.yearRange.correctIdx;
          if (correct) { FMQ.awardPoints(p.id, FMQ.app.state.yearRange.points); cnt++; }
        }
        return { headline: "Auflösung", detail: `${cnt} richtig · +${FMQ.app.state.yearRange.points} je richtig` };
      }
      const me = FMQ.currentPlayer();
      const correct = FMQ.app.state.yearRange.picks.get(me.id) === FMQ.app.state.yearRange.correctIdx;
      if (correct) FMQ.awardPoints(me.id, FMQ.app.state.yearRange.points);
      return { headline: correct ? "✅ RICHTIG" : "❌ FALSCH", detail: `+${FMQ.app.state.yearRange.points} bei richtig` };
    }
  },
  playlistGuess: {
    label: "Welche Playlist ist das?",
    supportsAllGuess: true,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Welche Playlist ist das?";
      FMQ.renderModeLikeQuick3({
        heading: "Welche Playlist ist das?",
        subtitle: "Rate, in wessen Playlist der Song liegt.",
        panelClass: "theme-playlist",
        bodyHtml: `<div id="plGuessPanel"></div>`
      });
    },
    renderGuessUI() {
      const c = FMQ.$("plGuessPanel");
      c.innerHTML = `<div class="choiceGrid">${FMQ.app.players.map(p => `<button class="choiceBtn" data-owner="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div>`;
      FMQ.app.state.playlistGuess.picks = new Map();
      if (FMQ.app.config.party === "rotate") {
        c.querySelectorAll("[data-owner]").forEach(btn => btn.onclick = () => {
          c.querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.app.state.playlistGuess.picks.set(FMQ.currentPlayer().id, btn.dataset.owner);
          FMQ.$("revealBtn").disabled = false;
        });
      } else {
        c.innerHTML = FMQ.app.players.map(p => `
          <div class="row" style="margin:8px 0;">
            <span class="pill">${FMQ.escapeHtml(p.name)}</span>
            <div class="choiceGrid" data-owner-row="${p.id}">
              ${FMQ.app.players.map(o=>`<button class="choiceBtn" data-owner="${o.id}" data-pid="${p.id}">${FMQ.escapeHtml(o.name)}</button>`).join("")}
            </div>
          </div>
        `).join("");
        c.querySelectorAll("[data-owner][data-pid]").forEach(btn => {
          btn.onclick = () => {
            const pid = btn.getAttribute("data-pid");
            const row = c.querySelector(`[data-owner-row="${pid}"]`);
            row.querySelectorAll(".choiceBtn").forEach(x=>x.classList.remove("selected"));
            btn.classList.add("selected");
            FMQ.app.state.playlistGuess.picks.set(pid, btn.getAttribute("data-owner"));
            FMQ.$("revealBtn").disabled = FMQ.app.state.playlistGuess.picks.size !== FMQ.app.players.length;
          };
        });
      }
    },
    onReveal() {
      const valid = new Set(FMQ.app.state.currentTrack.owners || []);
      if (FMQ.app.config.party === "allguess") {
        let cnt = 0;
        for (const p of FMQ.app.players) {
          const ok = valid.has(FMQ.app.state.playlistGuess.picks.get(p.id));
          if (ok) { FMQ.awardPoints(p.id, 1); cnt++; }
        }
        return { headline: "Auflösung", detail: `${cnt} richtig · 1 Punkt je richtig` };
      }
      const me = FMQ.currentPlayer();
      const ok = valid.has(FMQ.app.state.playlistGuess.picks.get(me.id));
      FMQ.awardPoints(me.id, ok ? 1 : 0);
      return { headline: ok ? "✅ RICHTIG" : "❌ FALSCH", detail: "1 Punkt bei richtig" };
    }
  },
  ratingGuess: {
    label: "Song-Bewertung einschätzen",
    supportsAllGuess: false,
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
          bodyHtml: `<div class="row" style="justify-content:center;"><button id="ratingStartBtn" class="big primary">▶️ Song starten</button></div><div class="row" style="justify-content:center;"><button id="ratingListenNextBtn" class="big" disabled>Weiter</button></div>`
        });
        FMQ.$("ratingStartBtn").onclick = async () => {
          if (!FMQ.app.state.currentTrack) await FMQ.prepareTrackForTurn();
          await FMQ.playTrackUri(FMQ.app.state.currentTrack.uri, { positionMs: 0 });
          FMQ.app.state.isPlaying = true;
          FMQ.$("ratingListenNextBtn").disabled = false;
        };
        FMQ.$("ratingListenNextBtn").onclick = () => { s.phase = "othersGuessing"; FMQ.modes.ratingGuess.renderArea(); };
      } else if (s.phase === "othersGuessing") {
        const pid = FMQ.getSocialResponderId();
        const responder = FMQ.getPlayerName(pid);
        FMQ.renderModeLikeQuick3({
          heading: `Wie findet "${mainName}" diesen Song?`,
          subtitle: `Wie bewertet ${mainName} diesen Song (1-10)?`,
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(responder)} ist dran</div><div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingNextBtn" class="big primary" disabled>Weiter</button></div>`
        });
        FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.answers.set(pid, parseInt(btn.getAttribute("data-rate"), 10));
          FMQ.$("ratingNextBtn").disabled = false;
        });
        FMQ.$("ratingNextBtn").onclick = () => {
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
          bodyHtml: `<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-main-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.mainAnswer = parseInt(btn.getAttribute("data-main-rate"), 10);
          FMQ.$("ratingRevealBtn").disabled = false;
        });
        FMQ.$("ratingRevealBtn").onclick = () => {
          const truth = Math.max(1, Math.min(10, parseInt(String(s.mainAnswer || "0"), 10)));
          const lines = [];
          for (const p of FMQ.app.players) {
            if (p.id === s.mainPlayerId) continue;
            const val = parseInt(String(s.answers.get(p.id) || 0), 10);
            const diff = Math.abs(truth - (val || 0));
            const pts = diff === 0 ? 3 : diff === 1 ? 2 : diff === 2 ? 1 : 0;
            FMQ.awardPoints(p.id, pts);
            lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${val || "-"} → <b>+${pts}</b></div>`);
          }
          const t = FMQ.app.state.currentTrack;
          FMQ.renderModeLikeQuick3({
            heading: `Auflösung: ${mainName}`,
            subtitle: "",
            heroName: "",
            panelClass: "theme-playlist",
            bodyHtml: `<div class="socialRevealBig"><div><b>${FMQ.escapeHtml(t.name)}</b> · ${FMQ.escapeHtml(t.artists.join(", "))} · ${t.year}</div><div class="socialTruthLine">"${mainName}" sagte: <b>${truth}/10</b></div><div class="socialPointsBlock">${lines.join("")}</div></div><div class="row" style="justify-content:center;"><button id="socialDoneBtn" class="big primary">Nächster Zug</button></div>`
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
  bestFit: {
    label: "Song A oder B",
    supportsAllGuess: false,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Song A oder Song B";
      if (!FMQ.app.state.social || FMQ.app.state.social.modeId !== "bestFit") FMQ.initSocialRound({ modeId: "bestFit", startPhase: "listen" });
      const s = FMQ.app.state.social;
      const mainName = FMQ.getPlayerName(s.mainPlayerId);
      const trackA = FMQ.app.state.bestFitTracks?.a;
      const trackB = FMQ.app.state.bestFitTracks?.b;
      if (s.phase === "listen") {
        if (!trackA || !trackB) {
          FMQ.renderModeLikeQuick3({
            heading: `Großer Start für ${mainName}`,
            subtitle: "Es werden zwei Songs (A/B) geladen.",
            heroName: "",
            panelClass: "theme-playlist",
            bodyHtml: `<div class="row" style="justify-content:center;"><button id="bestFitStartBtn" class="big primary">▶️ Song A/B vorbereiten</button></div>`
          });
          FMQ.$("bestFitStartBtn").onclick = async () => {
            await FMQ.prepareTrackForTurn();
            FMQ.modes.bestFit.renderArea();
          };
          return;
        }
        FMQ.renderModeLikeQuick3({
          heading: `Welchen Song findet "${mainName}" besser?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="abListenButtons"><button id="playABtn" class="big">▶️ Song A</button><button id="playBBtn" class="big">▶️ Song B</button></div><div class="row" style="justify-content:center; margin-top:10px;"><button id="bestFitContinueBtn" class="primary big">Weiter zur Tipp-Runde</button></div>`
        });
        FMQ.$("playABtn").onclick = () => { FMQ.app.state.currentTrack = trackA; FMQ.playTrackUri(trackA.uri, { positionMs: 0 }).then(()=>{ FMQ.app.state.isPlaying = true; FMQ.$("playToggleBtn").textContent = "⏸️ Stop"; }).catch(e => FMQ.setGameDebug(e.stack || e.message)); };
        FMQ.$("playBBtn").onclick = () => { FMQ.app.state.currentTrack = trackB; FMQ.playTrackUri(trackB.uri, { positionMs: 0 }).then(()=>{ FMQ.app.state.isPlaying = true; FMQ.$("playToggleBtn").textContent = "⏸️ Stop"; }).catch(e => FMQ.setGameDebug(e.stack || e.message)); };
        FMQ.$("bestFitContinueBtn").onclick = () => { s.phase = "othersGuessing"; FMQ.modes.bestFit.renderArea(); };
      } else if (s.phase === "othersGuessing") {
        const pid = FMQ.getSocialResponderId();
        FMQ.renderModeLikeQuick3({
          heading: `Welchen Song findet "${mainName}" besser?`,
          subtitle: "",
          heroName: "",
          panelClass: "theme-playlist",
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(FMQ.getPlayerName(pid))} ist dran</div><div class="quick3Controls" style="justify-content:center; margin-bottom:8px;"><button id="playABtn">▶️ Play Song A</button><button id="playBBtn">▶️ Play Song B</button></div><div class="choiceGrid" style="margin-top:10px;"><button class="choiceBtn big" data-pick="A">Song A</button><button class="choiceBtn big" data-pick="B">Song B</button></div><div class="row" style="justify-content:center;"><button id="bfNextBtn" class="big primary" disabled>Weiter</button></div>`
        });
        FMQ.$("playABtn").onclick = () => FMQ.playTrackUri(trackA.uri, { positionMs: 0 }).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("playBBtn").onclick = () => FMQ.playTrackUri(trackB.uri, { positionMs: 0 }).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("modeArea").querySelectorAll("[data-pick]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-pick]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.answers.set(pid, btn.getAttribute("data-pick"));
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
          bodyHtml: `<div class="quick3Controls" style="justify-content:center; margin-bottom:8px;"><button id="playABtn">▶️ Play Song A</button><button id="playBBtn">▶️ Play Song B</button></div><div class="abListenButtons"><button class="big choiceBtn" data-main-pick="A">Song A</button><button class="big choiceBtn" data-main-pick="B">Song B</button></div><div class="row" style="justify-content:center;"><button id="bfRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.$("playABtn").onclick = () => FMQ.playTrackUri(trackA.uri, { positionMs: 0 }).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("playBBtn").onclick = () => FMQ.playTrackUri(trackB.uri, { positionMs: 0 }).catch(e => FMQ.setGameDebug(e.stack || e.message));
        FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.mainAnswer = btn.getAttribute("data-main-pick");
          FMQ.$("bfRevealBtn").disabled = false;
        });
        FMQ.$("bfRevealBtn").onclick = () => {
          const truth = s.mainAnswer || "A";
          const lines = [];
          for (const p of FMQ.app.players) {
            if (p.id === s.mainPlayerId) continue;
            const guessed = s.answers.get(p.id);
            const pts = guessed === truth ? 1 : 0;
            if (pts) FMQ.awardPoints(p.id, pts);
            lines.push(`<div><b>${FMQ.escapeHtml(p.name)}:</b> ${guessed || "-"} → <b>+${pts}</b></div>`);
          }
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

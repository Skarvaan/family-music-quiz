window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;
// Hinweis: modes.js enthält nur modus-spezifische Render- und Spielregeln.

FMQ.renderQuick3ActionControls = () => {
  const c = FMQ.$("quick3Controls");
  c.innerHTML = `<select id="quick3LenSelect"><option value="3">3 Sekunden</option><option value="5">5 Sekunden</option><option value="10">10 Sekunden</option></select><button id="quick3PlayStartBtn" class="big">▶️ Play-Start</button><button id="quick3PlayRandomBtn" class="big">🎲 Play-Zufall</button>`;
  FMQ.$("quick3LenSelect").value = String(FMQ.app.state.quick3.clipSeconds);
  FMQ.$("quick3LenSelect").onchange = () => FMQ.app.state.quick3.clipSeconds = parseInt(FMQ.$("quick3LenSelect").value, 10);
  FMQ.$("quick3PlayStartBtn").onclick = () => FMQ.onQuick3Play("start").catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("quick3PlayRandomBtn").onclick = () => FMQ.onQuick3Play("random").catch(e => FMQ.setGameDebug(e.stack || e.message));
};

FMQ.modes = {
  timeline: {
    label: "Timeline (Einordnen)",
    supportsAllGuess: false,
    renderArea() {
      const me = FMQ.currentPlayer();
      const slots = Array.from({ length: me.timelineCards.length + 1 }, (_, i) => `<div class="slot ${i === FMQ.app.state.timeline.chosenSlot ? "active" : ""}" data-slot="${i}">+</div>`).join("");
      const cards = me.timelineCards.map(c => c.isReference ? `<div class="card"><div class="year">${c.year}</div><div class="artist muted">Referenz</div></div>` : `<div class="card"><div class="year">${c.year}</div><div class="title">${FMQ.escapeHtml(c.name)}</div><div class="artist">${FMQ.escapeHtml(c.artists.join(", "))}</div></div>`).join("");
      FMQ.$("modeAreaTitle").textContent = "Timeline";
      FMQ.$("modeArea").innerHTML = `<div class="slotRow" id="timelineSlots">${slots}</div><div class="timelineLine">${cards}</div>`;
      FMQ.$("timelineSlots").querySelectorAll("[data-slot]").forEach(el => el.onclick = () => {
        FMQ.app.state.timeline.chosenSlot = parseInt(el.dataset.slot, 10);
        FMQ.modes.timeline.renderArea();
      });
    },
    onReveal() {
      const me = FMQ.currentPlayer();
      const t = FMQ.app.state.currentTrack;
      const i = FMQ.app.state.timeline.chosenSlot;
      const left = i - 1 >= 0 ? me.timelineCards[i - 1]?.year : null;
      const right = i < me.timelineCards.length ? me.timelineCards[i]?.year : null;
      const ok = !((left !== null && t.year < left) || (right !== null && t.year > right));
      const risk = FMQ.app.state.timeline.chosenRisk || "safe";
      FMQ.awardPoints(me.id, risk === "safe" ? (ok ? 1 : 0) : (ok ? 2 : -1));
      if (ok) me.timelineCards.splice(i, 0, t); else me.wrongTimeline.push({ ...t, riskLabel: risk });
      return { headline: ok ? "✅ RICHTIG" : "❌ FALSCH", detail: risk === "safe" ? "Safe (+1/0)" : "Wagnis (+2/-1)" };
    }
  },
  guessSong: {
    label: "Song raten (Titel/Interpret/Jahr)",
    supportsAllGuess: false,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Song raten";
      FMQ.$("modeArea").innerHTML = '<div class="muted">Nach Reveal Punkte per Selbst-Check bestätigen.</div>';
    },
    onReveal() {
      FMQ.app.state.selfCheckPending = true;
      return { headline: "Auflösung", detail: "Selbst-Check notwendig" };
    },
    renderRevealExtras() {
      const me = FMQ.currentPlayer();
      FMQ.$("revealExtra").innerHTML = `<div class="box" style="box-shadow:none;"><h2>Selbst-Check</h2><label><input type="checkbox" id="chkTitle"> Titel (1)</label><label><input type="checkbox" id="chkArtist"> Interpret (1)</label><label><input type="checkbox" id="chkYear"> Jahr (1)</label><div class="row"><button id="confirmGuessPtsBtn" class="primary">Punkte bestätigen</button><span class="muted" id="guessPtsStatus"></span></div></div>`;
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
  quick3: {
    label: "3-Sekunden Challenge",
    supportsAllGuess: false,
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "3-Sekunden Challenge";
      FMQ.$("modeArea").innerHTML = '<div class="muted">Wähle Länge und nutze dann Play-Start oder Play-Zufall. Bis Reveal bleibt die gleiche Sequenz gespeichert.</div>';
      FMQ.renderQuick3ActionControls();
    },
    getClipSeconds() { return FMQ.app.state.quick3.clipSeconds || 3; },
    randomStartMs(track) {
      const dur = track.durationMs || 180000;
      const clip = this.getClipSeconds() * 1000;
      const min = 20000;
      const max = Math.max(min, dur - 20000 - clip);
      return max <= min ? 0 : Math.floor(min + Math.random() * (max - min));
    },
    async playStored(track, startMs) {
      await FMQ.playTrackUri(track.uri, { positionMs: startMs });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = setTimeout(async () => {
        try { await FMQ.pausePlayback(); } catch {}
        FMQ.app.state.isPlaying = false;
      }, this.getClipSeconds() * 1000);
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
      FMQ.$("modeArea").innerHTML = '<div id="yearChoices"></div><div id="allGuessPanel"></div>';
    },
    stepPoints(step) { return step === 10 ? 1 : step === 5 ? 2 : step === 2 ? 3 : 4; },
    buildOptionsForYear(year, step) {
      const bucket = step === 1 ? year : Math.floor(year / step) * step;
      const starts = [bucket - 2 * step, bucket - step, bucket, bucket + step].sort((a, b) => a - b).map(s => Math.max(1900, s));
      const buckets = starts.map(s => ({ start: s, end: step === 1 ? s : s + step - 1 }));
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
      }
    },
    onReveal() {
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
      FMQ.$("modeArea").innerHTML = '<div id="plGuessPanel"></div>';
    },
    renderGuessUI() {
      const c = FMQ.$("plGuessPanel");
      c.innerHTML = `<div class="choiceGrid">${FMQ.app.players.map(p => `<button class="choiceBtn" data-owner="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div>`;
      FMQ.app.state.playlistGuess.picks = new Map();
      c.querySelectorAll("[data-owner]").forEach(btn => btn.onclick = () => {
        c.querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
        FMQ.app.state.playlistGuess.picks.set(FMQ.currentPlayer().id, btn.dataset.owner);
        FMQ.$("revealBtn").disabled = false;
      });
    },
    onReveal() {
      const me = FMQ.currentPlayer();
      const valid = new Set(FMQ.app.state.currentTrack.owners || []);
      const ok = valid.has(FMQ.app.state.playlistGuess.picks.get(me.id));
      FMQ.awardPoints(me.id, ok ? 1 : 0);
      return { headline: ok ? "✅ RICHTIG" : "❌ FALSCH", detail: "1 Punkt bei richtig" };
    }
  }
};

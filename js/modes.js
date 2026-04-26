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
    mainAnswer: null
  };
};
FMQ.getSocialResponderId = () => {
  const s = FMQ.app.state.social;
  if (!s) return null;
  return s.respondingPlayersQueue[s.currentResponderIndex] || null;
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
        bodyHtml: `<div class="yearRangeToolbar"><select id="yearStepSelect"><option value="10">Jahrzehnt (+1)</option><option value="5">5 Jahre (+2)</option><option value="2">2 Jahre (+3)</option><option value="1">Exaktes Jahr (+4)</option></select><button id="yearStartBtn" class="big primary">▶️ Start</button><button id="yearStopBtn" class="big">⏸️ Stop</button><button id="yearRevealBtn" class="big">Reveal</button><button id="yearNextBtn" class="big primary">Weiter</button></div><div id="yearChoices" style="margin-top:10px;"></div><div id="allGuessPanel" style="margin-top:10px;"></div>`
      });
      FMQ.$("yearStepSelect").value = String(FMQ.app.state.yearRange.step || 10);
      FMQ.$("yearStepSelect").onchange = async () => {
        const step = parseInt(FMQ.$("yearStepSelect").value, 10);
        FMQ.app.state.yearRange.step = step;
        FMQ.app.state.yearRange.points = FMQ.modes.yearRange.stepPoints(step);
        if (FMQ.app.state.currentTrack) {
          const me = FMQ.currentPlayer();
          const built = FMQ.modes.yearRange.buildOptionsForYear(FMQ.app.state.currentTrack.year, step, me.spanMin, me.spanMax);
          FMQ.app.state.yearRange.options = built.buckets;
          FMQ.app.state.yearRange.correctIdx = built.correctIdx;
          FMQ.modes.yearRange.renderChoices();
        }
      };
      FMQ.$("yearStartBtn").onclick = () => FMQ.$("readyBtn").click();
      FMQ.$("yearStopBtn").onclick = () => FMQ.pausePlayback().catch(() => {});
      FMQ.$("yearRevealBtn").onclick = () => FMQ.$("revealBtn").click();
      FMQ.$("yearNextBtn").onclick = () => FMQ.$("nextBtn").click();
      FMQ.modes.yearRange.syncControlStates();
    },
    syncControlStates() {
      if (!FMQ.$("yearStartBtn")) return;
      FMQ.$("yearRevealBtn").disabled = FMQ.$("revealBtn").disabled;
      FMQ.$("yearNextBtn").disabled = FMQ.$("nextBtn").disabled;
    },
    stepPoints(step) { return step === 10 ? 1 : step === 5 ? 2 : step === 2 ? 3 : 4; },
    buildOptionsForYear(year, step, spanMin, spanMax) {
      const nowYear = new Date().getFullYear();
      const minBound = Number.isFinite(spanMin) ? spanMin : 1900;
      const maxBound = Math.min(Number.isFinite(spanMax) ? spanMax : nowYear, nowYear);
      const bucket = step === 1 ? year : Math.floor(year / step) * step;
      const alignedMin = step === 10 ? Math.floor(minBound / 10) * 10 : minBound;
      const allStarts = [];
      for (let s = alignedMin; s <= maxBound; s += step) allStarts.push(s);
      if (!allStarts.includes(bucket)) allStarts.push(bucket);
      let sortedStarts = [...new Set(allStarts)].sort((a, b) => a - b);
      let probe = sortedStarts[0] ?? bucket;
      while (sortedStarts.length < 4) {
        probe -= step;
        if (probe < 1900) break;
        sortedStarts.unshift(probe);
      }
      sortedStarts = [...new Set(sortedStarts)].sort((a, b) => a - b);
      const pos = Math.max(0, sortedStarts.indexOf(bucket));
      const from = Math.max(0, Math.min(pos - 1, sortedStarts.length - 4));
      let starts = sortedStarts.slice(from, from + 4);
      if (starts.length < 4) {
        const last = starts[starts.length - 1] ?? bucket;
        for (let i = starts.length; i < 4; i++) starts.push(last + ((i - starts.length + 1) * step));
      }
      const buckets = starts.map(s => {
        const end = step === 1 ? s : Math.min(s + step - 1, maxBound);
        return { start: s, end };
      });
      return { buckets, correctIdx: buckets.findIndex(b => b.start === bucket) };
    },
    renderChoices() {
      const step = FMQ.app.state.yearRange.step;
      const buckets = FMQ.app.state.yearRange.options;
      FMQ.$("yearChoices").innerHTML = `<div class="choiceGrid">${buckets.map((b, i) => `<button class="choiceBtn" data-choice="${i}">${step === 10 ? `${Math.floor(b.start / 10) * 10}er` : step === 1 ? `${b.start}` : `${b.start}–${b.end}`}</button>`).join("")}</div>`;
      FMQ.app.state.yearRange.picks = new Map();
      if (FMQ.app.config.party === "rotate") {
        FMQ.$("yearChoices").querySelectorAll("[data-choice]").forEach(btn => btn.onclick = () => {
          FMQ.$("yearChoices").querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.app.state.yearRange.picks.set(FMQ.currentPlayer().id, parseInt(btn.dataset.choice, 10));
          FMQ.$("revealBtn").disabled = false;
          FMQ.modes.yearRange.syncControlStates();
        });
        FMQ.$("allGuessPanel").innerHTML = "";
      } else {
        const activePlayers = FMQ.activePlayers();
        FMQ.$("allGuessPanel").innerHTML = activePlayers.map(p => `
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
            FMQ.$("revealBtn").disabled = FMQ.app.state.yearRange.picks.size !== activePlayers.length;
            FMQ.modes.yearRange.syncControlStates();
          };
        });
      }
    },
    onReveal() {
      if (FMQ.app.config.party === "allguess") {
        let cnt = 0;
        for (const p of FMQ.activePlayers()) {
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
      const activePlayers = FMQ.activePlayers();
      c.innerHTML = `<div class="choiceGrid">${activePlayers.map(p => `<button class="choiceBtn" data-owner="${p.id}">${FMQ.escapeHtml(p.name)}</button>`).join("")}</div>`;
      FMQ.app.state.playlistGuess.picks = new Map();
      if (FMQ.app.config.party === "rotate") {
        c.querySelectorAll("[data-owner]").forEach(btn => btn.onclick = () => {
          c.querySelectorAll(".choiceBtn").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          FMQ.app.state.playlistGuess.picks.set(FMQ.currentPlayer().id, btn.dataset.owner);
          FMQ.$("revealBtn").disabled = false;
        });
      } else {
        c.innerHTML = activePlayers.map(p => `
          <div class="row" style="margin:8px 0;">
            <span class="pill">${FMQ.escapeHtml(p.name)}</span>
            <div class="choiceGrid" data-owner-row="${p.id}">
              ${activePlayers.map(o=>`<button class="choiceBtn" data-owner="${o.id}" data-pid="${p.id}">${FMQ.escapeHtml(o.name)}</button>`).join("")}
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
            FMQ.$("revealBtn").disabled = FMQ.app.state.playlistGuess.picks.size !== activePlayers.length;
          };
        });
      }
    },
    onReveal() {
      const valid = new Set(FMQ.app.state.currentTrack.owners || []);
      if (FMQ.app.config.party === "allguess") {
        let cnt = 0;
        for (const p of FMQ.activePlayers()) {
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
  // =========================================================
  // SOCIAL MODUS 1: Song-Bewertung einschätzen
  // =========================================================
  ratingGuess: {
    label: "Song-Bewertung einschätzen",
    supportsAllGuess: false,
    transportHtml() {
      return `<div class="row ratingTransportRow" style="justify-content:center;"><button id="ratingPlayStartBtn" class="big">⏮️ Von vorne</button><button id="ratingPlayResumeBtn" class="big">▶️ Weiter</button><button id="ratingStopBtn" class="big">⏸️ Stop</button></div>`;
    },
    bindTransport() {
      const t = FMQ.app.state.currentTrack;
      if (!t) return;
      FMQ.$("ratingPlayStartBtn").onclick = () => FMQ.socialPlaybackStart(t.uri, { fromStart: true, key: "rating" }).catch(() => {});
      FMQ.$("ratingPlayResumeBtn").onclick = () => FMQ.socialPlaybackStart(t.uri, { fromStart: false, key: "rating" }).catch(() => {});
      FMQ.$("ratingStopBtn").onclick = () => FMQ.socialPlaybackPause({ key: "rating" }).catch(() => {});
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
          bodyHtml: `${FMQ.modes.ratingGuess.transportHtml()}<div class="row" style="justify-content:center;"><button id="ratingListenNextBtn" class="big primary">Weiter</button></div>`
        });
        if (!FMQ.app.state.currentTrack) {
          FMQ.prepareTrackForTurn().then(() => FMQ.modes.ratingGuess.bindTransport()).catch(e => FMQ.setGameDebug(e.stack || e.message));
        } else {
          FMQ.modes.ratingGuess.bindTransport();
        }
        FMQ.$("ratingListenNextBtn").onclick = async () => {
          try { await FMQ.socialPlaybackPause({ key: "rating" }); } catch {}
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
          bodyHtml: `<div class="socialTurnLabel">${FMQ.escapeHtml(responder)} ist dran</div>${FMQ.modes.ratingGuess.transportHtml()}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingNextBtn" class="big primary" disabled>Weiter</button></div>`
        });
        FMQ.modes.ratingGuess.bindTransport();
        FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.answers.set(pid, parseInt(btn.getAttribute("data-rate"), 10));
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
          bodyHtml: `${FMQ.modes.ratingGuess.transportHtml()}<div class="choiceGrid">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button class="choiceBtn socialScaleBtn" data-main-rate="${v}">${v}</button>`).join("")}</div><div class="row" style="justify-content:center;"><button id="ratingRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.modes.ratingGuess.bindTransport();
        FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-rate]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.mainAnswer = parseInt(btn.getAttribute("data-main-rate"), 10);
          FMQ.$("ratingRevealBtn").disabled = false;
        });
        FMQ.$("ratingRevealBtn").onclick = async () => {
          try { await FMQ.socialPlaybackPause({ key: "rating" }); } catch {}
          const truth = Math.max(1, Math.min(10, parseInt(String(s.mainAnswer || "0"), 10)));
          const lines = [];
          for (const p of FMQ.activePlayers()) {
            if (p.id === s.mainPlayerId) continue;
            const val = parseInt(String(s.answers.get(p.id) || 0), 10);
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
  // SOCIAL MODUS 3: Kennenlernen Top 3
  // =========================================================
  icebreaker: {
    label: "Kennenlernen: Top 3",
    supportsAllGuess: false,
    async playClip(track, fromMiddle = false) {
      if (!track) return;
      const clipMs = 15000;
      const startMs = fromMiddle ? Math.max(0, Math.floor((track.durationMs || 0) / 2)) : 0;
      await FMQ.playTrackUri(track.uri, { positionMs: startMs });
      clearTimeout(FMQ.app.state.playTimer);
      FMQ.app.state.playTimer = setTimeout(() => {
        FMQ.pausePlayback().catch(() => {});
      }, clipMs);
    },
    renderArea() {
      FMQ.$("modeAreaTitle").textContent = "Kennenlernen: Top 3 Songs";
      const me = FMQ.currentPlayer();
      const top = (me?.tracks || []).slice(0, 3);
      const labels = ["Herausragend", "Gut", "Mittel"];
      FMQ.renderModeLikeQuick3({
        heading: `Diese Songs findet "${FMQ.escapeHtml(me?.name || "")}" gut`,
        subtitle: "Warm-up: kurze Hörprobe pro Spieler, dann weiter.",
        heroName: "",
        panelClass: "theme-playlist",
        bodyHtml: `<div>${top.map((t, i) => `<div class="abTransport"><span class="pill">${i + 1}) ${labels[i] || `Song ${i + 1}`}</span><button class="big" data-ice-play-start="${i}">▶️ Start 15 Sek.</button><button class="big" data-ice-play-mid="${i}">⏩ Mitte 15 Sek.</button></div>`).join("")}</div><div class="abTransport"><button id="iceStopBtn" class="big">⏸️ Stop</button></div><div class="muted" id="iceTrackInfo" style="text-align:center; margin-top:8px;">${top.length ? "Wähle pro Song: Start 15 Sek. oder Mitte 15 Sek." : "Zu wenig Songs in der Playlist."}</div><div class="row" style="justify-content:center; margin-top:10px;"><button id="iceNextBtn" class="big primary">Nächster Spieler</button></div>`
      });
      FMQ.$("modeArea").querySelectorAll("[data-ice-play-start]").forEach(btn => btn.onclick = () => {
        const idx = parseInt(btn.getAttribute("data-ice-play-start"), 10);
        const t = top[idx];
        if (!t) return;
        FMQ.modes.icebreaker.playClip(t, false).then(() => {
          FMQ.$("iceTrackInfo").textContent = `${labels[idx] || `Song ${idx + 1}`}: Start 15 Sek. · ${t.name} · ${t.artists.join(", ")}`;
        }).catch(e => FMQ.setGameDebug(e.stack || e.message));
      });
      FMQ.$("modeArea").querySelectorAll("[data-ice-play-mid]").forEach(btn => btn.onclick = () => {
        const idx = parseInt(btn.getAttribute("data-ice-play-mid"), 10);
        const t = top[idx];
        if (!t) return;
        FMQ.modes.icebreaker.playClip(t, true).then(() => {
          FMQ.$("iceTrackInfo").textContent = `${labels[idx] || `Song ${idx + 1}`}: Mitte 15 Sek. · ${t.name} · ${t.artists.join(", ")}`;
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
          bodyHtml: `${FMQ.modes.bestFit.transportHtml()}<div class="choiceGrid choiceGridBig"><button class="choiceBtn abChoiceBig" data-main-pick="A">Song A</button><button class="choiceBtn abChoiceBig" data-main-pick="B">Song B</button></div><div class="row" style="justify-content:center;"><button id="bfRevealBtn" class="big primary" disabled>Reveal</button></div>`
        });
        FMQ.modes.bestFit.bindTransport(trackA, trackB);
        FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(btn => btn.onclick = () => {
          FMQ.$("modeArea").querySelectorAll("[data-main-pick]").forEach(x => x.classList.remove("selected"));
          btn.classList.add("selected");
          s.mainAnswer = btn.getAttribute("data-main-pick");
          FMQ.$("bfRevealBtn").disabled = false;
        });
        FMQ.$("bfRevealBtn").onclick = () => {
          const truth = s.mainAnswer || "A";
          const lines = [];
          for (const p of FMQ.activePlayers()) {
            if (p.id === s.mainPlayerId) continue;
            const guessed = s.answers.get(p.id);
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

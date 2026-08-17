/* =========================================================
   Family Music Quiz · Handy-Client
   ---------------------------------------------------------
   Bewusst geändert gegenüber v1:

   1. Kein pointerup/touchend/click-Dreifachbinding mehr.
      Ein normaler click-Handler reicht; touch-action:manipulation
      in der CSS nimmt die 300ms-Verzögerung. Die alte Konstruktion
      hat echte zweite Taps innerhalb von 450ms verschluckt und
      auf iOS Geisterklicks erzeugt.

   2. Nach dem Absenden liegt 700ms lang ein unsichtbarer Schild
      über der Seite. Damit landet der iOS-Nachzügler-Klick nicht
      mehr auf dem Element, das nach dem Neuzeichnen an derselben
      Stelle sitzt. Genau so wurde man vorher "pausiert".

   3. Der Pause-Schalter liegt jetzt im Menü, nicht direkt unter
      den Antwortbuttons.

   4. Rejoin läuft über ein Token im localStorage statt über
      exakte Namensgleichheit.
   ========================================================= */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const store = {
    get(key, fallback = "") { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
    del(key) { try { localStorage.removeItem(key); } catch {} }
  };

  const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 });

  const state = {
    player: null,
    playerToken: store.get("fmq_player_token") || null,
    roomCode: (new URLSearchParams(location.search).get("room") || store.get("fmq_room_code") || "").toLowerCase(),
    prompt: null,
    answeredPromptId: null,
    submittingPromptId: null,
    controllerId: null,
    controllerActions: [],
    controlSelections: {},
    hostOnline: true
  };

  // -------------------------------------------------------
  // Tap-Schutz
  // -------------------------------------------------------
  let shieldTimer = null;
  const shieldTaps = (ms = 700) => {
    const shield = $("tapShield");
    if (!shield) return;
    shield.hidden = false;
    clearTimeout(shieldTimer);
    shieldTimer = setTimeout(() => { shield.hidden = true; }, ms);
  };

  // -------------------------------------------------------
  // Statusanzeigen
  // -------------------------------------------------------
  const setStatus = text => { const el = $("playerStatus"); if (el) el.textContent = text; };

  const setConn = (stateName, text) => {
    const bar = $("connBar");
    const label = $("connBarText");
    if (!bar || !label) return;
    bar.dataset.state = stateName;
    label.textContent = text;
  };

  const haptic = (pattern = 12) => { try { navigator.vibrate?.(pattern); } catch {} };

  // -------------------------------------------------------
  // Ansichten
  // -------------------------------------------------------
  const showJoinView = (message = "Name eingeben und beitreten.") => {
    document.body.classList.remove("joined");
    state.player = null;
    state.prompt = null;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    state.controllerId = null;
    state.controllerActions = [];
    $("joinForm").hidden = false;
    $("playerStatus").hidden = false;
    $("joinedView").hidden = true;
    $("controlPanel").hidden = true;
    $("controlPanel").innerHTML = "";
    $("joinedName").textContent = "";
    $("promptPanel").innerHTML = "";
    closeMenu();
    setStatus(message);
  };

  const showJoinedView = () => {
    document.body.classList.add("joined");
    $("joinForm").hidden = true;
    $("playerStatus").hidden = true;
    $("joinedView").hidden = false;
    $("joinedName").textContent = state.player?.name || "";
  };

  // -------------------------------------------------------
  // Menü
  // -------------------------------------------------------
  const openMenu = () => {
    $("playerMenu").hidden = false;
    $("menuToggleBtn").setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-open");
  };
  const closeMenu = () => {
    const menu = $("playerMenu");
    if (menu) menu.hidden = true;
    $("menuToggleBtn")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  };

  // -------------------------------------------------------
  // Prompt-Bausteine
  // -------------------------------------------------------
  const isRecipient = prompt => {
    if (!state.player || !prompt) return false;
    if (prompt.recipientIds?.length) return prompt.recipientIds.includes(state.player.id);
    if (prompt.excludedPlayerIds?.length) return !prompt.excludedPlayerIds.includes(state.player.id);
    return true;
  };

  const findTrack = (tracks, trackId) => tracks.find(t => t.id === trackId) || null;

  const trackButtonHtml = (track, selectedId) => `
    <button type="button" class="songPickBtn ${track.id === selectedId ? "selected" : ""}"
            data-track-id="${escapeHtml(track.id)}" aria-pressed="${track.id === selectedId}">
      <b>${escapeHtml(track.name)}</b>
      <span>${escapeHtml(track.artistName || "")}${track.year ? ` · ${escapeHtml(track.year)}` : ""}</span>
    </button>`;

  const visibleTracks = (tracks, query = "") => {
    const q = query.trim().toLowerCase();
    return tracks.filter(t => !q || `${t.name} ${t.artistName || ""}`.toLowerCase().includes(q)).slice(0, q ? 80 : 120);
  };

  /** Ein einziger, ehrlicher Klick-Handler. */
  const onTap = (target, handler) => {
    if (!target) return;
    target.addEventListener("click", event => {
      if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      handler(event, target);
    });
  };

  const onTapWithin = (container, selector, handler) => {
    if (!container) return;
    container.addEventListener("click", event => {
      const target = event.target.closest?.(selector);
      if (!target || !container.contains(target) || target.disabled) return;
      event.preventDefault();
      handler(event, target);
    });
  };

  // -------------------------------------------------------
  // Prompt-Typ: ein Song aus der eigenen Playlist
  // -------------------------------------------------------
  const renderSongSelectPrompt = (panel, prompt) => {
    const tracks = (prompt.tracksByPlayer?.[state.player.id] || []).slice(0, 300);
    let selectedTrackId = null;

    const update = () => {
      const btn = panel.querySelector("#songSubmitBtn");
      const track = findTrack(tracks, selectedTrackId);
      if (btn) {
        btn.disabled = !selectedTrackId || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
        btn.textContent = track ? "Diesen Song abschicken" : "Erst Song wählen";
      }
      const label = panel.querySelector("#songSelectedLabel");
      if (label) label.innerHTML = track
        ? `<b>Gewählt:</b> ${escapeHtml(track.name)} · ${escapeHtml(track.artistName || "")}`
        : "Noch nichts gewählt.";
      panel.querySelectorAll("[data-track-id]").forEach(b => {
        const on = b.getAttribute("data-track-id") === selectedTrackId;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-pressed", String(on));
      });
    };

    const renderList = (query = "") => {
      const list = panel.querySelector("#songSelectList");
      if (!list) return;
      const filtered = visibleTracks(tracks, query);
      list.innerHTML = filtered.map(t => trackButtonHtml(t, selectedTrackId)).join("")
        || `<p class="muted">Nichts gefunden. Kürzer suchen oder nach der Band suchen.</p>`;
      update();
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card">
        <div class="songSelectHeader">
          <p class="eyebrow">Song-Geschichten</p>
          <h2>${escapeHtml(prompt.title || "Wähle einen Song")}</h2>
          <p class="prompt-text">${escapeHtml(prompt.text || "Such dir einen Song aus deiner Playlist aus.")}</p>
          <label class="visually-hidden" for="songSearchInput">Song oder Band suchen</label>
          <input id="songSearchInput" class="songSearchInput" type="search" placeholder="Song oder Band suchen …"
                 autocomplete="off" autocorrect="off" enterkeyhint="search">
          <p class="muted">${tracks.length} Songs in deiner Playlist</p>
        </div>
        <div id="songSelectList" class="songSelectList" role="group" aria-label="Songauswahl"></div>
        <div class="songSubmitBar">
          <span id="songSelectedLabel" class="muted">Noch nichts gewählt.</span>
          <button id="songSubmitBtn" type="button" class="action-button primary" disabled>Erst Song wählen</button>
        </div>
      </div>`;

    onTapWithin(panel.querySelector("#songSelectList"), "[data-track-id]", (_e, btn) => {
      selectedTrackId = btn.getAttribute("data-track-id");
      haptic();
      update();
    });

    const input = panel.querySelector("#songSearchInput");
    input.addEventListener("input", () => renderList(input.value));

    onTap(panel.querySelector("#songSubmitBtn"), () => {
      const track = findTrack(tracks, selectedTrackId);
      if (!track || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id) return;
      submitAnswer(track);
    });

    renderList("");
  };

  // -------------------------------------------------------
  // Prompt-Typ: mehrere Duell-Songs
  // -------------------------------------------------------
  const renderMultiSongSelectPrompt = (panel, prompt) => {
    const tracks = (prompt.tracksByPlayer?.[state.player.id] || []).slice(0, 300);
    const assignments = (prompt.assignmentsByPlayer?.[state.player.id] || []).slice(0, 4);
    const selections = Object.fromEntries(assignments.map(a => [a.duelId, null]));
    let activeIndex = 0;

    const active = () => assignments[Math.max(0, Math.min(assignments.length - 1, activeIndex))];
    const allSelected = () => assignments.length > 0 && assignments.every(a => selections[a.duelId]);

    const update = () => {
      const submit = panel.querySelector("#multiSongSubmitBtn");
      if (submit) submit.disabled = !allSelected() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
      panel.querySelectorAll("[data-duel-tab]").forEach((btn, idx) => {
        const a = assignments[idx];
        btn.classList.toggle("selected", idx === activeIndex);
        btn.classList.toggle("ok", !!selections[a?.duelId]);
        btn.setAttribute("aria-selected", String(idx === activeIndex));
      });
      const done = assignments.filter(a => selections[a.duelId]).length;
      const label = panel.querySelector("#multiSongSelectedLabel");
      if (label) label.textContent = `${done} von ${assignments.length} Prompts fertig`;
      const cur = active();
      panel.querySelectorAll("[data-track-id]").forEach(b => {
        const on = !!cur && b.getAttribute("data-track-id") === selections[cur.duelId];
        b.classList.toggle("selected", on);
        b.setAttribute("aria-pressed", String(on));
      });
    };

    const renderList = (query = "") => {
      const assignment = active();
      const title = panel.querySelector("#multiSongPromptTitle");
      if (title) title.textContent = assignment ? assignment.promptText : "Keine Prompts";
      const list = panel.querySelector("#multiSongSelectList");
      if (!list || !assignment) return;
      list.innerHTML = visibleTracks(tracks, query).map(t => trackButtonHtml(t, selections[assignment.duelId])).join("")
        || `<p class="muted">Nichts gefunden. Kürzer suchen oder nach der Band suchen.</p>`;
      update();
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card multi-song-select-card">
        <div class="songSelectHeader">
          <p class="eyebrow">Song-Duell</p>
          <h2>${escapeHtml(prompt.title || "Wähle deine Songs")}</h2>
          <p class="prompt-text">${escapeHtml(prompt.text || "Für jeden Prompt einen Song, dann zusammen abschicken.")}</p>
          <div class="duelPromptTabs" role="tablist" aria-label="Deine Prompts">
            ${assignments.map((a, i) => `<button type="button" role="tab" class="songPromptTab" data-duel-tab="${i}" aria-selected="false">Prompt ${i + 1}</button>`).join("")}
          </div>
          <p id="multiSongPromptTitle" class="prompt-text phonePromptText"></p>
          <label class="visually-hidden" for="multiSongSearchInput">Song oder Band suchen</label>
          <input id="multiSongSearchInput" class="songSearchInput" type="search" placeholder="Song oder Band suchen …" autocomplete="off">
        </div>
        <div id="multiSongSelectList" class="songSelectList" role="group" aria-label="Songauswahl"></div>
        <div class="songSubmitBar">
          <span id="multiSongSelectedLabel" class="muted"></span>
          <button id="multiSongSubmitBtn" type="button" class="action-button primary" disabled>Beide abschicken</button>
        </div>
      </div>`;

    panel.querySelectorAll("[data-duel-tab]").forEach(btn => onTap(btn, () => {
      activeIndex = parseInt(btn.getAttribute("data-duel-tab") || "0", 10) || 0;
      const input = panel.querySelector("#multiSongSearchInput");
      if (input) input.value = "";
      renderList("");
    }));

    onTapWithin(panel.querySelector("#multiSongSelectList"), "[data-track-id]", (_e, btn) => {
      const assignment = active();
      if (!assignment) return;
      selections[assignment.duelId] = btn.getAttribute("data-track-id");
      haptic();
      update();
    });

    const input = panel.querySelector("#multiSongSearchInput");
    input.addEventListener("input", () => renderList(input.value));

    onTap(panel.querySelector("#multiSongSubmitBtn"), () => {
      if (!allSelected() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id) return;
      const answer = {};
      assignments.forEach(a => { answer[a.duelId] = findTrack(tracks, selections[a.duelId]); });
      submitAnswer(answer);
    });

    renderList("");
  };

  // -------------------------------------------------------
  // Prompt-Typ: Duell-Voting
  // -------------------------------------------------------
  const renderMultiDuelVotePrompt = (panel, prompt) => {
    const duels = (prompt.voteDuelsByPlayer?.[state.player.id] || []).slice(0, 20);
    const votes = Object.fromEntries(duels.map(d => [d.duelId, null]));
    const allVoted = () => duels.length > 0 && duels.every(d => votes[d.duelId]);

    const update = () => {
      const submit = panel.querySelector("#duelVoteSubmitBtn");
      if (submit) submit.disabled = !allVoted() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
      const done = duels.filter(d => votes[d.duelId]).length;
      const label = panel.querySelector("#duelVoteSelectedLabel");
      if (label) label.textContent = `${done} von ${duels.length} abgestimmt`;
      panel.querySelectorAll("[data-duel-vote]").forEach(btn => {
        const on = votes[btn.getAttribute("data-duel-vote")] === btn.getAttribute("data-vote-choice");
        btn.classList.toggle("selected", on);
        btn.setAttribute("aria-pressed", String(on));
      });
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card multi-duel-vote-card">
        <div class="songSelectHeader">
          <p class="eyebrow">Abstimmung</p>
          <h2>${escapeHtml(prompt.title || "Stimme ab")}</h2>
          <p class="prompt-text">${escapeHtml(prompt.text || "Welcher Song passt besser?")}</p>
        </div>
        <div class="duelVoteList">
          ${duels.map((duel, i) => `
            <section class="duelVoteCard">
              <span class="pill">Duell ${i + 1}</span>
              <h3>${escapeHtml(duel.promptText || "Welcher Song passt besser?")}</h3>
              <div class="player-answer-grid">
                <button type="button" class="choiceBtn abChoiceBig" data-duel-vote="${escapeHtml(duel.duelId)}" data-vote-choice="A" aria-pressed="false">
                  <b>Song A</b><span>${escapeHtml(duel.songA?.name || "-")}<br>${escapeHtml(duel.songA?.artistName || "")}</span>
                </button>
                <button type="button" class="choiceBtn abChoiceBig" data-duel-vote="${escapeHtml(duel.duelId)}" data-vote-choice="B" aria-pressed="false">
                  <b>Song B</b><span>${escapeHtml(duel.songB?.name || "-")}<br>${escapeHtml(duel.songB?.artistName || "")}</span>
                </button>
              </div>
            </section>`).join("")
            || `<p class="player-wait-card">Über deine eigenen Prompts stimmen die anderen ab. Lehn dich zurück.</p>`}
        </div>
        ${duels.length ? `
        <div class="songSubmitBar">
          <span id="duelVoteSelectedLabel" class="muted"></span>
          <button id="duelVoteSubmitBtn" type="button" class="action-button primary" disabled>Abstimmung abschicken</button>
        </div>` : ""}
      </div>`;

    panel.querySelectorAll("[data-duel-vote]").forEach(btn => onTap(btn, () => {
      votes[btn.getAttribute("data-duel-vote")] = btn.getAttribute("data-vote-choice");
      haptic();
      update();
    }));

    const submit = panel.querySelector("#duelVoteSubmitBtn");
    if (submit) onTap(submit, () => { if (allVoted()) submitAnswer(votes); });
    update();
  };

  // -------------------------------------------------------
  // Prompt-Typ: Auswahl mit Bestätigung
  // Zwei Schritte sind Absicht: erst wählen, dann abschicken.
  // Ein Fehltipper kostet so keine Runde mehr.
  // -------------------------------------------------------
  const renderChoicePrompt = (panel, prompt, options, { eyebrow = "Jetzt antworten" } = {}) => {
    let selected = null;
    const update = () => {
      panel.querySelectorAll("[data-answer]").forEach(btn => {
        const on = btn.getAttribute("data-answer") === selected;
        btn.classList.toggle("selected", on);
        btn.setAttribute("aria-pressed", String(on));
      });
      const send = panel.querySelector("#sendChoiceBtn");
      if (send) {
        send.disabled = !selected || state.submittingPromptId === prompt.id;
        const label = options.find(o => String(o.value) === selected)?.label;
        send.textContent = selected ? `„${label ?? selected}" abschicken` : "Erst auswählen";
      }
    };

    panel.innerHTML = `
      <div class="player-question-card player-focus-card">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(prompt.title || "Frage")}</h2>
        <p class="prompt-text">${escapeHtml(prompt.text || "Bitte wähle eine Antwort.")}</p>
        <div class="player-answer-grid ${options.length > 4 ? "compact" : ""}" role="group" aria-label="Antwortmöglichkeiten">
          ${options.map(o => `<button type="button" class="choiceBtn abChoiceBig" data-answer="${escapeHtml(o.value)}" aria-pressed="false">${escapeHtml(o.label ?? o.value)}</button>`).join("")}
        </div>
        <div class="answer-send-bar">
          <button id="sendChoiceBtn" type="button" class="action-button primary" disabled>Erst auswählen</button>
        </div>
      </div>`;

    panel.querySelectorAll("[data-answer]").forEach(btn => onTap(btn, () => {
      selected = btn.getAttribute("data-answer");
      haptic();
      update();
    }));
    onTap(panel.querySelector("#sendChoiceBtn"), () => { if (selected) submitAnswer(selected); });
    update();
  };

  // -------------------------------------------------------
  // Prompt-Typ: Selbst-Check
  // -------------------------------------------------------
  const renderChecksPrompt = (panel, prompt, options) => {
    panel.innerHTML = `
      <div class="player-question-card player-focus-card">
        <p class="eyebrow">Selbst-Check</p>
        <h2>${escapeHtml(prompt.title || "Was hattest du richtig?")}</h2>
        <p class="prompt-text">${escapeHtml(prompt.text || "Ehrlich sein lohnt sich mehr als gewinnen.")}</p>
        <div class="player-check-grid">
          ${options.map(o => `<label class="selfCheckItem"><input type="checkbox" data-check="${escapeHtml(o.value)}"> <span>${escapeHtml(o.label ?? o.value)}</span></label>`).join("")}
        </div>
        <div class="answer-send-bar">
          <button id="sendChecksBtn" type="button" class="action-button primary">Antwort abschicken</button>
        </div>
      </div>`;
    onTap(panel.querySelector("#sendChecksBtn"), () => {
      const answer = {};
      panel.querySelectorAll("[data-check]").forEach(inp => { answer[inp.getAttribute("data-check")] = inp.checked; });
      submitAnswer(answer);
    });
  };

  // -------------------------------------------------------
  // Prompt-Router
  // -------------------------------------------------------
  const renderPrompt = () => {
    const panel = $("promptPanel");
    const prompt = state.prompt;
    if (!panel) return;
    if (!state.player) { panel.innerHTML = ""; return; }

    if (!state.player.active) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">
        <p class="wait-emoji" aria-hidden="true">⏸</p>
        <h2>Du pausierst gerade</h2>
        <p class="muted">Über das Menü oben rechts kannst du wieder einsteigen.</p></div>`;
      return;
    }
    if (!state.hostOnline) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">
        <p class="wait-emoji" aria-hidden="true">📺</p>
        <h2>Der Host ist kurz weg</h2>
        <p class="muted">Der Raum bleibt offen. Sobald der große Bildschirm zurück ist, geht es weiter.</p></div>`;
      return;
    }
    if (!prompt) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">
        <p class="wait-emoji" aria-hidden="true">🎧</p>
        <h2>Warte auf die nächste Frage</h2>
        <p class="muted">Schau solange auf den großen Bildschirm.</p></div>`;
      return;
    }
    if (!isRecipient(prompt)) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">
        <p class="wait-emoji" aria-hidden="true">👀</p>
        <h2>Diesmal bist du nicht dran</h2>
        <p class="muted">${escapeHtml(prompt.waitingText || "Die anderen wählen gerade.")}</p></div>`;
      return;
    }
    if (state.answeredPromptId === prompt.id) {
      panel.innerHTML = `<div class="player-wait-card ok player-focus-card">
        <p class="wait-emoji" aria-hidden="true">✅</p>
        <h2>Antwort ist da</h2>
        <p class="muted">${escapeHtml(prompt.sentText || "Warte kurz auf die anderen.")}</p></div>`;
      return;
    }

    if (prompt.kind === "songSelect") return renderSongSelectPrompt(panel, prompt);
    if (prompt.kind === "multiSongSelect") return renderMultiSongSelectPrompt(panel, prompt);
    if (prompt.kind === "multiDuelVote") return renderMultiDuelVotePrompt(panel, prompt);

    const options = prompt.options?.length ? prompt.options : [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }];
    if (prompt.kind === "checks") return renderChecksPrompt(panel, prompt, options);
    return renderChoicePrompt(panel, prompt, options);
  };

  // -------------------------------------------------------
  // Antwort senden
  // -------------------------------------------------------
  const submitAnswer = answer => {
    if (!state.player || !state.prompt) return;
    const promptId = state.prompt.id;
    if (state.submittingPromptId === promptId || state.answeredPromptId === promptId) return;

    state.submittingPromptId = promptId;
    state.answeredPromptId = promptId;
    shieldTaps(700);   // <- verhindert den Fehltipper direkt nach dem Absenden
    haptic([14, 40, 14]);
    renderPrompt();
    renderController();

    socket.emit("player:submitAnswer", {
      roomCode: state.roomCode,
      playerId: state.player.id,
      promptId,
      answer
    }, res => {
      const stillCurrent = state.prompt?.id === promptId;
      if (!res?.ok) {
        if (stillCurrent) { state.answeredPromptId = null; state.submittingPromptId = null; }
        setConn("warn", res?.error || "Antwort kam nicht an. Nochmal versuchen.");
        setTimeout(() => setConn("online", "Verbunden"), 3000);
        renderPrompt();
        return;
      }
      if (stillCurrent) { state.submittingPromptId = null; state.answeredPromptId = promptId; }
      renderPrompt();
      renderController();
    });
  };

  // -------------------------------------------------------
  // Beitreten
  // -------------------------------------------------------
  const applyJoinResult = res => {
    state.player = res.player;
    state.roomCode = res.roomCode;
    state.playerToken = res.playerToken || state.playerToken;
    state.prompt = res.prompt || null;
    state.answeredPromptId = res.alreadyAnswered && res.prompt ? res.prompt.id : null;
    state.submittingPromptId = null;
    state.controllerId = res.controllerId || null;
    state.controllerActions = Array.isArray(res.controllerActions) ? res.controllerActions : [];
    state.hostOnline = res.hostOnline !== false;
    if (state.playerToken) store.set("fmq_player_token", state.playerToken);
    store.set("fmq_room_code", state.roomCode);
    store.set("fmq_player_name", state.player.name);
    $("roomCodeInput").value = state.roomCode;
    $("activeToggle").checked = state.player.active !== false;
    showJoinedView();
    setConn("online", `Drin als ${state.player.name}`);
    renderPrompt();
    renderController();
  };

  const joinRoom = ({ name, roomCode, silent = false }) => {
    if (!silent) setConn("connecting", "Trete bei …");
    socket.emit("player:join", { name, roomCode, playerToken: state.playerToken, active: $("activeToggle")?.checked !== false }, res => {
      if (!res?.ok) {
        if (res?.code === "WRONG_ROOM") store.del("fmq_room_code");
        showJoinView(res?.error || "Beitritt hat nicht geklappt.");
        setConn("warn", res?.error || "Beitritt hat nicht geklappt.");
        return;
      }
      applyJoinResult(res);
    });
  };

  $("joinForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("playerNameInput").value.trim().replace(/\s+/g, " ");
    const roomCode = ($("roomCodeInput").value || state.roomCode).trim().toLowerCase();
    $("roomCodeInput").value = roomCode;
    if (!name) { setStatus("Bitte zuerst einen Namen eingeben."); $("playerNameInput").focus(); return; }
    joinRoom({ name, roomCode });
  });

  // -------------------------------------------------------
  // Fernsteuerung
  // -------------------------------------------------------
  const rememberControlSelection = action => {
    if (!action) return;
    if (String(action).startsWith("select:")) {
      const [, id, ...rest] = String(action).split(":");
      state.controlSelections[id] = rest.join(":");
      return;
    }
    state.controlSelections.__lastButton = action;
  };

  const sendControlAction = action => {
    if (!action || !state.player) return;
    rememberControlSelection(action);
    haptic();
    renderController();
    socket.emit("player:controlAction", { playerId: state.player.id, action }, res => {
      if (!res?.ok) {
        setConn("warn", res?.error || "Steuerung gerade nicht verfügbar.");
        setTimeout(() => setConn("online", "Verbunden"), 2500);
      }
    });
  };

  const renderController = () => {
    const panel = $("controlPanel");
    if (!panel || !state.player) return;
    const canControl = state.controllerId && state.controllerId === state.player.id;
    const actions = canControl ? (state.controllerActions || []) : [];
    panel.hidden = !canControl || actions.length === 0;
    if (panel.hidden) { panel.innerHTML = ""; return; }

    panel.innerHTML = `<p class="eyebrow control-eyebrow">Du steuerst gerade die Musik</p>` + actions.map(action => {
      const options = Array.isArray(action.options) ? action.options : [];
      if (options.length) {
        const selectedValue = state.controlSelections[String(action.id).replace(/^selectGroup:/, "")];
        return `<div class="phoneControlGroup">
          <span class="phoneControlLabel">${escapeHtml(action.label)}</span>
          <div class="phoneControlOptions">${options.map(opt => {
            const optValue = String(opt.id).split(":").slice(2).join(":");
            const selected = selectedValue && selectedValue === optValue;
            return `<button type="button" class="action-button secondary ${selected ? "selected" : ""}" data-control="${escapeHtml(opt.id)}" aria-pressed="${!!selected}">${escapeHtml(opt.label)}</button>`;
          }).join("")}</div></div>`;
      }
      const selected = state.controlSelections.__lastButton === action.id;
      return `<button type="button" class="action-button primary ${selected ? "selected" : ""}" data-control="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`;
    }).join("");

    panel.querySelectorAll("[data-control]").forEach(btn => onTap(btn, () => sendControlAction(btn.getAttribute("data-control"))));
  };

  // -------------------------------------------------------
  // Menü-Schalter
  // -------------------------------------------------------
  onTap($("menuToggleBtn"), () => ($("playerMenu").hidden ? openMenu() : closeMenu()));
  onTap($("menuCloseBtn"), closeMenu);
  onTap($("leaveRoomBtn"), () => {
    store.del("fmq_player_token");
    state.playerToken = null;
    socket.disconnect();
    showJoinView("Du hast den Raum verlassen. Jederzeit wieder beitreten.");
    setConn("offline", "Nicht verbunden");
    setTimeout(() => socket.connect(), 200);
  });

  $("activeToggle").addEventListener("change", () => {
    if (!state.player) return;
    const active = $("activeToggle").checked;
    socket.emit("player:setActive", { playerId: state.player.id, active }, res => {
      if (!res?.ok) {
        // Schalter zurückdrehen, sonst zeigt das Handy einen Zustand,
        // den der Server gar nicht kennt.
        $("activeToggle").checked = !active;
        setConn("warn", res?.error || "Umschalten hat nicht geklappt.");
        return;
      }
      // Fällt das Spielerobjekt in der Antwort weg, behalten wir das
      // bisherige. Ohne diese Absicherung wäre state.player undefined
      // und die Frageansicht bliebe leer.
      state.player = res.player || { ...state.player, active };
      setConn("online", active ? "Du spielst mit" : "Du pausierst");
      renderPrompt();
    });
  });

  const applyPref = (key, cls, input) => {
    const on = store.get(key) === "1";
    input.checked = on;
    document.body.classList.toggle(cls, on);
    input.addEventListener("change", () => {
      document.body.classList.toggle(cls, input.checked);
      store.set(key, input.checked ? "1" : "0");
    });
  };
  applyPref("fmq_big_text", "big-text", $("bigTextToggle"));
  applyPref("fmq_calm", "calm-motion", $("calmToggle"));

  // -------------------------------------------------------
  // Socket-Ereignisse
  // -------------------------------------------------------
  socket.on("connect", () => {
    const savedName = store.get("fmq_player_name");
    if (state.player) { joinRoom({ name: state.player.name, roomCode: state.roomCode, silent: true }); return; }
    if (state.playerToken && savedName && state.roomCode) { joinRoom({ name: savedName, roomCode: state.roomCode, silent: true }); return; }
    setConn("online", "Verbunden");
    setStatus("Name eingeben und beitreten.");
  });

  socket.on("connect_error", () => setConn("offline", "Kein Kontakt zum Server. Gleiches WLAN?"));
  socket.on("disconnect", () => setConn("offline", "Verbindung weg. Ich versuche es weiter …"));

  socket.on("room:state", snapshot => {
    state.controllerId = snapshot.controllerId || null;
    state.controllerActions = Array.isArray(snapshot.controllerActions) ? snapshot.controllerActions : [];
    if (typeof snapshot.hostOnline === "boolean") state.hostOnline = snapshot.hostOnline;
    if (!state.player) {
      if (snapshot?.roomCode && !$("roomCodeInput").value) $("roomCodeInput").value = snapshot.roomCode;
      return;
    }
    if (snapshot.open === false) { showJoinView("Der Host hat die Sitzung beendet."); return; }
    const updated = snapshot.players?.find(p => p.id === state.player.id);
    if (updated) {
      state.player = updated;
      $("activeToggle").checked = state.player.active !== false;
    }
    renderPrompt();
    renderController();
  });

  socket.on("player:prompt", prompt => {
    state.prompt = prompt;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    // Wenn eine Frage ankommt, ist der Host offensichtlich wieder da.
    // Ohne das bliebe die Wartekarte stehen und niemand könnte antworten.
    state.hostOnline = true;
    haptic([10, 60, 10]);
    renderPrompt();
    renderController();
  });

  socket.on("player:reveal", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    renderPrompt();
    renderController();
  });

  socket.on("player:resetRound", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    renderPrompt();
    renderController();
  });

  socket.on("player:hostAway", () => {
    state.hostOnline = false;
    setConn("warn", "Host kurz weg. Der Raum bleibt offen.");
    renderPrompt();
  });

  socket.on("player:hostBack", () => {
    state.hostOnline = true;
    setConn("online", "Host ist wieder da");
    renderPrompt();
  });

  socket.on("player:roomClosed", payload => {
    showJoinView(payload?.error || "Raum geschlossen.");
    setConn("warn", payload?.error || "Raum geschlossen.");
  });

  // -------------------------------------------------------
  // Startzustand
  // -------------------------------------------------------
  $("roomCodeInput").value = state.roomCode;
  const savedName = store.get("fmq_player_name");
  if (savedName) $("playerNameInput").value = savedName;
  setConn("connecting", "Verbinde …");
})();

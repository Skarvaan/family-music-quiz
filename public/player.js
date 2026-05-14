(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const socket = io();
  const state = {
    player: null,
    roomCode: new URLSearchParams(window.location.search).get("room") || "",
    prompt: null,
    answeredPromptId: null,
    controllerId: null,
    controllerActions: [],
    submittingPromptId: null
  };

  $("roomCodeInput").value = state.roomCode;
  try {
    const savedName = localStorage.getItem("fmq_player_name") || "";
    if (savedName) $("playerNameInput").value = savedName;
  } catch {}

  const setStatus = text => { $("playerStatus").textContent = text; };

  const showJoinView = (message = "Raumcode und Namen eingeben.") => {
    document.body.classList.remove("joined");
    state.player = null;
    state.prompt = null;
    state.answeredPromptId = null;
    state.controllerId = null;
    state.controllerActions = [];
    state.submittingPromptId = null;
    $("joinForm").hidden = false;
    $("playerStatus").hidden = false;
    $("joinedView").hidden = true;
    $("controlPanel").hidden = true;
    $("controlPanel").innerHTML = "";
    $("joinedName").textContent = "";
    $("promptPanel").innerHTML = "";
    setStatus(message);
  };

  const showJoinedView = () => {
    document.body.classList.add("joined");
    $("joinForm").hidden = true;
    $("playerStatus").hidden = true;
    $("joinedView").hidden = false;
    $("joinedName").textContent = state.player?.name || "";
  };

  const isRecipient = prompt => {
    if (!state.player || !prompt) return false;
    if (prompt.recipientIds?.length) return prompt.recipientIds.includes(state.player.id);
    if (prompt.excludedPlayerIds?.length) return !prompt.excludedPlayerIds.includes(state.player.id);
    return true;
  };

  const findTrack = (tracks, trackId) => tracks.find(t => t.id === trackId) || null;
  const trackButtonHtml = (track, selectedId) => `
    <button type="button" class="songPickBtn ${track.id === selectedId ? "selected" : ""}" data-track-id="${escapeHtml(track.id)}">
      <b>${escapeHtml(track.name)}</b><span>${escapeHtml(track.artistName || "")}${track.year ? ` · ${escapeHtml(track.year)}` : ""}</span>
    </button>
  `;

  const renderSongSelectPrompt = (panel, prompt) => {
    const tracks = (prompt.tracksByPlayer?.[state.player.id] || []).slice(0, 300);
    let selectedTrackId = null;

    const updateSubmit = () => {
      const btn = panel.querySelector("#songSubmitBtn");
      if (btn) btn.disabled = !selectedTrackId || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
      const label = panel.querySelector("#songSelectedLabel");
      const track = findTrack(tracks, selectedTrackId);
      if (label) label.innerHTML = track ? `<b>Ausgewählt:</b> ${escapeHtml(track.name)} · ${escapeHtml(track.artistName || "")}` : "Erst Song auswählen, dann abschicken.";
      panel.querySelectorAll("[data-track-id]").forEach(btn => btn.classList.toggle("selected", btn.getAttribute("data-track-id") === selectedTrackId));
    };

    const renderList = (query = "") => {
      const q = query.trim().toLowerCase();
      const filtered = tracks.filter(t => !q || `${t.name} ${t.artistName || ""}`.toLowerCase().includes(q));
      const list = panel.querySelector("#songSelectList");
      if (!list) return;
      list.innerHTML = filtered.map(t => trackButtonHtml(t, selectedTrackId)).join("") || `<div class="muted">Keine Treffer. Suche kürzer oder nach Artist.</div>`;
      updateSubmit();
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card">
        <div class="songSelectHeader">
          <div class="eyebrow">Song-Challenge</div>
          <h2>${escapeHtml(prompt.title || "Wähle einen Song")}</h2>
          <p>${escapeHtml(prompt.text || "Suche in deiner Playlist und wähle genau einen Song aus.")}</p>
          <input id="songSearchInput" class="songSearchInput" placeholder="Song oder Artist suchen …" autocomplete="off">
          <div class="muted">${tracks.length} Songs geladen · max. 300</div>
        </div>
        <div id="songSelectList" class="songSelectList"></div>
        <div class="songSubmitBar">
          <span id="songSelectedLabel" class="muted">Erst Song auswählen, dann abschicken.</span>
          <button id="songSubmitBtn" type="button" class="action-button primary" disabled>Abschicken</button>
        </div>
      </div>
    `;
    const list = panel.querySelector("#songSelectList");
    list.addEventListener("click", event => {
      const btn = event.target.closest?.("[data-track-id]");
      if (!btn) return;
      event.preventDefault();
      selectedTrackId = btn.getAttribute("data-track-id");
      updateSubmit();
    });
    const input = panel.querySelector("#songSearchInput");
    input.oninput = () => renderList(input.value);
    panel.querySelector("#songSubmitBtn").onclick = () => {
      const track = findTrack(tracks, selectedTrackId);
      if (!track || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id) return;
      state.submittingPromptId = prompt.id;
      panel.querySelector("#songSubmitBtn").disabled = true;
      submitAnswer(track);
    };
    renderList("");
  };

  const renderMultiSongSelectPrompt = (panel, prompt) => {
    const tracks = (prompt.tracksByPlayer?.[state.player.id] || []).slice(0, 300);
    const assignments = (prompt.assignmentsByPlayer?.[state.player.id] || []).slice(0, 4);
    const selections = Object.fromEntries(assignments.map(a => [a.duelId, null]));
    let activeIndex = 0;

    const activeAssignment = () => assignments[Math.max(0, Math.min(assignments.length - 1, activeIndex))];
    const allSelected = () => assignments.length > 0 && assignments.every(a => selections[a.duelId]);

    const updateSubmit = () => {
      const submit = panel.querySelector("#multiSongSubmitBtn");
      if (submit) submit.disabled = !allSelected() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
      panel.querySelectorAll("[data-duel-tab]").forEach((btn, idx) => {
        const assignment = assignments[idx];
        btn.classList.toggle("selected", idx === activeIndex);
        btn.classList.toggle("ok", !!selections[assignment.duelId]);
      });
      const label = panel.querySelector("#multiSongSelectedLabel");
      const done = assignments.filter(a => selections[a.duelId]).length;
      if (label) label.textContent = `${done}/${assignments.length} Prompts ausgewählt. Erst danach abschicken.`;
      const current = activeAssignment();
      panel.querySelectorAll("[data-track-id]").forEach(btn => btn.classList.toggle("selected", current && btn.getAttribute("data-track-id") === selections[current.duelId]));
    };

    const renderActiveList = (query = "") => {
      const assignment = activeAssignment();
      const q = query.trim().toLowerCase();
      const filtered = tracks.filter(t => !q || `${t.name} ${t.artistName || ""}`.toLowerCase().includes(q));
      const title = panel.querySelector("#multiSongPromptTitle");
      if (title) title.textContent = assignment ? assignment.promptText : "Keine Prompts";
      const list = panel.querySelector("#multiSongSelectList");
      if (!list || !assignment) return;
      list.innerHTML = filtered.map(t => trackButtonHtml(t, selections[assignment.duelId])).join("") || `<div class="muted">Keine Treffer. Suche kürzer oder nach Artist.</div>`;
      updateSubmit();
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card multi-song-select-card">
        <div class="songSelectHeader">
          <div class="eyebrow">Song-Duell</div>
          <h2>${escapeHtml(prompt.title || "Wähle deine Songs")}</h2>
          <p>${escapeHtml(prompt.text || "Wähle für jeden Prompt einen Song aus. Du kannst zwischen den Prompts wechseln und am Ende alles abschicken.")}</p>
          <div class="duelPromptTabs">
            ${assignments.map((a, idx) => `<button type="button" class="songPromptTab" data-duel-tab="${idx}">Prompt ${idx + 1}</button>`).join("")}
          </div>
          <div id="multiSongPromptTitle" class="phonePromptText"></div>
          <input id="multiSongSearchInput" class="songSearchInput" placeholder="Song oder Artist suchen …" autocomplete="off">
        </div>
        <div id="multiSongSelectList" class="songSelectList"></div>
        <div class="songSubmitBar">
          <span id="multiSongSelectedLabel" class="muted"></span>
          <button id="multiSongSubmitBtn" type="button" class="action-button primary" disabled>Abschicken</button>
        </div>
      </div>
    `;
    panel.querySelectorAll("[data-duel-tab]").forEach(btn => btn.onclick = () => {
      activeIndex = parseInt(btn.getAttribute("data-duel-tab") || "0", 10) || 0;
      const input = panel.querySelector("#multiSongSearchInput");
      if (input) input.value = "";
      renderActiveList("");
    });
    panel.querySelector("#multiSongSelectList").addEventListener("click", event => {
      const btn = event.target.closest?.("[data-track-id]");
      const assignment = activeAssignment();
      if (!btn || !assignment) return;
      event.preventDefault();
      selections[assignment.duelId] = btn.getAttribute("data-track-id");
      updateSubmit();
    });
    const input = panel.querySelector("#multiSongSearchInput");
    input.oninput = () => renderActiveList(input.value);
    panel.querySelector("#multiSongSubmitBtn").onclick = () => {
      if (!allSelected() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id) return;
      state.submittingPromptId = prompt.id;
      const answer = {};
      assignments.forEach(a => { answer[a.duelId] = findTrack(tracks, selections[a.duelId]); });
      panel.querySelector("#multiSongSubmitBtn").disabled = true;
      submitAnswer(answer);
    };
    renderActiveList("");
  };

  const renderMultiDuelVotePrompt = (panel, prompt) => {
    const duels = (prompt.voteDuelsByPlayer?.[state.player.id] || []).slice(0, 20);
    const votes = Object.fromEntries(duels.map(d => [d.duelId, null]));
    const allVoted = () => duels.length > 0 && duels.every(d => votes[d.duelId]);
    const updateSubmit = () => {
      const submit = panel.querySelector("#duelVoteSubmitBtn");
      if (submit) submit.disabled = !allVoted() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id;
      const done = duels.filter(d => votes[d.duelId]).length;
      const label = panel.querySelector("#duelVoteSelectedLabel");
      if (label) label.textContent = `${done}/${duels.length} Duelle abgestimmt. Danach abschicken.`;
      panel.querySelectorAll("[data-duel-vote]").forEach(btn => {
        const duelId = btn.getAttribute("data-duel-vote");
        btn.classList.toggle("selected", votes[duelId] === btn.getAttribute("data-vote-choice"));
      });
    };

    panel.innerHTML = `
      <div class="player-question-card song-select-card multi-duel-vote-card">
        <div class="songSelectHeader">
          <div class="eyebrow">Song-Duell Voting</div>
          <h2>${escapeHtml(prompt.title || "Stimme ab")}</h2>
          <p>${escapeHtml(prompt.text || "Wähle pro Duell, welcher Song besser zum Prompt passt.")}</p>
        </div>
        <div class="duelVoteList">
          ${duels.map((duel, idx) => `
            <section class="duelVoteCard">
              <div class="pill">Duell ${idx + 1}</div>
              <h3>${escapeHtml(duel.promptText || "Welcher Song passt besser?")}</h3>
              <div class="player-answer-grid">
                <button type="button" class="choiceBtn abChoiceBig" data-duel-vote="${escapeHtml(duel.duelId)}" data-vote-choice="A"><b>Song A</b><span>${escapeHtml(duel.songA?.name || "-")}<br>${escapeHtml(duel.songA?.artistName || "")}</span></button>
                <button type="button" class="choiceBtn abChoiceBig" data-duel-vote="${escapeHtml(duel.duelId)}" data-vote-choice="B"><b>Song B</b><span>${escapeHtml(duel.songB?.name || "-")}<br>${escapeHtml(duel.songB?.artistName || "")}</span></button>
              </div>
            </section>
          `).join("") || `<div class="player-wait-card">Warte bitte: Über deine eigenen Prompts stimmen die anderen ab.</div>`}
        </div>
        ${duels.length ? `<div class="songSubmitBar"><span id="duelVoteSelectedLabel" class="muted"></span><button id="duelVoteSubmitBtn" type="button" class="action-button primary" disabled>Abschicken</button></div>` : ""}
      </div>
    `;
    panel.querySelectorAll("[data-duel-vote]").forEach(btn => btn.onclick = () => {
      votes[btn.getAttribute("data-duel-vote")] = btn.getAttribute("data-vote-choice");
      updateSubmit();
    });
    const submit = panel.querySelector("#duelVoteSubmitBtn");
    if (submit) submit.onclick = () => {
      if (!allVoted() || state.answeredPromptId === prompt.id || state.submittingPromptId === prompt.id) return;
      state.submittingPromptId = prompt.id;
      submit.disabled = true;
      submitAnswer(votes);
    };
    updateSubmit();
  };

  const renderPrompt = () => {
    const panel = $("promptPanel");
    const prompt = state.prompt;
    if (!state.player) {
      panel.innerHTML = "";
      return;
    }
    if (!state.player.active) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">Du bist pausiert.</div>`;
      return;
    }
    if (!prompt) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">Warte auf Auswahl …</div>`;
      return;
    }
    if (!isRecipient(prompt)) {
      panel.innerHTML = `<div class="player-wait-card player-focus-card">${escapeHtml(prompt.waitingText || "Warte auf die Auswahl aller anderen Personen!")}</div>`;
      return;
    }
    if (state.answeredPromptId === prompt.id) {
      panel.innerHTML = `<div class="player-wait-card ok player-focus-card">${escapeHtml(prompt.sentText || "Antwort gesendet. Bitte warten …")}</div>`;
      return;
    }

    if (prompt.kind === "songSelect") {
      renderSongSelectPrompt(panel, prompt);
      return;
    }
    if (prompt.kind === "multiSongSelect") {
      renderMultiSongSelectPrompt(panel, prompt);
      return;
    }
    if (prompt.kind === "multiDuelVote") {
      renderMultiDuelVotePrompt(panel, prompt);
      return;
    }

    const options = prompt.options?.length ? prompt.options : [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }];
    const inputHtml = prompt.kind === "checks"
      ? `<div class="player-check-grid">${options.map(opt => `<label class="selfCheckItem"><input type="checkbox" data-check="${escapeHtml(opt.value)}"> ${escapeHtml(opt.label || opt.value)}</label>`).join("")}</div><button id="sendChecksBtn" class="choiceBtn abChoiceBig">Antwort senden</button>`
      : `<div class="player-answer-grid">${options.map(opt => `<button class="choiceBtn abChoiceBig" data-answer="${escapeHtml(opt.value)}">${escapeHtml(opt.label || opt.value)}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="player-question-card player-focus-card">
        <div class="eyebrow">Jetzt antworten</div>
        <h2>${escapeHtml(prompt.title || "Frage")}</h2>
        <p>${escapeHtml(prompt.text || "Bitte wähle eine Antwort.")}</p>
        ${inputHtml}
      </div>
    `;
    panel.querySelectorAll("[data-answer]").forEach(btn => btn.onclick = () => submitAnswer(btn.getAttribute("data-answer")));
    if ($("sendChecksBtn")) $("sendChecksBtn").onclick = () => {
      const answer = {};
      panel.querySelectorAll("[data-check]").forEach(inp => { answer[inp.getAttribute("data-check")] = inp.checked; });
      submitAnswer(answer);
    };
  };

  const submitAnswer = answer => {
    if (!state.player || !state.prompt) return;
    const promptId = state.prompt.id;
    state.submittingPromptId = promptId;
    state.answeredPromptId = promptId;
    setStatus("Antwort gesendet.");
    renderPrompt();
    renderController();
    socket.emit("player:submitAnswer", {
      roomCode: state.roomCode,
      playerId: state.player.id,
      promptId,
      answer
    }, res => {
      if (!res?.ok) {
        if (state.prompt?.id === promptId) {
          state.answeredPromptId = null;
          state.submittingPromptId = null;
        }
        setStatus(res?.error || "Antwort konnte nicht gesendet werden.");
        renderPrompt();
        return;
      }
      if (state.prompt?.id === promptId) {
        state.submittingPromptId = null;
        state.answeredPromptId = promptId;
      }
      setStatus("Antwort gesendet.");
      renderPrompt();
      renderController();
    });
  };

  $("joinForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("playerNameInput").value.trim().replace(/\s+/g, " ");
    const roomCode = ($("roomCodeInput").value || state.roomCode).trim().toLowerCase();
    $("roomCodeInput").value = roomCode;
    if (!name) return;
    try { localStorage.setItem("fmq_player_name", name); } catch {}
    setStatus("Verbinde …");
    socket.emit("player:join", { name, roomCode }, res => {
      if (!res?.ok) {
        setStatus(res?.error || "Beitritt fehlgeschlagen.");
        return;
      }
      state.player = res.player;
      state.roomCode = res.roomCode;
      state.prompt = res.prompt || null;
      state.controllerId = res.controllerId || null;
      state.controllerActions = Array.isArray(res.controllerActions) ? res.controllerActions : [];
      state.answeredPromptId = null;
      $("roomCodeInput").value = state.roomCode;
      showJoinedView();
      $("activeToggle").checked = state.player.active !== false;
      setStatus(`Du bist drin: ${state.player.name}`);
      renderPrompt();
      renderController();
    });
  });

  $("activeToggle").addEventListener("change", () => {
    if (!state.player) return;
    const active = $("activeToggle").checked;
    socket.emit("player:setActive", { playerId: state.player.id, active }, res => {
      if (res?.ok) {
        state.player = res.player;
        setStatus(active ? "Aktiv." : "Pausiert.");
        renderPrompt();
      }
    });
  });

  const sendControlAction = (action) => {
    if (!action || !state.player) return;
    socket.emit("player:controlAction", { playerId: state.player.id, action }, res => {
      if (!res?.ok) {
        setStatus(res?.error || "Steuerung gerade nicht verfügbar.");
        return;
      }
      setStatus("Steuerung gesendet.");
    });
  };

  const renderController = () => {
    const panel = $("controlPanel");
    if (!panel || !state.player) return;
    const canControl = state.controllerId && state.controllerId === state.player.id;
    const actions = canControl ? (state.controllerActions || []) : [];
    panel.hidden = !canControl || actions.length === 0;
    panel.innerHTML = actions.map(action => {
      const options = Array.isArray(action.options) ? action.options : [];
      if (options.length) {
        return `<div class="phoneControlGroup"><button type="button" class="action-button primary phoneControlMain" disabled>${escapeHtml(action.label)}</button><div class="phoneControlOptions">${options.map(opt => `<button type="button" class="action-button secondary" data-control="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</button>`).join("")}</div></div>`;
      }
      return `<button type="button" class="action-button primary" data-control="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`;
    }).join("");
    panel.querySelectorAll("[data-control]").forEach(btn => btn.addEventListener("click", event => {
      event.preventDefault();
      sendControlAction(btn.getAttribute("data-control"));
    }));
  };

  socket.on("connect", () => setStatus(state.player ? `Du bist drin: ${state.player.name}` : "Raumcode und Namen eingeben."));
  socket.on("disconnect", () => setStatus("Verbindung getrennt. Versuche automatisch neu zu verbinden …"));
  socket.on("room:state", snapshot => {
    if (!state.player) {
      if (snapshot?.roomCode && !$("roomCodeInput").value) $("roomCodeInput").value = snapshot.roomCode;
      return;
    }
    state.controllerId = snapshot.controllerId || null;
    state.controllerActions = Array.isArray(snapshot.controllerActions) ? snapshot.controllerActions : [];
    if (snapshot.open === false) {
      showJoinView("Der Raum ist geschlossen. Bitte warten, bis der Host Mehrgeräte-Modus aktiviert.");
      return;
    }
    const updated = snapshot.players?.find(p => p.id === state.player.id);
    if (updated) {
      state.player = updated;
      $("activeToggle").checked = state.player.active !== false;
    }
    if (!state.prompt || state.answeredPromptId === state.prompt.id) renderPrompt();
    renderController();
  });
  socket.on("player:prompt", prompt => {
    state.prompt = prompt;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    setStatus("Neue Frage erhalten.");
    renderPrompt();
    renderController();
  });
  socket.on("player:reveal", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    setStatus("Reveal läuft am Host.");
    renderPrompt();
    renderController();
  });
  socket.on("player:roomClosed", payload => {
    showJoinView(payload?.error || "Raum geschlossen.");
  });
  socket.on("player:resetRound", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    state.submittingPromptId = null;
    setStatus("Neue Runde wird vorbereitet.");
    renderPrompt();
    renderController();
  });
})();

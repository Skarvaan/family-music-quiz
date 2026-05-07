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
    controllerActions: []
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
    socket.emit("player:submitAnswer", {
      roomCode: state.roomCode,
      playerId: state.player.id,
      promptId: state.prompt.id,
      answer
    }, res => {
      if (!res?.ok) {
        setStatus(res?.error || "Antwort konnte nicht gesendet werden.");
        return;
      }
      state.answeredPromptId = state.prompt.id;
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

  const renderController = () => {
    const panel = $("controlPanel");
    if (!panel || !state.player) return;
    const canControl = state.controllerId && state.controllerId === state.player.id;
    const actions = canControl ? (state.controllerActions || []) : [];
    panel.hidden = !canControl || actions.length === 0;
    panel.innerHTML = actions.map(action => `<button class="action-button primary" data-control="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`).join("");
    panel.querySelectorAll("[data-control]").forEach(btn => btn.onclick = () => socket.emit("player:controlAction", { playerId: state.player.id, action: btn.getAttribute("data-control") }, res => {
      if (!res?.ok) setStatus(res?.error || "Steuerung gerade nicht verfügbar.");
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
    renderPrompt();
    renderController();
  });
  socket.on("player:prompt", prompt => {
    state.prompt = prompt;
    state.answeredPromptId = null;
    setStatus("Neue Frage erhalten.");
    renderPrompt();
    renderController();
  });
  socket.on("player:reveal", () => {
    state.prompt = null;
    state.answeredPromptId = null;
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
    setStatus("Neue Runde wird vorbereitet.");
    renderPrompt();
    renderController();
  });
})();

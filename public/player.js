(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const socket = io();
  const state = {
    player: null,
    roomCode: new URLSearchParams(window.location.search).get("room") || "",
    prompt: null,
    answeredPromptId: null
  };

  $("roomCodeInput").value = state.roomCode;
  try {
    const savedName = localStorage.getItem("fmq_player_name") || "";
    if (savedName) $("playerNameInput").value = savedName;
  } catch {}

  const setStatus = text => { $("playerStatus").textContent = text; };

  const showJoinedView = () => {
    $("joinForm").hidden = true;
    $("activePanel").hidden = false;
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
      panel.innerHTML = `<div class="player-wait-card">Du bist pausiert und blockierst die Runde nicht.</div>`;
      return;
    }
    if (!prompt) {
      panel.innerHTML = `<div class="player-wait-card"><b>${escapeHtml(state.player.name)}</b><br>Warte auf Auswahl …</div>`;
      return;
    }
    if (!isRecipient(prompt)) {
      panel.innerHTML = `<div class="player-wait-card">Diese Eingabe ist gerade nicht für dich. Bitte warten …</div>`;
      return;
    }
    if (state.answeredPromptId === prompt.id) {
      panel.innerHTML = `<div class="player-wait-card ok">Antwort gesendet. Warte auf Reveal …</div>`;
      return;
    }

    const options = prompt.options?.length ? prompt.options : [{ value: "A", label: "Song A" }, { value: "B", label: "Song B" }];
    panel.innerHTML = `
      <div class="player-question-card">
        <div class="eyebrow">Aktuelle Frage</div>
        <h2>${escapeHtml(prompt.title || "Frage")}</h2>
        <p>${escapeHtml(prompt.text || "Bitte wähle eine Antwort.")}</p>
        <div class="player-answer-grid">
          ${options.map(opt => `<button class="choiceBtn abChoiceBig" data-answer="${escapeHtml(opt.value)}">${escapeHtml(opt.label || opt.value)}</button>`).join("")}
        </div>
      </div>
    `;
    panel.querySelectorAll("[data-answer]").forEach(btn => btn.onclick = () => submitAnswer(btn.getAttribute("data-answer")));
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
      state.answeredPromptId = null;
      $("roomCodeInput").value = state.roomCode;
      showJoinedView();
      $("activeToggle").checked = state.player.active !== false;
      setStatus(`Du bist drin: ${state.player.name}`);
      renderPrompt();
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

  socket.on("connect", () => setStatus(state.player ? `Du bist drin: ${state.player.name}` : "Raumcode und Namen eingeben."));
  socket.on("disconnect", () => setStatus("Verbindung getrennt. Versuche automatisch neu zu verbinden …"));
  socket.on("room:state", snapshot => {
    if (!state.player) {
      if (snapshot?.roomCode && !$("roomCodeInput").value) $("roomCodeInput").value = snapshot.roomCode;
      return;
    }
    const updated = snapshot.players?.find(p => p.id === state.player.id);
    if (updated) {
      state.player = updated;
      $("activeToggle").checked = state.player.active !== false;
    }
  });
  socket.on("player:prompt", prompt => {
    state.prompt = prompt;
    state.answeredPromptId = null;
    setStatus("Neue Frage erhalten.");
    renderPrompt();
  });
  socket.on("player:reveal", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    setStatus("Reveal läuft am Host.");
    renderPrompt();
  });
  socket.on("player:resetRound", () => {
    state.prompt = null;
    state.answeredPromptId = null;
    setStatus("Neue Runde wird vorbereitet.");
    renderPrompt();
  });
})();

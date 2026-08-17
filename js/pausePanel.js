window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Pausieren und Wiedereinsteigen einzelner Mitspielender. */

FMQ.renderPlayerSwitchPanel = () => {
  const panel = FMQ.$("playerSwitchPanel");
  if (!panel) return;
  const mode = FMQ.app.state.pauseApplyMode || "next";
  panel.innerHTML = `
    <div class="playerSwitchMode">
      <label for="pauseApplyModeSelect"><b>Pause anwenden</b></label>
      <select id="pauseApplyModeSelect">
        <option value="next" ${mode === "next" ? "selected" : ""}>Bei Weiter / nächstem Einsatz</option>
        <option value="round" ${mode === "round" ? "selected" : ""}>Erst am Rundenende</option>
        <option value="game" ${mode === "game" ? "selected" : ""}>Erst nach Spielende</option>
      </select>
    </div>
    ${FMQ.app.players.map(p => {
      const checked = (typeof p.pendingActive === "boolean" ? p.pendingActive : p.active !== false);
      const pending = typeof p.pendingActive === "boolean" && p.pendingActive !== (p.active !== false);
      return `
        <label class="playerSwitchRow ${pending ? "pending" : ""}">
          <span>${FMQ.escapeHtml(p.name)}${pending ? ` <small>(vorgemerkt)</small>` : ""}</span>
          <input type="checkbox" data-role="active-switch" data-pid="${p.id}" ${checked ? "checked" : ""}>
        </label>
      `;
    }).join("")}
  `;
  const modeSelect = FMQ.$("pauseApplyModeSelect");
  if (modeSelect) modeSelect.onchange = () => { FMQ.app.state.pauseApplyMode = modeSelect.value; FMQ.renderPlayerSwitchPanel(); };
  panel.querySelectorAll('input[data-role="active-switch"]').forEach(inp => inp.onchange = () => {
    const pid = inp.getAttribute("data-pid");
    const p = FMQ.app.players.find(x => x.id === pid);
    if (!p) return;
    p.pendingActive = !!inp.checked;
    const desiredActiveCount = FMQ.app.players.filter(x => (typeof x.pendingActive === "boolean" ? x.pendingActive : x.active !== false)).length;
    if (!desiredActiveCount) {
      p.pendingActive = true;
      inp.checked = true;
      return;
    }
    FMQ.renderPlayerSwitchPanel();
  });
};

FMQ.applyPendingPlayerActivity = ({ roundEnd = false, gameEnd = false } = {}) => {
  const mode = FMQ.app.state.pauseApplyMode || "next";
  if (mode === "round" && !roundEnd && !gameEnd) return false;
  if (mode === "game" && !gameEnd) return false;
  const pending = FMQ.app.players.filter(p => typeof p.pendingActive === "boolean");
  if (!pending.length) return false;
  const nextActiveCount = FMQ.app.players.filter(p => typeof p.pendingActive === "boolean" ? p.pendingActive : p.active !== false).length;
  if (!nextActiveCount) return false;
  let changed = false;
  pending.forEach(p => {
    if ((p.active !== false) !== p.pendingActive) changed = true;
    p.active = p.pendingActive;
    p.pendingActive = undefined;
  });
  if (changed && FMQ.app.state.social?.respondingPlayersQueue) {
    const activeIds = new Set(FMQ.activePlayers().map(p => p.id));
    while (FMQ.app.state.social.respondingPlayersQueue[FMQ.app.state.social.currentResponderIndex]
      && !activeIds.has(FMQ.app.state.social.respondingPlayersQueue[FMQ.app.state.social.currentResponderIndex])) {
      FMQ.app.state.social.currentResponderIndex++;
    }
  }
  FMQ.ensureActiveTurnIndex();
  FMQ.renderPlayerSwitchPanel();
  return changed;
};

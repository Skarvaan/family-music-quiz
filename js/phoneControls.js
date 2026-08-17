window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Fernsteuerung: welche Knöpfe des Hosts auf einem Handy erscheinen. */

FMQ.setMultiplayerControllerActions = (actions = []) => {
  const normalized = actions
    .filter(action => action && action.id && action.label)
    .slice(0, 18)
    .map(action => ({
      id: String(action.id),
      label: String(action.label),
      options: Array.isArray(action.options)
        ? action.options.filter(option => option && option.id && option.label).slice(0, 4).map(option => ({ id: String(option.id), label: String(option.label) }))
        : []
    }));
  FMQ.multiplayer.controllerActions = normalized;
  if (FMQ.isMultiDevice() && FMQ.multiplayer.socket) {
    FMQ.multiplayer.socket.emit("host:setControllerActions", { actions: normalized });
  }
};

FMQ.collectVisibleHostControls = (root = document) => {
  if (!FMQ.isMultiDevice?.()) return [];
  const preferredIds = [
    "quick3PlayBtnInline", "quick3StopBtnInline", "revealBtnInline", "ratingPlayResumeBtn", "ratingStopBtn", "ratingListenNextBtn", "ratingToMainBtn", "ratingRevealBtn",
    "playAFromStartBtn", "playBFromStartBtn", "bestFitStopBtn", "bestFitContinueBtn", "bestFitNewSongsBtn", "bfToMainBtn", "bfRevealBtn",
    "introGuessPlayBtn", "introGuessStopBtn", "introGuessRevealBtn", "introGuessNextBtn",
    "challengePlayBtn", "challengeStopBtn", "challengeNextBtn", "duelPlayABtn", "duelPlayBBtn", "duelStopBtn", "duelResolveCurrentBtn", "duelNextPromptBtn",
    "iceStopBtn", "iceNextBtn", "socialDoneBtn", "nextBtn", "setupContinueBtn"
  ];
  const selectIds = [
    "quick3LenSelectInline", "quick3StartModeSelectInline", "ratingStartModeSelect", "bestFitClipSecondsSelect", "bestFitStartModeSelect",
    "introGuessLenSelect", "introGuessStartModeSelect", "first3StartModeSelect", "challengeStartModeSelect", "duelStartModeSelect"
  ];
  const actions = [];
  const visible = (el) => {
    if (!el || el.disabled || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const labelForOption = (option) => (option.textContent || option.label || option.value || "Option").replace(/\s+/g, " ").trim();
  for (const id of selectIds) {
    const el = FMQ.$(id);
    if (!visible(el)) continue;
    const label = id.includes("Len") || id.includes("Clip") ? "Hörzeit" : "Startpunkt";
    actions.push({ id: `selectGroup:${id}`, label, options: [...el.options].map(opt => ({ id: `select:${id}:${opt.value}`, label: labelForOption(opt) })) });
  }
  const first3Buttons = [...root.querySelectorAll?.("[data-first3-play]") || []].filter(visible);
  if (first3Buttons.length) {
    [0, 1, 2].forEach(idx => {
      const songButtons = first3Buttons.filter(btn => parseInt(btn.getAttribute("data-first3-play"), 10) === idx);
      if (!songButtons.length) return;
      actions.push({
        id: `first3Song${idx}`,
        label: `Song ${idx + 1}`,
        options: songButtons.map(btn => ({ id: btn.id, label: (btn.getAttribute("data-seconds") === "full" ? "Ganzer Song" : `${btn.getAttribute("data-seconds")} Sek.`) }))
      });
    });
  }
  for (const id of preferredIds) {
    const el = FMQ.$(id);
    if (!visible(el)) continue;
    if (actions.some(action => action.id === id || action.options?.some(option => option.id === id))) continue;
    const label = (el.textContent || "Weiter").replace(/\s+/g, " ").trim();
    if (label) actions.push({ id, label });
  }
  return actions.slice(0, 18);
};

FMQ.refreshPhoneControls = () => {
  if (!FMQ.isMultiDevice?.()) return;
  window.clearTimeout(FMQ.multiplayer.controlRefreshTimer);
  FMQ.multiplayer.controlRefreshTimer = window.setTimeout(() => {
    FMQ.setMultiplayerControllerActions?.(FMQ.collectVisibleHostControls());
  }, 0);
};

FMQ.setMultiplayerController = (playerId) => {
  const nextControllerId = FMQ.toRemotePlayerId(playerId);
  const changed = (FMQ.multiplayer.controllerId || null) !== (nextControllerId || null);
  FMQ.multiplayer.controllerId = nextControllerId || null;
  if (changed && FMQ.multiplayer.socket) FMQ.multiplayer.socket.emit("host:setController", { playerId: FMQ.multiplayer.controllerId });
  FMQ.refreshPhoneControls?.();
  FMQ.renderMultiplayerPanel?.();
  FMQ.renderDeviceModePanel?.();
};

FMQ.ensureMultiplayerController = (playerId) => {
  const nextControllerId = FMQ.toRemotePlayerId(playerId);
  if ((FMQ.multiplayer.controllerId || null) === (nextControllerId || null)) {
    FMQ.refreshPhoneControls?.();
    return;
  }
  FMQ.setMultiplayerController(nextControllerId);
};

FMQ.handleRemoteControlAction = (action) => {
  if (!FMQ.isMultiDevice()) return;
  if (typeof action === "string" && action.startsWith("select:")) {
    const [, id, ...rest] = action.split(":");
    const el = FMQ.$(id);
    if (el) {
      el.value = rest.join(":");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(() => FMQ.refreshPhoneControls?.(), 0);
    }
    return;
  }
  const el = action ? FMQ.$(action) : null;
  if (el && el.offsetParent !== null && !el.disabled) {
    el.click();
    setTimeout(() => FMQ.refreshPhoneControls?.(), 0);
    return;
  }
  const clickFirst = (ids) => {
    for (const id of ids) {
      const btn = FMQ.$(id);
      if (btn && btn.offsetParent !== null && !btn.disabled) {
        btn.click();
        setTimeout(() => FMQ.refreshPhoneControls?.(), 0);
        return true;
      }
    }
    return false;
  };
  if (action === "reveal") clickFirst(["bfRevealBtn", "introGuessRevealBtn", "revealBtnInline", "revealBtn"]);
  if (action === "newTrack") clickFirst(["newTrackBtn", "bestFitNewSongsBtn"]);
  if (action === "next") clickFirst(["bestFitContinueBtn", "ratingListenNextBtn", "bfToMainBtn", "rankingNextBtn", "socialDoneBtn", "introGuessNextBtn", "iceNextBtn", "nextBtn"]);
};

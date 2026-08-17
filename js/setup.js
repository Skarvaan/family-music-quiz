window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Setup-Assistent: Kategorie, Modus, Vorbereitung und Spielstart. */

FMQ.syncSetupForMode = () => {
  const selectedMode = FMQ.$("modeSelect")?.value || FMQ.app.config.mode;
  const hideEndControls = FMQ.app.config.category === "intro" || selectedMode === "rankingList" || selectedMode === "storyPrompt";
  if (selectedMode === "rankingList") {
    const size = FMQ.app.config.rankingSize || parseInt(FMQ.$("rankingSizeSetupSelect")?.value || "5", 10) || 5;
    FMQ.app.config.endType = "rounds";
    FMQ.app.config.targetRounds = size;
    if (FMQ.$("endTypeSelect")) FMQ.$("endTypeSelect").value = "rounds";
    if (FMQ.$("targetRoundsInput")) FMQ.$("targetRoundsInput").value = String(size);
  }
  if (selectedMode === "promptDuel") {
    FMQ.app.config.endType = "rounds";
    if (FMQ.$("endTypeSelect")) FMQ.$("endTypeSelect").value = "rounds";
    if (FMQ.$("targetPointsInput")) FMQ.$("targetPointsInput").style.display = "none";
    if (FMQ.$("targetRoundsInput")) FMQ.$("targetRoundsInput").style.display = "";
    if (FMQ.$("targetLabelText")) FMQ.$("targetLabelText").textContent = "Runden";
  }
  if (FMQ.$("endTypeRow")) FMQ.$("endTypeRow").style.display = (hideEndControls || selectedMode === "promptDuel") ? "none" : "";
  if (FMQ.$("endTargetRow")) FMQ.$("endTargetRow").style.display = hideEndControls ? "none" : "";
};

// =========================================================
// TURN-VORBEREITUNG / ZIEHLOGIK
// =========================================================

FMQ.renderPlayStyleButtons = () => {
  document.querySelectorAll("[data-category]").forEach(btn => {
    const isChallenge = btn.getAttribute("data-category") === "challenge";
    btn.hidden = isChallenge && !FMQ.isMultiDevice?.();
    btn.disabled = isChallenge && !FMQ.isMultiDevice?.();
    btn.classList.toggle("active", btn.getAttribute("data-category") === FMQ.app.config.category);
  });
};

FMQ.selectSetupCategory = (category) => {
  if (!category) return;
  if (category === "challenge" && !FMQ.isMultiDevice?.()) return;
  FMQ.app.config.category = category;
  FMQ.app.config.party = "rotate";
  if (FMQ.$("partySelect")) FMQ.$("partySelect").value = "rotate";
  FMQ.app.state.setupStep = 3;
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.renderSetupWizard();
};

FMQ.selectSetupMode = (modeId) => {
  if (!modeId) return;
  FMQ.$("modeSelect").value = modeId;
  FMQ.app.config.mode = modeId;
  FMQ.renderModeHints();
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.app.state.setupStep = 4;
  FMQ.renderSetupWizard();
};

// Ein einziger delegierter click-Handler für die Setup-Karten.
// Vorher lief das über pointerdown im Capture-Modus plus ein globales
// 450-ms-Klickfenster, das ALLE Klicks der Seite unterdrückt hat.
// Auf Touch-Geräten hat das echte Taps verschluckt und Karten wirkten
// tot oder reagierten doppelt.

// Ein einziger delegierter click-Handler für die Setup-Karten.
// Vorher lief das über pointerdown im Capture-Modus plus ein globales
// 450-ms-Klickfenster, das ALLE Klicks der Seite unterdrückt hat.
// Auf Touch-Geräten hat das echte Taps verschluckt und Karten wirkten
// tot oder reagierten doppelt.
FMQ.handleSetupNavigation = (event) => {
  if (!FMQ.$("screenSetup")?.classList.contains("active")) return;
  const target = event.target.closest?.("#singleDeviceModeBtn,#multiDeviceModeBtn,[data-category],[data-mode-id]");
  if (!target || target.disabled) return;

  if (target.id === "singleDeviceModeBtn") {
    FMQ.setDeviceMode?.("single");
    FMQ.showMultiDeviceHint?.("Ein-Gerät-Modus aktiv.");
    return;
  }
  if (target.id === "multiDeviceModeBtn") {
    FMQ.enableMultiDeviceMode?.().catch(e => FMQ.showMultiDeviceHint?.(e.message));
    return;
  }
  if (target.hasAttribute("data-category")) {
    FMQ.selectSetupCategory(target.getAttribute("data-category"));
    return;
  }
  if (target.hasAttribute("data-mode-id")) {
    FMQ.selectSetupMode(target.getAttribute("data-mode-id"));
  }
};

FMQ.renderModeButtons = () => {
  const modeMeta = [
    { id: "quick3", label: "Song erraten", category: FMQ.MODE_INFO.quick3.category },
    { id: "rankingList", label: FMQ.MODE_INFO.rankingList.label, category: FMQ.MODE_INFO.rankingList.category },
    { id: "ratingGuess", label: "Bewertung 1–10", category: FMQ.MODE_INFO.ratingGuess.category },
    { id: "bestFit", label: FMQ.MODE_INFO.bestFit.label, category: FMQ.MODE_INFO.bestFit.category },
    { id: "introPlaylistGuess", label: "Aus welcher Playlist?", category: FMQ.MODE_INFO.introPlaylistGuess.category },
    { id: "introFirst3", label: FMQ.MODE_INFO.introFirst3.label, category: FMQ.MODE_INFO.introFirst3.category },
    { id: "storyPrompt", label: FMQ.MODE_INFO.storyPrompt.label, category: FMQ.MODE_INFO.storyPrompt.category },
    { id: "promptDuel", label: FMQ.MODE_INFO.promptDuel.label, category: FMQ.MODE_INFO.promptDuel.category }
  ];
  const allowed = modeMeta.filter(m => m.category === FMQ.app.config.category && (!["storyPrompt", "promptDuel"].includes(m.id) || FMQ.isMultiDevice?.()));
  if (!allowed.some(m => m.id === FMQ.$("modeSelect").value)) {
    FMQ.$("modeSelect").value = allowed[0]?.id || "quick3";
    FMQ.app.config.mode = FMQ.$("modeSelect").value;
    FMQ.renderModeHints();
  }
  // Kein eigenes onclick pro Karte: der delegierte Handler auf
  // #screenSetup übernimmt das. Sonst feuert jede Auswahl doppelt.
  FMQ.$("modeButtons").innerHTML = allowed.map(m => `<button type="button" class="menu-card modeBtn ${m.id===FMQ.app.config.mode?"active":""}" data-mode-id="${m.id}" aria-pressed="${m.id===FMQ.app.config.mode}"><span class="card-title">${FMQ.escapeHtml(m.label)}</span><span class="card-subtitle">${FMQ.escapeHtml(FMQ.MODE_INFO[m.id]?.hint || "")}</span></button>`).join("");
};

FMQ.setupCanProceed = () => {
  const step = FMQ.app.state.setupStep || 1;
  if (step === 1) return true;
  if (step === 2) return !!FMQ.app.config.category;
  if (step === 3) return !!FMQ.$("modeSelect").value;
  if (step === 4) {
    const playlistSelects = [...document.querySelectorAll('select[data-role="playlist"]')];
    const uiHasAllPlaylists = playlistSelects.length > 0 && playlistSelects.every(sel => !!sel.value);
    const modelReady = FMQ.app.players.length > 0 && FMQ.app.players.some(FMQ.playerHasMusic) && FMQ.app.players.every(p => p.spectator === true || (p.playlistId && (p.tracks?.length || 0) >= 5 && p.spanMin && p.spanMax));
    const uiReady = playlistSelects.every(sel => {
      const player = FMQ.app.players.find(p => p.id === sel.dataset.pid);
      return player?.spectator === true || !!sel.value;
    });
    return uiReady && modelReady;
  }
  return true;
};

FMQ.renderSetupWizard = () => {
  const step = FMQ.app.state.setupStep || 1;
  document.querySelectorAll(".setupStep").forEach(el => {
    el.classList.toggle("active", parseInt(el.getAttribute("data-setup-step"), 10) === step);
  });

  const nav = FMQ.$("setupNav");
  const continueBtn = FMQ.$("setupContinueBtn");
  const backBtn = FMQ.$("setupBackBtn");
  if (nav) nav.style.display = step <= 1 ? "none" : "grid";
  if (backBtn) backBtn.disabled = step <= 1;
  if (continueBtn) {
    continueBtn.textContent = step === 4 ? "Spiel starten" : "Weiter →";
    continueBtn.disabled = !FMQ.setupCanProceed();
    continueBtn.style.visibility = step === 2 || step === 3 ? "hidden" : "visible";
  }

  const loginBtn = FMQ.$("loginBtn");
  if (loginBtn) {
    const spotifyState = FMQ.app.state.spotifyConnectionState;
    loginBtn.textContent = spotifyState === "connected"
      ? "Spotify verbunden"
      : spotifyState === "checking"
        ? "Spotify prüfen…"
        : "Spotify verbinden";
  }
  const startBtn = FMQ.$("setupNextBtn");
  if (startBtn) startBtn.textContent = FMQ.isMultiDevice?.() ? "Weiter zur Modusauswahl" : "Ein-Gerät-Modus starten";

  if (step === 4 && FMQ.storage.token && !FMQ.app.playlists.length && !FMQ.app.loadingPlaylists) {
    FMQ.app.loadingPlaylists = true;
    FMQ.loadMyPlaylists().catch(() => {}).finally(() => { FMQ.app.loadingPlaylists = false; });
  }

  if (step === 1 && !FMQ.storage.token) {
    FMQ.$("setupStepHint").textContent = "Spotify verbinden, damit im Setup Playlists geladen werden können.";
  } else if (step === 4 && !FMQ.setupCanProceed()) {
    FMQ.$("setupStepHint").textContent = "Bitte für jeden Spieler eine Playlist mit mindestens 5 Tracks laden.";
  } else {
    FMQ.$("setupStepHint").textContent = "";
  }
  FMQ.renderPlayStyleButtons();
  FMQ.renderModeButtons();
  FMQ.syncSetupForMode();
  FMQ.renderDeviceModePanel?.();
  FMQ.renderMultiplayerPanel?.();
  FMQ.applyAccessibilityLabels();
  FMQ.refreshPhoneControls?.();
};

FMQ.goToSetupStep = (step) => {
  FMQ.app.state.setupStep = Math.max(1, Math.min(4, step));
  try {
    FMQ.renderSetupWizard();
  } catch (e) {
    document.querySelectorAll(".setupStep").forEach(el => {
      el.classList.toggle("active", parseInt(el.getAttribute("data-setup-step"), 10) === FMQ.app.state.setupStep);
    });
    const nav = FMQ.$("setupNav");
    if (nav) nav.style.display = FMQ.app.state.setupStep <= 1 ? "none" : "grid";
    if (FMQ.$("setupContinueBtn")) FMQ.$("setupContinueBtn").style.visibility = FMQ.app.state.setupStep === 4 ? "visible" : "hidden";
    FMQ.setDebug(e.stack || e.message);
  }
};

// =========================================================
// KONFIGURATION
// ---------------------------------------------------------
// Bisher las startGame() die Einstellungen direkt aus den
// Formularfeldern. Wer die Konfiguration programmatisch setzte,
// wurde beim Start stillschweigend überschrieben. Jetzt gibt es
// drei klar getrennte Schritte: Formular lesen, Regeln anwenden,
// Konfiguration zurück ins Formular spiegeln.
// =========================================================

/** Formular -> Konfiguration. Einzige Stelle, die DOM-Werte einliest. */
FMQ.readSetupForm = () => {
  const c = FMQ.app.config;
  const zahl = (id, fallback) => {
    const wert = parseInt(FMQ.$(id)?.value ?? "", 10);
    return Number.isFinite(wert) ? Math.max(1, wert) : fallback;
  };
  if (FMQ.$("modeSelect")) c.mode = FMQ.$("modeSelect").value;
  if (FMQ.$("partySelect")) c.party = FMQ.$("partySelect").value;
  if (FMQ.$("endTypeSelect")) c.endType = FMQ.$("endTypeSelect").value;
  c.targetPoints = zahl("targetPointsInput", c.targetPoints);
  c.targetRounds = zahl("targetRoundsInput", c.targetRounds);
  if (FMQ.$("rankingSizeSetupSelect")) c.rankingSize = zahl("rankingSizeSetupSelect", c.rankingSize);
  if (FMQ.$("ratingScoringSelect")) c.ratingScoring = FMQ.$("ratingScoringSelect").value;
  if (FMQ.$("promptToneSelect")) c.promptTone = FMQ.$("promptToneSelect").value;
  return c;
};

/** Konfiguration -> Formular, damit beides nie auseinanderläuft. */
FMQ.writeSetupForm = () => {
  const c = FMQ.app.config;
  const setzen = (id, wert) => { const el = FMQ.$(id); if (el && el.value !== String(wert)) el.value = String(wert); };
  setzen("modeSelect", c.mode);
  setzen("partySelect", c.party);
  setzen("endTypeSelect", c.endType);
  setzen("targetPointsInput", c.targetPoints);
  setzen("targetRoundsInput", c.targetRounds);
  setzen("rankingSizeSetupSelect", c.rankingSize);
  setzen("promptToneSelect", c.promptTone);
};

/**
 * Wendet die festen Modusregeln an. Manche Modi bestimmen ihr
 * Spielende selbst, unabhängig davon, was im Formular steht.
 */
FMQ.normalizeConfig = () => {
  const c = FMQ.app.config;
  if (c.category === "intro") {
    c.endType = "rounds";
    c.targetRounds = 1;
  }
  if (c.mode === "rankingList") {
    c.endType = "rounds";
    c.targetRounds = c.rankingSize || 5;
  }
  if (c.mode === "storyPrompt") {
    c.endType = "rounds";
    c.targetRounds = 1;
    c.songChallengeType = c.mode;
  }
  if (c.mode === "promptDuel") {
    c.endType = "rounds";
    c.songChallengeType = c.mode;
  }
  c.targetRounds = Math.max(1, c.targetRounds || 1);
  c.targetPoints = Math.max(1, c.targetPoints || 15);
  return c;
};

/**
 * Startet das Spiel.
 * @param {boolean} fromForm  Formularwerte übernehmen. Tests setzen
 *                            die Konfiguration direkt und geben false an.
 */
FMQ.startGame = ({ fromForm = true } = {}) => {
  if (fromForm) FMQ.readSetupForm();
  FMQ.normalizeConfig();
  FMQ.writeSetupForm();
  FMQ.resetSession();
  FMQ.resetMultiplayerRound?.();
  FMQ.showScreen("screenGame");
  FMQ.resetTurnUI();
};

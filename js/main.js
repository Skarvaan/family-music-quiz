window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Einstiegspunkt: verbindet die Module und hängt alle Ereignisse ein. */

// Hinweis: main.js orchestriert Ablauf/Events und verbindet alle Module.

// =========================================================
// ACCESSIBILITY-HELPER
// =========================================================
FMQ.applyAccessibilityLabels = () => {
  document.querySelectorAll("button, select, input").forEach(el => {
    if (el.getAttribute("aria-label")) return;
    const id = el.id || "";
    const txt = (el.textContent || "").trim();
    const labelFromFor = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : "";
    const wrappedLabel = el.closest("label")?.textContent?.trim() || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const fallback = labelFromFor || wrappedLabel || placeholder || txt || id || "Interaktives Element";
    el.setAttribute("aria-label", fallback);
  });
};

FMQ.init = async () => {
  if (!FMQ.setupNavigationBound) {
    FMQ.setupNavigationBound = true;
    FMQ.$("screenSetup")?.addEventListener("click", FMQ.handleSetupNavigation);
  }
  if (FMQ.$("setupNextBtn")) FMQ.$("setupNextBtn").onclick = () => {
    if (!FMQ.isMultiDevice?.()) FMQ.setDeviceMode?.("single");
    FMQ.goToSetupStep(2);
  };
  if (FMQ.$("setupBackBtn")) FMQ.$("setupBackBtn").onclick = () => FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) - 1);
  if (FMQ.$("setupContinueBtn")) FMQ.$("setupContinueBtn").onclick = () => {
    if (!FMQ.setupCanProceed()) return;
    if (FMQ.app.state.setupStep === 4) {
      FMQ.startGame();
      return;
    }
    FMQ.goToSetupStep((FMQ.app.state.setupStep || 1) + 1);
  };

  FMQ.$("redirectUriPill").textContent = FMQ.REDIRECT_URI;

  FMQ.$("quick3HelpCloseBtn").onclick = () => FMQ.$("quick3HelpOverlay").classList.remove("show");
  FMQ.$("quick3ConfirmBtn").onclick = () => {
    const me = FMQ.currentPlayer();
    const result = FMQ.modes.quick3.submitAnswer(me.id, {
      title: FMQ.$("quick3ChkTitle").checked,
      artist: FMQ.$("quick3ChkArtist").checked,
      year: FMQ.$("quick3ChkYear").checked
    });
    const pts = result.points;
    FMQ.app.state.selfCheckPending = false;
    FMQ.$("quick3PtsStatus").innerHTML = `<span class="ok">+${pts} Punkte bestätigt</span>`;
    FMQ.$("quick3ConfirmBtn").disabled = true;
    FMQ.renderScoreTable();
    setTimeout(() => {
      FMQ.$("quick3RevealOverlay").classList.remove("show");
      FMQ.$("nextBtn").disabled = false;
      FMQ.onNext();
    }, 220);
  };
  FMQ.$("loginBtn").onclick = () => FMQ.loginSpotify().catch(() => FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!");
  if (FMQ.$("logoutBtn")) FMQ.$("logoutBtn").onclick = () => FMQ.logoutSpotify();
  if (FMQ.$("loadMyPlaylistsBtn")) FMQ.$("loadMyPlaylistsBtn").onclick = () => FMQ.loadMyPlaylists().catch(() => { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; });
  FMQ.$("buildPlayersBtn").onclick = () => FMQ.buildPlayersConfig();
  FMQ.$("modeSelect").onchange = () => { FMQ.app.config.mode = FMQ.$("modeSelect").value; FMQ.renderModeHints(); FMQ.renderModeButtons(); FMQ.syncSetupForMode(); FMQ.renderSetupWizard(); };
  FMQ.$("targetPlusBtn").onclick = () => {
    const endType = FMQ.$("endTypeSelect").value;
    const fieldId = endType === "points" ? "targetPointsInput" : "targetRoundsInput";
    const max = endType === "points" ? 999 : 50;
    const def = endType === "points" ? "15" : "5";
    FMQ.$(fieldId).value = String(Math.min(max, parseInt(FMQ.$(fieldId).value || def, 10) + 1));
  };
  FMQ.$("targetMinusBtn").onclick = () => {
    const endType = FMQ.$("endTypeSelect").value;
    const fieldId = endType === "points" ? "targetPointsInput" : "targetRoundsInput";
    const def = endType === "points" ? "15" : "5";
    FMQ.$(fieldId).value = String(Math.max(1, parseInt(FMQ.$(fieldId).value || def, 10) - 1));
  };
  FMQ.$("endTypeSelect").onchange = () => {
    const points = FMQ.$("endTypeSelect").value === "points";
    FMQ.$("targetLabelText").textContent = points ? "Punkte" : "Runden";
    FMQ.$("targetPointsInput").style.display = points ? "" : "none";
    FMQ.$("targetRoundsInput").style.display = points ? "none" : "";
    FMQ.renderSetupWizard();
  };
  const rebuildFromPlayerCount = () => {
    FMQ.buildPlayersConfig();
    FMQ.renderSetupWizard();
  };
  FMQ.$("playerPlusBtn").onclick = () => {
    FMQ.$("playerCountInput").value = String(Math.min(15, parseInt(FMQ.$("playerCountInput").value || "0", 10) + 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerMinusBtn").onclick = () => {
    FMQ.$("playerCountInput").value = String(Math.max(FMQ.isMultiDevice?.() ? 0 : 1, parseInt(FMQ.$("playerCountInput").value || "1", 10) - 1));
    rebuildFromPlayerCount();
  };
  FMQ.$("playerCountInput").addEventListener("change", rebuildFromPlayerCount);
  FMQ.$("readyBtn").onclick = () => FMQ.onReady().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("playToggleBtn").onclick = () => FMQ.onTogglePlay().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("revealBtn").onclick = () => FMQ.onReveal().catch(e => FMQ.setGameDebug(e.stack || e.message));
  if (FMQ.$("newTrackBtn")) FMQ.$("newTrackBtn").onclick = () => FMQ.onNewTrack().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("nextBtn").onclick = () => FMQ.onNext().catch(e => FMQ.setGameDebug(e.stack || e.message));
  FMQ.$("quitBtn").onclick = () => FMQ.quitToMenu();
  FMQ.$("endBtn").onclick = () => FMQ.quitToMenu();

  FMQ.buildPlayersConfig();
  FMQ.renderDeviceModePanel?.();
  FMQ.renderPlayerSwitchPanel();
  FMQ.$("endTypeSelect").dispatchEvent(new Event("change"));
  FMQ.syncSetupForMode();
  FMQ.renderModeHints();
  FMQ.refreshConnStatus();
  FMQ.renderSetupWizard();
  FMQ.applyAccessibilityLabels();

  try { await FMQ.handleOAuthCallbackIfPresent(); } catch (e) { FMQ.setDebug(e.stack || e.message); }
  if (FMQ.storage.token && !FMQ.app.playlists.length) {
    try { await FMQ.loadMyPlaylists(); } catch (e) { FMQ.$("playlistStatus").textContent = "Bitte neu verbinden!"; }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FMQ.init();
});

document.addEventListener("DOMContentLoaded", () => {
  FMQ.init();
});

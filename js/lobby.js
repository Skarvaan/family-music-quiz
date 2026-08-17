window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Anzeige der Lobby und des Mehrgeräte-Panels auf dem großen Bildschirm. */

FMQ.showMultiDeviceHint = (message) => {
  const el = FMQ.$("multiDeviceStatus");
  if (el) el.textContent = message;
};

FMQ.renderDeviceModePanel = () => {
  const panel = FMQ.$("deviceModePanel");
  if (!panel) return;
  const local = FMQ.isLocalMultiServer();
  const active = FMQ.isMultiDevice();
  const room = FMQ.multiplayer.roomCode || "…";
  const phoneUrl = active ? FMQ.getPhoneJoinUrl() : "";
  const qrUrl = active && phoneUrl ? `/qr.svg?url=${encodeURIComponent(phoneUrl)}` : "";
  const joinedPlayers = (FMQ.app.players || []).filter(p => p.remoteConnected);
  const totalPlayers = (FMQ.app.players || []).length;
  // Der Server liefert die Adressen sortiert. Wir zeigen die beste im
  // QR-Code und die übrigen als Ausweichliste, falls der Rechner mehrere
  // Netzwerkadapter hat (VPN, Docker, virtuelle Maschinen).
  const altUrls = active
    ? (FMQ.multiplayer.hostUrls || []).filter(url => FMQ.playerUrlWithRoom(url) !== phoneUrl)
    : [];
  const html = `
    <div class="deviceModeCards">
      <button id="singleDeviceModeBtn" type="button" class="menu-card compact ${!active ? "active" : ""}" aria-pressed="${!active}"><span class="card-title">Modus: Ein Gerät</span><span class="card-subtitle">Jeder ist nacheinander dran.</span></button>
      <button id="multiDeviceModeBtn" type="button" class="menu-card compact ${active ? "active" : ""}" aria-pressed="${active}"><span class="card-title">Modus: Eigene Geräte</span><span class="card-subtitle">Jeder ist am eigenen Gerät gleichzeitig dran.</span></button>
    </div>
    ${active ? `<div class="row row--center"><button id="closeMultiSessionBtn" type="button" class="action-button secondary">Sitzung schließen</button></div>` : ""}
    <div id="multiDeviceStatus" class="muted multiDeviceStatus">${active ? `Mehrgeräte-Modus aktiv · Raum ${FMQ.escapeHtml(room)}` : local ? "Lokaler Server erkannt. Mehrgeräte-Modus ist möglich." : "Für Mehrgeräte-Modus bitte lokalen Server starten: npm start und dann die lokale Adresse öffnen."}</div>
    ${active ? `
      <section class="multiLobbyCard">
        <div class="section-title-row">
          <div><div class="eyebrow">Warteraum</div><h2>Raum ${FMQ.escapeHtml(room)}</h2></div>
          <span class="pill ${FMQ.multiplayer.connected ? "ok" : "bad"}">${FMQ.multiplayer.connected ? "online" : "offline"}</span>
        </div>
        <div class="multiLobbyGrid">
          <div class="qrBox">${qrUrl ? `<img alt="QR-Code zum Beitreten" src="${qrUrl}">` : ""}</div>
          <div class="joinInstructions">
            <b>Handys öffnen:</b>
            <div class="joinLink">${FMQ.escapeHtml(phoneUrl)}</div>
            <div class="row"><button type="button" id="copyJoinLinkBtn" class="action-button secondary">Link kopieren</button></div>
            <div class="muted">Raumcode: <b>${FMQ.escapeHtml(room)}</b> · Groß- und Kleinschreibung egal.</div>
            <div class="muted">Alle Geräte müssen im selben WLAN sein. Gastnetz und Haupt-WLAN zählen als zwei Netze.</div>
            <div class="joinLiveCount" aria-live="polite"><b>${joinedPlayers.length}</b> Gerät${joinedPlayers.length === 1 ? "" : "e"} verbunden${totalPlayers ? ` · ${totalPlayers} Spieler angelegt` : ""}</div>
            ${altUrls.length ? `<details class="joinAlternatives"><summary>Klappt der QR-Code nicht?</summary>
              <div class="muted">Diese Adressen auf dem Handy von Hand eingeben, eine davon passt fast immer:</div>
              <ul class="altUrlList">${altUrls.map(u => `<li>${FMQ.escapeHtml(FMQ.playerUrlWithRoom(u))}</li>`).join("")}</ul>
              <div class="muted">Bleibt die Seite weiß, blockiert meist die Firewall des Rechners den Port. Node.js für private Netzwerke freigeben.</div>
            </details>` : ""}
          </div>
        </div>
        <div class="multiLobbyRoster" aria-live="polite">
          ${(FMQ.app.players || []).map(p => `<span class="pill ${p.remoteConnected ? "ok" : ""}">${FMQ.escapeHtml(p.name)} · ${p.remoteConnected ? "drin" : "offline"}</span>`).join("") || `<span class="muted">Noch niemand beigetreten.</span>`}
        </div>
      </section>` : ""}
  `;
  // Ohne diesen Vergleich baut sich die Lobby bei jedem Socket-Update neu
  // auf. Der QR-Code flackert dann und Taps auf die Modus-Karten gehen
  // ins Leere, weil das Element zwischen Fingerdruck und Loslassen ersetzt wird.
  if (panel.dataset.renderedKey === html) return;
  panel.dataset.renderedKey = html;
  panel.innerHTML = html;
  // Die beiden Modus-Karten werden über den delegierten Handler in
  // main.js bedient. Kein zusätzliches onclick, sonst feuert es doppelt.
  if (FMQ.$("closeMultiSessionBtn")) FMQ.$("closeMultiSessionBtn").onclick = () => FMQ.closeMultiplayerSession();
  const copyBtn = FMQ.$("copyJoinLinkBtn");
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      copyBtn.textContent = "Link kopiert";
      setTimeout(() => { copyBtn.textContent = "Link kopieren"; }, 2000);
    } catch {
      copyBtn.textContent = "Bitte von Hand abtippen";
    }
  };
};

FMQ.renderMultiplayerPanel = () => {
  const panels = [FMQ.$("multiplayerPanel"), FMQ.$("multiplayerSetupPanel")].filter(Boolean);
  if (!panels.length) return;
  const renderEmpty = () => {
    panels.forEach(panel => {
      panel.style.display = "none";
      panel.innerHTML = "";
      delete panel.dataset.renderedHtml;
    });
  };
  if (!FMQ.isMultiDevice()) {
    renderEmpty();
    return;
  }
  const joinUrl = FMQ.multiplayer.joinUrl || FMQ.getPhoneJoinUrl();
  const players = FMQ.app.players;
  const s = FMQ.app.state.social;
  const answers = s?.answersByPlayer || {};
  const html = `
    <div class="multiHostCard">
      <div class="section-title-row">
        <div><div class="eyebrow">Mehrgeräte-Modus</div><h3>Raum ${FMQ.escapeHtml(FMQ.multiplayer.roomCode || "…")}</h3></div>
        <span class="pill ${FMQ.multiplayer.connected ? "ok" : "bad"}">${FMQ.multiplayer.connected ? "verbunden" : "offline"}</span>
      </div>
      <div class="muted">Handys öffnen: <b>${FMQ.escapeHtml(joinUrl)}</b></div>
      <div class="muted">Wichtig: Jeder nutzt denselben Namen beim Rejoin. Gleicher Name = gleicher Spieler; Tippfehler erzeugen neue Spieler.</div>
      <label class="multiControllerSelect"><b>Handy-Steuerung</b><select data-role="controller-select"><option value="">Host steuert</option>${players.map(p => `<option value="${FMQ.escapeHtml(p.remoteId || p.id)}" ${(FMQ.multiplayer.controllerId === (p.remoteId || p.id)) ? "selected" : ""}>${FMQ.escapeHtml(p.name)}</option>`).join("")}</select></label>
      <div class="multiRoster">
        ${players.map(p => {
          const id = p.remoteId || p.id;
          const answered = Object.prototype.hasOwnProperty.call(answers, id) || Object.prototype.hasOwnProperty.call(answers, p.id);
          return `<div class="multiRosterRow ${p.active === false ? "paused" : ""}"><span><b>${FMQ.escapeHtml(p.name)}</b><small>${p.remoteConnected ? "online" : "offline"} · ${p.active === false ? "pausiert" : "aktiv"}${answered ? " · geantwortet" : ""}</small></span><label><input type="checkbox" data-role="multi-active" data-pid="${FMQ.escapeHtml(id)}" ${p.active !== false ? "checked" : ""}> aktiv</label></div>`;
        }).join("") || `<div class="muted">Noch keine Handy-Spieler verbunden.</div>`}
      </div>
      <details class="multiEmergency"><summary>Notfall</summary><div class="muted">Wenn jemand nicht mehr abstimmt: Person kurz pausieren und nicht weiter auf sie warten.</div><div class="row"><select data-role="skip-player"><option value="">Person auswählen …</option>${players.map(p => `<option value="${FMQ.escapeHtml(p.remoteId || p.id)}">${FMQ.escapeHtml(p.name)}</option>`).join("")}</select><button class="action-button secondary" data-role="skip-player-btn">Person überspringen</button><button class="action-button secondary" data-role="close-session-btn">Sitzung schließen</button></div></details>
    </div>
  `;
  panels.forEach(panel => {
    if (panel.contains(document.activeElement) && document.activeElement?.matches?.("select,input,button,textarea")) return;
    // Raum-Updates kommen im Sekundentakt. Ein innerHTML-Neuaufbau bei
    // jedem Update reißt Buttons unter dem Finger weg, während der Host
    // gerade tippt. Deshalb nur zeichnen, wenn sich der Inhalt ändert.
    if (panel.dataset.renderedHtml === html) return;
    panel.dataset.renderedHtml = html;
    panel.style.display = "block";
    panel.innerHTML = html;
    panel.querySelectorAll('[data-role="multi-active"]').forEach(inp => inp.onchange = () => FMQ.setPlayerActive(inp.getAttribute("data-pid"), inp.checked));
    panel.querySelectorAll('[data-role="controller-select"]').forEach(sel => sel.onchange = () => FMQ.setMultiplayerController(sel.value || null));
    panel.querySelectorAll('[data-role="skip-player-btn"]').forEach(btn => btn.onclick = () => {
      const select = btn.closest("details")?.querySelector('[data-role="skip-player"]');
      if (select?.value) FMQ.skipMultiplayerPlayer(select.value);
    });
    panel.querySelectorAll('[data-role="close-session-btn"]').forEach(btn => btn.onclick = () => FMQ.closeMultiplayerSession());
  });
};

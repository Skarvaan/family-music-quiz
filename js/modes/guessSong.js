window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Punktelogik für den Selbst-Check. Wird von quick3 mitbenutzt
   und ist deshalb kein eigener Menüpunkt. */

FMQ.modes.guessSong = {
  label: "Song erkennen",
  supportsAllGuess: false,
  submitAnswer(playerId, answer) {
    const pts = (answer.title ? 1 : 0) + (answer.artist ? 1 : 0) + (answer.year ? 1 : 0);
    FMQ.awardPoints(playerId, pts);
    return { points: pts };
  },
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
      <div class="box box--flat">
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
      const result = FMQ.modes.guessSong.submitAnswer(me.id, {
        title: FMQ.$("chkTitle").checked,
        artist: FMQ.$("chkArtist").checked,
        year: FMQ.$("chkYear").checked
      });
      const pts = result.points;
      FMQ.app.state.selfCheckPending = false;
      FMQ.$("guessPtsStatus").innerHTML = `<span class="ok">+${pts} Punkte bestätigt</span>`;
      FMQ.$("confirmGuessPtsBtn").disabled = true;
      FMQ.$("nextBtn").disabled = false;
      FMQ.renderScoreTable();
    };
  }
};

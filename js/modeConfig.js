window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* Einstellungsflächen, die je nach gewähltem Spielmodus erscheinen. */

// Wer spielt mit, entscheidet über die Fragen: mit Kindern am
// Tisch sollen keine Ex-Partner-Fragen kommen.
FMQ.promptToneSelectHtml = () => `
  <div class="config-block">
    <label for="promptToneSelect"><b>Welche Fragen sollen kommen?</b></label>
    <select id="promptToneSelect">
      <option value="family">Für alle · harmlos, auch mit Kindern</option>
      <option value="mixed">Gemischt · auch persönliche Fragen</option>
      <option value="all">Alles · inklusive frecher Fragen</option>
    </select>
    <div class="muted" id="promptToneHint"></div>
  </div>`;

FMQ.bindPromptToneSelect = () => {
  const sel = FMQ.$("promptToneSelect");
  if (!sel) return;
  const hints = {
    family: "Nur Fragen, die in jeder Runde funktionieren.",
    mixed: "Zusätzlich emotionale Fragen. Gut in vertrauter Runde.",
    all: "Zusätzlich freche Fragen. Eher Freundesabend als Familienfeier."
  };
  sel.value = FMQ.app.config.promptTone || "mixed";
  const update = () => { if (FMQ.$("promptToneHint")) FMQ.$("promptToneHint").textContent = hints[sel.value] || ""; };
  sel.onchange = () => {
    FMQ.app.config.promptTone = sel.value;
    FMQ.promptBag?.reset();
    update();
  };
  update();
};

FMQ.renderModeConfig = () => {
  const mode = FMQ.$("modeSelect").value;
  const area = FMQ.$("modeConfigArea");
  area.style.display = "";
  if (mode === "ratingGuess") {
    area.innerHTML = `<div class="config-block"><label><b>Punktelogik</b></label><select id="ratingScoringSelect"><option value="classic">Klassisch (3/2/1/0)</option><option value="light">Light (2/1/0)</option></select></div><div class="muted">Party-Option: Reihum (übersichtlicher für Anfänger).</div>`;
  } else if (mode === "rankingList") {
    area.innerHTML = `<div class="config-block"><label><b>Ranking-Größe</b></label><select id="rankingSizeSetupSelect"><option value="5">Top 5 · 5 Runden</option><option value="10">Top 10 · 10 Runden</option></select></div><div class="muted">Top 5 spielt automatisch 5 Runden, Top 10 automatisch 10 Runden.</div>`;
  } else if (mode === "storyPrompt" || mode === "promptDuel") {
    const intro = mode === "storyPrompt"
      ? "<b>Song-Geschichten:</b> Alle bekommen denselben Prompt und wählen einen Song. Kein Voting, keine Punkte."
      : "<b>Song-Duell:</b> Rundenzahl links einstellen. Pro Runde zwei Prompts pro Person, danach wird abgestimmt.";
    area.innerHTML = `<div class="muted">${intro}</div>${FMQ.promptToneSelectHtml()}`;
    FMQ.bindPromptToneSelect();
  } else {
    area.innerHTML = `<div class="muted">Party-Option: Reihum (übersichtlicher für Anfänger).</div>`;
  }
  const partySelect = FMQ.$("partySelect");
  if (partySelect) {
    partySelect.value = FMQ.app.config.party;
    partySelect.onchange = () => FMQ.app.config.party = partySelect.value;
  }
  if (FMQ.$("ratingScoringSelect")) {
    FMQ.$("ratingScoringSelect").value = FMQ.app.config.ratingScoring || "classic";
    FMQ.$("ratingScoringSelect").onchange = () => FMQ.app.config.ratingScoring = FMQ.$("ratingScoringSelect").value;
  }
  if (FMQ.$("rankingSizeSetupSelect")) {
    FMQ.$("rankingSizeSetupSelect").value = String(FMQ.app.config.rankingSize || 5);
    FMQ.$("rankingSizeSetupSelect").onchange = () => {
      FMQ.app.config.rankingSize = parseInt(FMQ.$("rankingSizeSetupSelect").value, 10);
      FMQ.app.config.targetRounds = FMQ.app.config.rankingSize;
      if (FMQ.$("targetRoundsInput")) FMQ.$("targetRoundsInput").value = String(FMQ.app.config.rankingSize);
      FMQ.syncSetupForMode?.();
    };
  }
};

FMQ.renderModeHints = () => {
  const mode = FMQ.$("modeSelect").value;
  FMQ.$("modeHint").textContent = FMQ.MODE_INFO[mode]?.hint || "";
  FMQ.renderModeConfig();
};

/* Prüft die Modulstruktur: dass jede Datei ihren Zweck erfüllt,
   keine Datei zu groß wird und keine Funktion verlorengeht. */

const fs = require("fs");
const path = require("path");
const wurzel = path.join(__dirname, "..");

const results = [];
const check = (label, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`);
};

const lies = p => fs.readFileSync(path.join(wurzel, p), "utf8");
const zeilen = p => lies(p).split("\n").length;

// --- Modusdateien ---
const MODI = ["guessSong","quick3","rankingList","introPlaylistGuess",
              "introFirst3","ratingGuess","bestFit","songChallenge"];
MODI.forEach(m => {
  const p = `js/modes/${m}.js`;
  check(`${p} existiert`, fs.existsSync(path.join(wurzel, p)));
  if (fs.existsSync(path.join(wurzel, p))) {
    check(`${m} registriert sich selbst`, lies(p).includes(`FMQ.modes.${m} =`));
  }
});
check("Die alte Sammeldatei js/modes.js ist aufgelöst",
  !fs.existsSync(path.join(wurzel, "js", "modes.js")));

// --- Dateigrößen ---
const grenze = 380;
const zuGross = [];
const pruefen = dir => {
  for (const e of fs.readdirSync(path.join(wurzel, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { pruefen(path.join(dir, e.name)); continue; }
    if (!e.name.endsWith(".js")) continue;
    const p = path.join(dir, e.name);
    if (zeilen(p) > grenze) zuGross.push(`${p} (${zeilen(p)})`);
  }
};
pruefen("js");
check(`Keine JS-Datei über ${grenze} Zeilen`, zuGross.length === 0, zuGross.join(", "));

// --- Skripteinbindung passt zu den Dateien ---
const html = lies("index.html");
const eingebunden = [...html.matchAll(/src="\/family-music-quiz\/(js\/[^"]+)"/g)].map(m => m[1]);
const fehlend = eingebunden.filter(p => !fs.existsSync(path.join(wurzel, p)));
check("Alle eingebundenen Skripte existieren", fehlend.length === 0, fehlend.join(", "));

const vorhanden = [];
const sammeln = dir => {
  for (const e of fs.readdirSync(path.join(wurzel, dir), { withFileTypes: true })) {
    if (e.isDirectory()) sammeln(path.join(dir, e.name));
    else if (e.name.endsWith(".js")) vorhanden.push(path.join(dir, e.name).replace(/\\/g, "/"));
  }
};
sammeln("js");
const nichtEingebunden = vorhanden.filter(p => !eingebunden.includes(p));
check("Keine verwaiste JS-Datei", nichtEingebunden.length === 0, nichtEingebunden.join(", "));

// --- Reihenfolge: shared.js vor den Modi, setup/game vor main ---
const idx = p => eingebunden.indexOf(p);
check("shared.js lädt vor den Modi", MODI.every(m => idx("js/modes/shared.js") < idx(`js/modes/${m}.js`)));
check("main.js lädt zuletzt", idx("js/main.js") === eingebunden.length - 1);

// --- Aufgabentrennung ---
check("setup.js enthält den Assistenten", lies("js/setup.js").includes("FMQ.renderSetupWizard"));
check("roundFlow.js enthält die Rundenlogik", lies("js/roundFlow.js").includes("FMQ.onNext"));
check("turn.js enthält den einzelnen Zug", lies("js/turn.js").includes("FMQ.prepareTrackForTurn"));
check("main.js ist nur noch Verdrahtung", lies("js/main.js").includes("FMQ.init") && zeilen("js/main.js") < 200);

// --- Konfiguration als einzige Quelle ---
const setup = lies("js/setup.js");
check("Konfiguration lässt sich lesen und zurückspiegeln",
  setup.includes("FMQ.readSetupForm") && setup.includes("FMQ.writeSetupForm") && setup.includes("FMQ.normalizeConfig"));
check("startGame kann ohne Formular starten", setup.includes("fromForm = true"));

// --- Tote Modi entfernt ---
const allesJs = vorhanden.map(lies).join("\n");
check("Nicht erreichbare Modi sind entfernt",
  !allesJs.includes("speedGuess") && !allesJs.includes("knowledgeGuess"));

const alleOk = results.every(Boolean);
console.log("\n" + (alleOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
process.exit(alleOk ? 0 : 1);

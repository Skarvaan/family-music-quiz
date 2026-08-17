/* Prüft Prompt-Bibliothek und Ziehung: keine doppelten IDs,
   keine Wiederholungen innerhalb einer Sitzung, Tonfilter greift. */

const fs = require("fs");
const path = require("path");

const results = [];
const check = (label, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`);
};

// Minimale Umgebung, damit die Browser-Dateien laufen
global.window = {};
const mem = {};
global.localStorage = {
  getItem: k => mem[k] ?? null,
  setItem: (k, v) => { mem[k] = v; },
  removeItem: k => { delete mem[k]; }
};

require(path.join(__dirname, "..", "data", "songPrompts.js"));
const data = global.window.FMQ_SONG_PROMPTS;

const FMQ = {
  app: { config: { promptTone: "mixed" } },
  shuffle: a => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
    return x;
  }
};
global.FMQ = FMQ;
global.window.FMQ = FMQ;

// FMQ.promptBag aus modes.js herauslösen
const src = fs.readFileSync(path.join(__dirname, "..", "js", "modes", "shared.js"), "utf8");
const von = src.indexOf("FMQ.promptBag = {");
const bis = src.indexOf("FMQ.canPlayerActNow");
eval(src.slice(von, bis));

// --- Bibliothek ---
const alle = [...data.storyPrompts, ...data.duelPrompts];
check("Story-Prompts vorhanden", data.storyPrompts.length >= 100, data.storyPrompts.length + " Stück");
check("Duell-Prompts vorhanden", data.duelPrompts.length >= 100, data.duelPrompts.length + " Stück");
check("Keine doppelten IDs", new Set(alle.map(p => p.id)).size === alle.length);
check("Alle haben Text, Thema und Ton", alle.every(p => p.text && p.theme && p.tone));
check("Alle Themen sind bekannt", alle.every(p => data.themes[p.theme]), [...new Set(alle.filter(p => !data.themes[p.theme]).map(p => p.theme))].join(","));
check("Alle Tonarten sind bekannt", alle.every(p => data.tones[p.tone]));
check("Kein Prompt doppelt formuliert", new Set(alle.map(p => p.text)).size === alle.length);

const themenStory = new Set(data.storyPrompts.map(p => p.theme));
check("Story deckt mehrere Themen ab", themenStory.size >= 6, themenStory.size + " Themen");

// --- Ziehung ---
const gezogen = Array.from({ length: 40 }, () => FMQ.promptBag.draw("shared", 1)[0]);
check("40 Ziehungen ohne Wiederholung", new Set(gezogen.map(p => p.id)).size === 40);
let hintereinander = 0;
for (let i = 1; i < gezogen.length; i++) if (gezogen[i].theme === gezogen[i - 1].theme) hintereinander++;
check("Kein Thema zweimal hintereinander", hintereinander === 0, hintereinander + " Fälle");

let doppelInRunde = 0;
for (let r = 0; r < 8; r++) {
  const runde = FMQ.promptBag.draw("duel", 5);
  if (new Set(runde.map(p => p.id)).size !== 5) doppelInRunde++;
}
check("Duellrunden ohne Doppelung", doppelInRunde === 0);

FMQ.app.config.promptTone = "family";
FMQ.promptBag.reset();
const harmlos = Array.from({ length: 50 }, () => FMQ.promptBag.draw("shared", 1)[0]);
check("Modus 'Für alle' liefert nur harmlose Fragen", harmlos.every(p => p.tone === "family"));

FMQ.app.config.promptTone = "all";
FMQ.promptBag.reset();
const tonarten = new Set(Array.from({ length: 80 }, () => FMQ.promptBag.draw("shared", 1)[0].tone));
check("Modus 'Alles' liefert alle Tonarten", tonarten.size === 3, [...tonarten].join(", "));

// Beutel darf nie leer laufen
FMQ.promptBag.reset();
let leer = false;
for (let i = 0; i < 400; i++) { const p = FMQ.promptBag.draw("shared", 1)[0]; if (!p || !p.text) leer = true; }
check("400 Ziehungen liefern immer einen Prompt", !leer);

const alleOk = results.every(Boolean);
console.log("\n" + (alleOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
process.exit(alleOk ? 0 : 1);

/* Lädt index.html wie ein echter Browser: alle Skripte in der Reihenfolge
   aus dem Markup, dann DOMContentLoaded. Prüft, dass genau einmal
   initialisiert wird und die Spieleranzahl bedienbar ist. */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const wurzel = path.join(__dirname, "..");

const results = [];
const check = (label, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  \u00b7  " + extra : ""}`);
};

const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost:3000/", pretendToBeVisual: true });
const w = dom.window;
w.crypto = { randomUUID: () => Math.random().toString(36).slice(2), getRandomValues: a => a };
w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

const fehler = [];
w.onerror = m => fehler.push(String(m));

const skripte = [...html.matchAll(/src="\/family-music-quiz\/([^"]+)"/g)].map(m => m[1]);
check("Skripte im Markup gefunden", skripte.length > 0, skripte.length + " Dateien");
for (const s of skripte) {
  try { w.eval(fs.readFileSync(path.join(wurzel, s), "utf8")); }
  catch (e) { fehler.push(`${s}: ${e.message}`); }
}
check("Alle Skripte laden fehlerfrei", fehler.length === 0, fehler.join(" | "));

const F = w.FMQ;
const $ = id => w.document.getElementById(id);
let initAufrufe = 0;
const echt = F.init;
F.init = (...a) => { initAufrufe++; return echt.apply(F, a); };

w.document.dispatchEvent(new w.Event("DOMContentLoaded", { bubbles: true }));

setTimeout(() => {
  check("Genau ein init beim Laden", initAufrufe === 1, initAufrufe + " Aufrufe");

  const klick = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  const anzahl = () => F.app.players.length;

  check("Startaufstellung angelegt", anzahl() === 3, anzahl() + " Spieler");

  klick($("playerPlusBtn"));
  klick($("playerPlusBtn"));
  check("Plus erhoeht die Spielerzahl", anzahl() === 5, anzahl() + " Spieler");

  klick($("playerMinusBtn"));
  klick($("playerMinusBtn"));
  klick($("playerMinusBtn"));
  check("Minus verringert die Spielerzahl", anzahl() === 2, anzahl() + " Spieler");

  $("playerCountInput").value = "6";
  $("playerCountInput").dispatchEvent(new w.Event("change", { bubbles: true }));
  check("Direkteingabe wird uebernommen", anzahl() === 6, anzahl() + " Spieler");
  check("Ebenso viele Spielerkarten sichtbar",
    w.document.querySelectorAll("#playersConfig .player-card").length === 6);

  check("Untergrenze wird eingehalten", (() => {
    for (let i = 0; i < 10; i++) klick($("playerMinusBtn"));
    return anzahl() >= 1;
  })(), anzahl() + " Spieler");

  check("Keine JS-Fehler beim Bedienen", fehler.length === 0, fehler.join(" | "));

  const alleOk = results.every(Boolean);
  console.log("\n" + (alleOk ? "ALLE PR\u00dcFUNGEN BESTANDEN" : "ES GIBT FEHLSCHL\u00c4GE"));
  process.exit(alleOk ? 0 : 1);
}, 400);

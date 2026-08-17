/* Prüft, dass jede im Markup verwendete Klasse eine CSS-Regel hat,
   dass das Stylesheet syntaktisch geschlossen ist und dass die
   Farbkontraste WCAG AA erfüllen. Läuft ohne Browser. */

const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..");
const results = [];
const check = (label, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`);
};

const css = fs.readFileSync(path.join(wurzel, "styles.css"), "utf8");

// --- Syntax ---
const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, "");
check("Stylesheet ist geschlossen",
  (ohneKommentare.match(/\{/g) || []).length === (ohneKommentare.match(/\}/g) || []).length);
check("Keine leeren Farbwerte", !/:\s*;/.test(ohneKommentare));

// --- Klassenabdeckung ---
const dateien = [];
const sammeln = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sammeln(p);
    else if (/\.(js|html)$/.test(e.name)) dateien.push(p);
  }
};
sammeln(path.join(wurzel, "js"));
dateien.push(path.join(wurzel, "index.html"));
dateien.push(path.join(wurzel, "public", "player.html"));
dateien.push(path.join(wurzel, "public", "player.js"));

const ignorieren = new Set(["true", "false", "selectedId"]);
const klassen = new Set();
for (const p of dateien) {
  const s = fs.readFileSync(p, "utf8");
  for (const m of s.matchAll(/class=\\?"([^"\\]+)/g)) m[1].split(/\s+/).forEach(k => klassen.add(k));
  for (const m of s.matchAll(/classList\.(?:add|toggle|remove)\("([^"]+)"/g)) klassen.add(m[1]);
}
const gueltig = [...klassen].filter(k => /^[a-zA-Z][\w-]*$/.test(k) && !ignorieren.has(k));
const ohneRegel = gueltig.filter(k => !css.includes("." + k));
check("Jede verwendete Klasse hat eine Regel", ohneRegel.length === 0,
  ohneRegel.length ? ohneRegel.join(", ") : gueltig.length + " Klassen geprüft");

// --- Keine Stilangaben im JavaScript ---
const mitInlineStyle = dateien.filter(p => /\.js$/.test(p) && /style="/.test(fs.readFileSync(p, "utf8")));
check("Keine Inline-Styles im JavaScript", mitInlineStyle.length === 0,
  mitInlineStyle.map(p => path.basename(p)).join(", "));

// --- Kontraste ---
const rgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const leuchtdichte = h => {
  const [r, g, b] = rgb(h).map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a, b) => {
  const la = leuchtdichte(a), lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const paare = [
  ["Fließtext auf Grund", "#FBF3E7", "#120B1F"],
  ["Hilfstext auf Karte", "#C3B2D8", "#251740"],
  ["Akzent auf Karte", "#C8FF4D", "#1B1130"],
  ["Jahreszahl auf Karte", "#FF4D6D", "#251740"],
  ["Text auf Hauptbutton", "#FFFFFF", "#D92E52"],
  ["Text auf Reveal-Button", "#2B1A05", "#E0912B"]
];
const schwach = paare.filter(([, fg, bg]) => kontrast(fg, bg) < 4.5);
check("Alle Textkontraste erfüllen WCAG AA", schwach.length === 0,
  schwach.length ? schwach.map(p => p[0]).join(", ") : paare.length + " Paare geprüft");

// --- Barrierefreiheits-Bausteine vorhanden ---
[
  ["Sichtbarer Tastaturfokus", ":focus-visible"],
  ["Reduzierte Bewegung wird respektiert", "prefers-reduced-motion"],
  ["Hoher Kontrast wird respektiert", "prefers-contrast"],
  ["Safe-Area für iPhones", "env(safe-area-inset"],
  ["Große-Schrift-Modus", "body.big-text"],
  ["Ruhige-Bewegung-Modus", "body.calm-motion"],
  ["Tap-Schutz nach dem Absenden", ".tap-shield"]
].forEach(([label, muster]) => check(label, css.includes(muster)));

const alleOk = results.every(Boolean);
console.log("\n" + (alleOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
process.exit(alleOk ? 0 : 1);

# Family Music Quiz

Playlist-Partyspiel für Sofa, Küche und große Runden. Der Host läuft auf einem
Rechner mit Spotify Premium, alle anderen spielen am eigenen Handy mit.

---

## Starten

```bash
npm install
npm start
```

Danach im Terminal die Adressen ablesen:

```
Host-Bildschirm:  http://localhost:3000
Raumcode:         abc123

Für Handys und iPads im selben WLAN:
  http://192.168.x.x:3000/player   ← diese zuerst probieren
```

Auf dem Rechner `http://localhost:3000` öffnen, Spotify verbinden, auf
**Modus: Eigene Geräte** tippen. Die Handys scannen den QR-Code oder tippen die
Adresse ein.

Anderer Port: `PORT=3001 npm start`

### Wenn ein Handy nicht reinkommt

1. Gleiches WLAN? Gastnetz und Haupt-WLAN zählen als zwei verschiedene Netze.
2. Bleibt die Seite weiß, blockiert fast immer die Firewall des Rechners.
   - Windows: Node.js für **private Netzwerke** freigeben.
   - macOS: Systemeinstellungen → Netzwerk → Firewall → Node erlauben.
3. Hat der Rechner VPN, Docker oder virtuelle Maschinen, gibt es mehrere
   Netzwerkadressen. In der Lobby unter „Klappt der QR-Code nicht?" stehen alle
   Alternativen zum Abtippen.
4. `http://localhost:3000/health` zeigt, ob der Server überhaupt antwortet.

---

## Was in dieser Überarbeitung geändert wurde

### Fehler 1 · Handys flogen aus dem Raum

**Ursache:** Bei jeder Trennung des Hosts wurde der Raum zurückgesetzt und ein
neuer Code erzeugt. Beim Wiederverbinden passierte dasselbe ein zweites Mal. Ein
Reload des Host-Tabs, ein kurzer WLAN-Aussetzer oder ein zugeklappter Laptop hat
damit zuverlässig alle Handys mit „Raum nicht gefunden" hinausgeworfen. Der
Rejoin lief zusätzlich über exakte Namensgleichheit, ein Leerzeichen zu viel
erzeugte einen zweiten Geisterspieler.

**Jetzt:**
- Der Raumcode bleibt stabil. Er wechselt nur, wenn jemand aktiv
  „Sitzung schließen" drückt.
- Verliert der Host die Verbindung, bleibt der Raum 90 Sekunden offen. Die Handys
  zeigen „Der Host ist kurz weg" statt einer Fehlermeldung.
- Jedes Handy bekommt beim ersten Beitritt ein Token. Der Rejoin läuft darüber,
  nicht über den Namen.
- Doppelt abgeschickte Antworten werden serverseitig ignoriert statt überschrieben.

### Fehler 2 · Buttons verschoben und nicht klickbar

**Ursache A, Handy:** Die Spieleransicht hatte `overflow:hidden` zusammen mit
einer festen `max-height`. Längere Inhalte wurden hart abgeschnitten und Scrollen
war gleichzeitig gesperrt. Der Abschicken-Button lag damit unterhalb der Kante,
unsichtbar und unerreichbar.

**Ursache B, Hostbildschirm:** Die Setup-Navigation lief über `pointerdown` im
Capture-Modus mit `preventDefault()`, dazu ein globales Zeitfenster, das
450 Millisekunden lang **alle** Klicks der Seite unterdrückt hat. Dazu kamen
doppelte Klickbindungen auf denselben Karten. Auf Touchgeräten wirkten Karten
deshalb tot oder reagierten doppelt.

**Ursache C:** Die Lobby und das Mehrgeräte-Panel haben bei jedem Socket-Update
ihr komplettes HTML neu aufgebaut. Der Button verschwand zwischen Fingerdruck und
Loslassen.

**Jetzt:**
- Die Handy-Ansicht scrollt normal, nichts wird mehr abgeschnitten.
- Ein einziger delegierter Klick-Handler für die Setup-Karten, kein
  `preventDefault` auf `pointerdown`, keine globale Klicksperre.
- Panels werden nur neu gezeichnet, wenn sich ihr Inhalt tatsächlich geändert hat.
- Alle Tippziele mindestens 48 Pixel, `touch-action: manipulation` gegen die
  300-ms-Verzögerung.

### Fehler 3 · Nach dem Abstimmen wurde man pausiert

**Ursache:** Das war eine Kette aus drei Dingen. Nach dem Absenden schrumpfte die
Antwortkarte auf eine kleine Bestätigung, das Layout sprang nach oben, und genau
an die Stelle des gerade getippten Buttons rutschte der Schalter
„Ich spiele aktiv mit". iOS schickt nach `touchend` noch einen synthetischen
Klick hinterher, der dann auf dem Schalter landete. Die alte Tap-Erkennung mit
dreifacher Bindung (`pointerup` + `touchend` + `click`) und 450-ms-Sperre hat das
Verhalten zusätzlich unberechenbar gemacht.

**Jetzt:**
- Der Pause-Schalter liegt im Menü oben rechts, nicht mehr unter den Antworten.
- Nach dem Absenden liegt 700 Millisekunden lang ein unsichtbarer Schild über der
  Seite und fängt den Nachzügler-Klick ab.
- Die Fragekarte hat eine feste Mindesthöhe. Das Layout springt nicht mehr.
- Antworten laufen in zwei Schritten: erst auswählen, dann abschicken. Ein
  Fehltipper kostet keine Runde mehr.
- Ein einziger, normaler `click`-Handler statt der Dreifachbindung.

### Fehler 4 · Die Prompts waren sehr repetitiv

**Ursache:** Zwei Probleme gleichzeitig. Technisch wurde bei jedem Aufruf
`shuffle(list)[0]` genommen, ohne zu merken, was schon dran war. Inhaltlich waren
die Prompts extrem gleichförmig: 54 Story-Prompts begannen alle mit
„Wähle einen Song, der…", und rund 90 Prozent der Duell-Prompts folgten dem
Muster „verfluchtes X" oder „Tier + absurde Situation".

**Jetzt:**
- **101 Story-Prompts und 101 Duell-Prompts**, neu geschrieben mit echter
  Struktur-Varianz: Fragen, Szenarien, Superlative, Geständnisse, Aufträge.
  Beispiele: *„Zug fällt aus, es nieselt, vierzig Minuten Wartezeit. Was hörst
  du?"* · *„Der beste Songanfang in deiner Playlist. Die ersten zehn Sekunden
  zählen."* · *„Welcher Song hört besser auf?"* · *„Welchen Song hört eher
  jemand, der Socken nach Farbe sortiert?"*
- Jeder Prompt ist nach **Thema** und **Ton** getaggt.
- Gezogen wird aus einem Beutel ohne Zurücklegen. Zwei Prompts desselben Themas
  kommen nicht direkt hintereinander.
- Die letzten 45 Prompts werden im Browser gemerkt, damit auch der zweite
  Spieleabend nicht mit denselben Fragen startet.
- Im Setup wählbar: **Für alle** (harmlos, auch mit Kindern) · **Gemischt** (auch
  persönliche Fragen) · **Alles** (auch freche Fragen).

### Struktur und Aussehen

Der Code wurde in kleine, benannte Module aufgeteilt (siehe Aufbau weiter
unten). Zwei Modi, die über kein Menü mehr erreichbar waren, sind entfernt:
`speedGuess` und `knowledgeGuess`. `guessSong` sieht ebenfalls tot aus, liefert
aber die Punktelogik für `quick3` und bleibt deshalb.

Die Konfiguration ist jetzt die einzige Quelle der Wahrheit. Vorher las
`startGame()` direkt aus den Formularfeldern und überschrieb dabei alles, was
programmatisch gesetzt war. Jetzt gibt es drei getrennte Schritte:
`readSetupForm()`, `normalizeConfig()`, `writeSetupForm()`.

Aus dem JavaScript sind alle `style="…"`-Attribute verschwunden. Gestaltung
steht vollständig im Stylesheet, das in 15 nummerierte Abschnitte gegliedert ist.

Gestalterisch ist die Oberfläche neu: **Plattenladen bei Nacht**. Warmes
Aubergine statt des üblichen Marineblau, Papierweiß statt Blauweiß, dazu Coral
und Lime als Akzente. Buttons haben eine harte Unterkante wie Arcade-Tasten und
senken sich beim Drücken ab, damit auch aus drei Metern Entfernung klar ist, was
bedienbar ist. Wiederkehrendes Motiv sind Equalizer-Balken: als Streifen über
dem Spielbereich und als Warteanzeige, wenn noch Antworten fehlen. Der
Hintergrund trägt sehr feine konzentrische Rillen wie eine Schallplatte.

### Barrierefreiheit und Bedienung

- Kontrast der Hilfstexte angehoben, Grundschrift vergrößert.
- Deutlich sichtbarer Tastaturfokus auf allen Bedienelementen.
- Ausgewählte Antworten sind nicht nur farblich markiert, sondern zusätzlich mit
  einem Häkchen und einer Innenkontur. Wichtig bei Farbfehlsichtigkeit.
- Sprungmarken zum Hauptinhalt auf beiden Bildschirmen.
- `prefers-reduced-motion` und `prefers-contrast` werden respektiert.
- Im Handy-Menü zusätzlich umschaltbar: **Größere Schrift** und
  **Weniger Animationen**. Die Einstellung bleibt gespeichert.
- Feste Verbindungsleiste oben statt Statustext im Fließtext, der beim Ändern
  das Layout verschoben hat.
- Aussagekräftige Wartezustände statt „Warte auf Auswahl …" überall.
- Safe-Area-Abstände, damit auf iPhones nichts unter der Home-Leiste klebt.
- Kurze Vibration als Rückmeldung beim Auswählen und Absenden, wo unterstützt.

---

## Tests

```bash
npm test                 # alle fünf Testläufe
npm run test:structure   # Modulaufteilung, Ladereihenfolge, keine Waisen
npm run test:styles      # Klassenabdeckung, Kontraste, Barrierefreiheit
npm run test:prompts     # Prompt-Bibliothek und Ziehung
npm run test:single      # Ein-Gerät-Modus, alle sechs Spielmodi
npm run test:server      # Raumverwaltung, Reconnect, Rejoin
```

Die Tests brauchen kein Spotify. Die Wiedergabe wird attrappiert, geprüft wird
die Spiellogik: Zugwechsel, Punktevergabe, Rundenzählung, Songs ohne
Wiederholung, Siegerermittlung, Raum-Wiederverbindung.

---

## Aufbau

Der Code lag vorher in fünf großen Dateien, `modes.js` allein hatte 1724 Zeilen.
Jetzt hat jede Datei eine Aufgabe und keine ist größer als etwa 370 Zeilen.
Der Strukturtest hält das dauerhaft nach.

```
server.js                  lokaler Server, Raumverwaltung, QR-Codes
index.html                 Hostbildschirm
styles.css                 gemeinsames Stylesheet, in 15 Abschnitte gegliedert
callback.html              Spotify-OAuth-Rückleitung

data/songPrompts.js        Prompt-Bibliothek, nach Thema und Ton getaggt

js/core.js                 Konstanten, kleine Helfer, Zustandsobjekt
js/players.js              Spielerverwaltung, Playlists, Songvorrat
js/scoring.js              Songziehung, Punkte, Punktetabelle
js/modeConfig.js           Einstellungen je Spielmodus
js/spotify.js              Auth, Token, Spotify-API und Wiedergabe

js/multiplayer.js          Socket-Verbindung, Raum öffnen und schließen
js/remotePlayers.js        Handy-Spieler mit Spielerplätzen zusammenführen
js/phoneControls.js        Fernsteuerung vom Handy
js/multiplayerRound.js     Fragen stellen, Antworten sammeln
js/lobby.js                Lobby-Anzeige auf dem großen Bildschirm

js/modes/shared.js         gemeinsame Bausteine aller Modi, Prompt-Ziehung
js/modes/<name>.js         je ein Spielmodus

js/setup.js                Setup-Assistent und Konfiguration
js/pausePanel.js           Pausieren und Wiedereinsteigen
js/turn.js                 ein einzelner Zug
js/roundFlow.js            Auflösen, Weiterschalten, Spielende
js/main.js                 Einstiegspunkt, verbindet alles

public/player.html         Handy-Ansicht
public/player.js           Handy-Logik
tests/                     Regressionstests, laufen ohne Spotify
```

Die Skripte laden über `<script defer>` in fester Reihenfolge. Jede Datei
beginnt mit `window.FMQ = window.FMQ || {}` und hängt ihre Funktionen dort ein,
es gibt also keinen Bundler und keinen Build-Schritt.

## Spotify einrichten

Im Spotify Developer Dashboard muss die Redirect-URI eingetragen sein, die auf
dem Startbildschirm unter „Debug / Einstellungen" angezeigt wird. In der Regel
`http://localhost:3000/`. Der Host braucht Spotify Premium, die Mitspielenden
nicht.

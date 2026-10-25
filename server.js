/* =========================================================
   Family Music Quiz · lokaler Mehrgeräte-Server
   ---------------------------------------------------------
   Wichtigste Änderungen gegenüber v1:
   - Der Raumcode bleibt stabil. Er wechselt nur, wenn der
     Host aktiv eine neue Sitzung startet. Ein Reload des
     Host-Tabs oder ein kurzer WLAN-Aussetzer wirft niemanden
     mehr aus dem Raum.
   - Host-Trennung hat eine Karenzzeit (HOST_GRACE_MS).
     Solange bleibt der Raum offen, Handys warten geduldig.
   - Spieler bekommen ein playerToken. Rejoin läuft darüber
     statt über exakte Namensgleichheit. Tippfehler erzeugen
     keine Geisterspieler mehr.
   - LAN-Adressen werden sortiert und gefiltert, damit der
     QR-Code nicht auf eine VPN- oder Docker-Adresse zeigt,
     die im WLAN niemand erreicht.
   - Die Raumlogik selbst steckt in js/net/roomHub.js und wird
     auch vom iPad-Betrieb (WebRTC, ohne Laptop) genutzt.
   ========================================================= */

const crypto = require("crypto");
const os = require("os");
const path = require("path");
const express = require("express");
const http = require("http");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const ROOT = __dirname;
const HOST_GRACE_MS = 90 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 20000,
  pingTimeout: 40000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 }
});

// ---------------------------------------------------------
// Raum-Zustand
// ---------------------------------------------------------
// Die eigentliche Raumlogik liegt in js/net/roomHub.js. Dieselbe
// Datei läuft auch im Browser des iPads, wenn kein Laptop-Server
// im Spiel ist. Hier wird sie nur an Socket.IO angeschlossen.
const { createRoomHub } = require("./js/net/roomHub.js");

const hub = createRoomHub({
  graceMs: HOST_GRACE_MS,
  getHostUrls: () => getHostUrls(),
  randomInt: max => crypto.randomInt(max),
  randomUUID: () => crypto.randomUUID()
});

// ---------------------------------------------------------
// Netzwerkadressen
// ---------------------------------------------------------
const VIRTUAL_ADAPTER = /(vmnet|vboxnet|virtualbox|docker|br-|veth|utun|tailscale|zt|wg\d|tun\d|Hyper-V|WSL|Loopback|VPN)/i;

function isPrivateV4(address) {
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  const m = /^172\.(\d+)\./.exec(address);
  if (m) { const n = Number(m[1]); return n >= 16 && n <= 31; }
  return false;
}

/** Sortiert: typische WLAN-Netze zuerst, virtuelle Adapter ganz nach hinten. */
function getLanCandidates() {
  const out = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (!net) continue;
      const family = net.family === "IPv4" || net.family === 4;
      if (!family || net.internal) continue;
      if (/^169\.254\./.test(net.address)) continue; // Link-local, im WLAN nutzlos
      out.push({ name, address: net.address, virtual: VIRTUAL_ADAPTER.test(name), private: isPrivateV4(net.address) });
    }
  }
  const score = (n) => (n.virtual ? 100 : 0) + (n.private ? 0 : 50) + (/^192\.168\./.test(n.address) ? 0 : 5);
  return out.sort((a, b) => score(a) - score(b));
}

function getLanAddresses() {
  return getLanCandidates().map(n => `http://${n.address}:${PORT}`);
}

function getHostUrls() {
  return [...new Set([...getLanAddresses(), `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`])];
}

// ---------------------------------------------------------
// HTTP
// ---------------------------------------------------------
// Beim lokalen Partyspiel ist Caching nur ein Risiko: das iPad
// hält sonst an einer alten JS-Version fest.
const staticOptions = {
  etag: false,
  lastModified: false,
  setHeaders(res) { res.setHeader("Cache-Control", "no-store"); }
};

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use("/family-music-quiz", express.static(ROOT, staticOptions));
app.use("/public", express.static(path.join(ROOT, "public"), staticOptions));
app.use("/data", express.static(path.join(ROOT, "data"), staticOptions));
app.use("/js", express.static(path.join(ROOT, "js"), staticOptions));
app.use(express.static(ROOT, { ...staticOptions, index: false }));

app.get("/", (_req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/player", (_req, res) => res.sendFile(path.join(ROOT, "public", "player.html")));
app.get("/room-info", (_req, res) => res.json(hub.snapshot()));
app.get("/health", (_req, res) => res.json({ ok: true, roomCode: hub.code, open: hub.open, hostOnline: hub.hostOnline, players: hub.playerCount }));

app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.url || "").trim();
  if (!text) { res.status(400).send("Missing url"); return; }
  try {
    const svg = await QRCode.toString(text, { type: "svg", margin: 1, width: 300 });
    res.type("image/svg+xml").setHeader("Cache-Control", "no-store").send(svg);
  } catch {
    res.status(500).send("QR konnte nicht erzeugt werden.");
  }
});

// ---------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------
// Alle Ereignisse, die ein Client senden darf. Alles andere wird
// gar nicht erst an die Raumlogik durchgereicht.
const CLIENT_EVENTS = [
  "host:createRoom", "host:closeRoom", "host:startPrompt", "host:reveal",
  "host:resetRound", "host:setController", "host:setControllerActions",
  "player:join", "player:setActive", "player:submitAnswer", "player:controlAction"
];

io.on("connection", socket => {
  // Adapter: aus einem Socket wird ein "Client" für die Raumlogik.
  // canHost bleibt im Laptop-Betrieb für alle offen, weil der
  // Host-Bildschirm selbst nur ein Browser-Tab mit Socket ist.
  const client = {
    id: socket.id,
    data: socket.data,
    canHost: true,
    send: (event, data) => socket.emit(event, data)
  };
  hub.connect(client);
  for (const event of CLIENT_EVENTS) {
    socket.on(event, (payload, ack) => hub.handle(client, event, payload, ack));
  }
  socket.on("disconnect", () => hub.disconnect(client));
});

// ---------------------------------------------------------
// Start
// ---------------------------------------------------------
server.listen(PORT, BIND_HOST, () => {
  const lan = getLanCandidates();
  const line = "─".repeat(52);
  console.log(line);
  console.log("  Family Music Quiz läuft");
  console.log(line);
  // Spotify erlaubt seit 2025 kein "localhost" mehr als Redirect-URI,
  // nur die IP 127.0.0.1. Deshalb wird genau diese Adresse genannt.
  console.log(`  Host-Bildschirm:  http://127.0.0.1:${PORT}`);
  console.log(`  Raumcode:         ${hub.code}`);
  console.log("");
  if (lan.length) {
    console.log("  Für Handys und iPads im selben WLAN:");
    lan.forEach((n, i) => {
      const tag = i === 0 ? " ← diese zuerst probieren" : n.virtual ? "  (virtueller Adapter, meist falsch)" : "";
      console.log(`    http://${n.address}:${PORT}/player${tag}`);
    });
  } else {
    console.log("  Keine WLAN-Adresse gefunden. Ist der Rechner im WLAN?");
    console.log(`  Notfalls manuell: http://<deine-wlan-ip>:${PORT}/player`);
  }
  console.log("");
  console.log("  Klappt die Verbindung nicht, blockiert meist die Firewall.");
  console.log("  Windows: Node.js für private Netzwerke freigeben.");
  console.log("  macOS:   Systemeinstellungen → Netzwerk → Firewall → Node erlauben.");
  console.log(line);
});

server.on("error", err => {
  console.error("Server konnte nicht gestartet werden:", err.message);
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} ist belegt. Anderen Port setzen: PORT=3001 npm start`);
  if (err.code === "EACCES") console.error(`Keine Berechtigung für ${BIND_HOST}:${PORT}. Bitte anderen Port wählen.`);
});

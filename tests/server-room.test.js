/* Prüft die Raumverwaltung des Servers: Host-Reload, Rejoin per Token,
   doppelte Antworten, falscher Code. Startet den Server selbst. */

const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");

const PORT = process.env.TEST_PORT || 3945;
const URL = `http://localhost:${PORT}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (label, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FEHL"} ${label}${extra ? "  ·  " + extra : ""}`);
};

const connect = () => new Promise(resolve => {
  const s = io(URL, { forceNew: true });
  s.on("connect", () => resolve(s));
});
const ask = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore"
  });
  await wait(1500);

  try {
    let host = await connect();
    const snap1 = await ask(host, "host:createRoom", {});
    check("Raum wird erstellt", !!snap1.roomCode, "Code " + snap1.roomCode);

    const anna = await connect();
    const join = await ask(anna, "player:join", { name: "Anna", roomCode: snap1.roomCode });
    check("Spieler tritt bei", join.ok === true);
    check("Spieler bekommt ein Token", !!join.playerToken);
    const token = join.playerToken;

    // Host lädt seinen Tab neu
    host.disconnect();
    await wait(300);
    host = await connect();
    const snap2 = await ask(host, "host:createRoom", {});
    check("Raumcode überlebt Host-Reload", snap2.roomCode === snap1.roomCode);
    check("Spieler bleiben im Raum", snap2.players.length === 1);

    // Handy verliert kurz das WLAN
    anna.disconnect();
    await wait(300);
    const anna2 = await connect();
    const rejoin = await ask(anna2, "player:join", { name: "Anna", roomCode: snap1.roomCode, playerToken: token });
    check("Rejoin trifft denselben Spieler", rejoin.player.id === join.player.id);

    // Tippfehler im Namen darf keinen Doppelgänger erzeugen
    await ask(anna2, "player:join", { name: "  anna", roomCode: snap1.roomCode, playerToken: token });
    const snap3 = await ask(host, "host:createRoom", {});
    check("Tippfehler erzeugt keinen zweiten Spieler", snap3.players.length === 1, snap3.players.length + " Spieler");

    // Frage und Antwort
    await ask(host, "host:startPrompt", { id: "q1", type: "test", title: "T", text: "T", options: [{ value: "A", label: "A" }] });
    const a1 = await ask(anna2, "player:submitAnswer", { playerId: rejoin.player.id, promptId: "q1", answer: "A" });
    check("Antwort kommt an", a1.ok === true);
    const a2 = await ask(anna2, "player:submitAnswer", { playerId: rejoin.player.id, promptId: "q1", answer: "B" });
    check("Doppelte Antwort überschreibt nicht", a2.duplicate === true);
    const a3 = await ask(anna2, "player:submitAnswer", { playerId: rejoin.player.id, promptId: "alt", answer: "A" });
    check("Veraltete Frage wird abgelehnt", a3.ok === false && a3.code === "STALE");

    // Falscher Raumcode
    const ben = await connect();
    const bad = await ask(ben, "player:join", { name: "Ben", roomCode: "zzzzzz" });
    check("Falscher Raumcode wird abgelehnt", bad.ok === false && bad.code === "WRONG_ROOM");

    // Neue Sitzung
    const snap4 = await ask(host, "host:createRoom", { newSession: true });
    check("Neue Sitzung erzeugt neuen Code", snap4.roomCode !== snap1.roomCode);
    check("Neue Sitzung leert die Spielerliste", snap4.players.length === 0);

    [host, anna, anna2, ben].forEach(s => s.disconnect());
  } catch (e) {
    console.error("Abbruch:", e.message);
    results.push(false);
  } finally {
    server.kill();
  }

  const alleOk = results.every(Boolean);
  console.log("\n" + (alleOk ? "ALLE PRÜFUNGEN BESTANDEN" : "ES GIBT FEHLSCHLÄGE"));
  process.exit(alleOk ? 0 : 1);
})();

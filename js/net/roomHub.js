/* =========================================================
   Family Music Quiz · Raumlogik (transportunabhängig)
   ---------------------------------------------------------
   Diese Datei ist das Herz des Mehrgeräte-Modus. Sie weiß
   nichts über Socket.IO oder WebRTC. Sie kennt nur "Clients",
   denen sie Ereignisse schicken kann, und Ereignisse, die von
   Clients hereinkommen.

   Sie läuft an zwei Orten:
   - im Node-Server (server.js) für den klassischen Laptop-Betrieb
   - direkt im Browser des iPads (js/net/peerHost.js), wenn die
     Handys per WebRTC mit dem iPad verbunden sind

   Dadurch gibt es genau EINE Raumlogik. Ein Fehler, der hier
   behoben wird, ist in beiden Betriebsarten behoben.

   Ein Client ist ein einfaches Objekt:
     { id, send(eventName, data), data: {}, canHost: bool }
   - id:      eindeutige Kennung der Verbindung
   - send:    schickt ein Ereignis an genau diesen Client
   - data:    Ablage für playerId / isHost (wie socket.data)
   - canHost: darf dieser Client host:*-Ereignisse senden?
              Im WebRTC-Betrieb nur das iPad selbst, damit sich
              kein Handy zum Host erklären kann.
   ========================================================= */

(function (root, factory) {
  // UMD-Muster: in Node per require(), im Browser als FMQ.createRoomHub.
  // Die Ereignis-Tabelle kommt aus roomEvents.js (im Browser vorher geladen).
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./roomEvents.js").createRoomHandlers);
  } else {
    root.FMQ = root.FMQ || {};
    root.FMQ.createRoomHub = factory(root.FMQ.createRoomHandlers).createRoomHub;
  }
})(typeof self !== "undefined" ? self : this, function (createRoomHandlers) {
  "use strict";

  const ROOM_CODE_LENGTH = 6;
  // Ohne 0/o, 1/l/i: auf dem Handy leicht verwechselbar.
  const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

  /** Zufallszahl 0..max-1, mit Krypto-Zufall wo vorhanden. */
  function defaultRandomInt(max) {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  /** UUID v4, fällt auf eine selbstgebaute zurück (ältere Safaris). */
  function defaultRandomUUID() {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    const hex = [];
    for (let i = 0; i < 32; i++) hex.push(defaultRandomInt(16).toString(16));
    hex[12] = "4";
    return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
  }

  /**
   * Erzeugt einen Raum.
   * @param {object} opts
   * @param {number}   [opts.graceMs=90000]   Wie lange der Raum offen bleibt, wenn der Host weg ist
   * @param {Function} [opts.getHostUrls]     Liefert Beitrittsadressen für die Lobby
   * @param {Function} [opts.randomInt]       Zufallsquelle (Node reicht crypto.randomInt rein)
   * @param {Function} [opts.randomUUID]      UUID-Quelle
   * @param {Function} [opts.onChange]        Wird nach jeder Zustandsänderung gerufen (Speichern)
   * @param {Function} [opts.onCodeChange]    Raumcode hat gewechselt (WebRTC muss neu anmelden)
   * @param {object}   [opts.restore]         Gespeicherter Stand: { code, players:[{id,token,name,active}] }
   */
  function createRoomHub(opts = {}) {
    const graceMs = opts.graceMs ?? 90 * 1000;
    const randomInt = opts.randomInt || defaultRandomInt;
    const randomUUID = opts.randomUUID || defaultRandomUUID;
    const getHostUrls = opts.getHostUrls || (() => []);
    const onChange = opts.onChange || (() => {});
    const onCodeChange = opts.onCodeChange || (() => {});

    const makeRoomCode = () => {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      return code;
    };

    // Alle verbundenen Clients (Host + Handys), nach Verbindungs-ID.
    const clients = new Map();
    // Wer gerade "im Raum" ist und Raum-Rundsendungen bekommt.
    // Entspricht socket.join(room.code) bei Socket.IO.
    const members = new Set();

    const room = {
      code: makeRoomCode(),
      hostClientId: null,
      hostGraceTimer: null,
      playersById: new Map(),
      playerIdByToken: new Map(),
      prompt: null,
      answers: new Map(),
      controllerId: null,
      controllerActions: [],
      open: false
    };

    // Gespeicherten Stand übernehmen (iPad-Tab wurde neu geladen).
    // Spieler kommen als "nicht verbunden" zurück und docken per
    // Token wieder an, sobald ihr Handy sich meldet.
    if (opts.restore && typeof opts.restore.code === "string" && opts.restore.code.length === ROOM_CODE_LENGTH) {
      room.code = opts.restore.code;
      for (const p of opts.restore.players || []) {
        if (!p || !p.id || !p.token) continue;
        room.playersById.set(p.id, { id: p.id, token: p.token, name: cleanName(p.name), active: p.active !== false, clientId: null, lastSeenAt: p.lastSeenAt || Date.now() });
        room.playerIdByToken.set(p.token, p.id);
      }
    }

    // -------------------------------------------------------
    // Kleine Helfer
    // -------------------------------------------------------
    function cleanName(name) { return String(name || "").trim().replace(/\s+/g, " ").slice(0, 24); }
    function normalizeName(name) { return cleanName(name).toLowerCase(); }

    function publicPlayer(p) {
      return { id: p.id, name: p.name, active: p.active !== false, connected: !!p.clientId, lastSeenAt: p.lastSeenAt };
    }

    const hostOnline = () => !!room.hostClientId;

    function clearHostGrace() {
      if (room.hostGraceTimer) clearTimeout(room.hostGraceTimer);
      room.hostGraceTimer = null;
    }

    function resetRoundState() {
      room.prompt = null;
      room.answers = new Map();
    }

    /** Komplett neue Sitzung: neuer Code, alle Spieler raus. */
    function startNewSession() {
      clearHostGrace();
      room.code = makeRoomCode();
      room.playersById = new Map();
      room.playerIdByToken = new Map();
      room.controllerId = null;
      room.controllerActions = [];
      resetRoundState();
      // Nur der Host bleibt Mitglied, Handys müssen neu beitreten.
      for (const c of [...members]) if (c.id !== room.hostClientId) members.delete(c);
      onCodeChange(room.code);
    }

    function slimPrompt(prompt) {
      if (!prompt) return null;
      return { id: prompt.id, type: prompt.type, title: prompt.title, text: prompt.text, kind: prompt.kind, createdAt: prompt.createdAt };
    }

    /** Jedes Handy bekommt nur seine eigenen Tracks/Zuweisungen. */
    function promptForPlayer(playerId) {
      if (!room.prompt) return null;
      const prompt = { ...room.prompt };
      if (prompt.tracksByPlayer) prompt.tracksByPlayer = { [playerId]: prompt.tracksByPlayer[playerId] || [] };
      if (prompt.assignmentsByPlayer) prompt.assignmentsByPlayer = { [playerId]: prompt.assignmentsByPlayer[playerId] || [] };
      if (prompt.voteDuelsByPlayer) prompt.voteDuelsByPlayer = { [playerId]: prompt.voteDuelsByPlayer[playerId] || [] };
      return prompt;
    }

    // -------------------------------------------------------
    // Senden
    // -------------------------------------------------------
    const sendTo = (clientId, event, data) => {
      const c = clients.get(clientId);
      if (!c) return;
      try { c.send(event, data); } catch (e) { /* Verbindung gerade kaputt, Reconnect regelt das */ }
    };
    const toRoom = (event, data) => {
      for (const c of members) { try { c.send(event, data); } catch (e) { /* s. o. */ } }
    };

    function snapshot() {
      return {
        roomCode: room.code,
        players: [...room.playersById.values()].map(publicPlayer),
        prompt: slimPrompt(room.prompt),
        answeredPlayerIds: [...room.answers.keys()],
        hostUrls: getHostUrls(room.code),
        controllerId: room.controllerId,
        controllerActions: room.controllerActions,
        open: room.open,
        hostOnline: hostOnline()
      };
    }

    function emitRoomState() {
      const snap = snapshot();
      toRoom("room:state", snap);
      if (room.hostClientId) sendTo(room.hostClientId, "host:players", snap);
      onChange();
    }

    function emitPromptToPlayers() {
      for (const p of room.playersById.values()) if (p.clientId) sendTo(p.clientId, "player:prompt", promptForPlayer(p.id));
    }

    /** Für die Speicherung im Browser: nur das, was ein Reload überleben muss. */
    function persistable() {
      return {
        code: room.code,
        players: [...room.playersById.values()].map(p => ({ id: p.id, token: p.token, name: p.name, active: p.active !== false, lastSeenAt: p.lastSeenAt }))
      };
    }

    // -------------------------------------------------------
    // Ereignisse (in roomEvents.js, damit beide Dateien
    // übersichtlich bleiben). Wir reichen alles durch, was die
    // Ereignisse brauchen, und bekommen eine Tabelle zurück.
    // -------------------------------------------------------
    const handlers = createRoomHandlers({
      room, members, randomUUID, cleanName, normalizeName, publicPlayer,
      hostOnline, clearHostGrace, resetRoundState, startNewSession,
      slimPrompt, promptForPlayer, sendTo, toRoom, snapshot,
      emitRoomState, emitPromptToPlayers
    });

    // -------------------------------------------------------
    // Öffentliche Schnittstelle
    // -------------------------------------------------------
    return {
      /** Neue Verbindung anmelden. */
      connect(client) {
        client.data = client.data || {};
        clients.set(client.id, client);
      },

      /** Ein Ereignis eines Clients verarbeiten. ack ist optional. */
      handle(client, event, payload, ack) {
        const fn = handlers[event];
        const safeAck = typeof ack === "function" ? ack : null;
        if (!fn) { if (safeAck) safeAck({ ok: false, error: `Unbekanntes Ereignis: ${event}` }); return; }
        try {
          fn(client, payload && typeof payload === "object" ? payload : {}, safeAck);
        } catch (e) {
          if (safeAck) safeAck({ ok: false, error: "Interner Fehler: " + (e && e.message) });
        }
      },

      /** Verbindung ist weg (WLAN, Tab zu, Handy gesperrt). */
      disconnect(client) {
        clients.delete(client.id);
        members.delete(client);
        if (room.hostClientId === client.id) {
          room.hostClientId = null;
          // Karenzzeit: Reload oder kurzes Funkloch darf die Runde nicht beenden.
          toRoom("player:hostAway", { graceMs });
          clearHostGrace();
          room.hostGraceTimer = setTimeout(() => {
            if (room.hostClientId) return;
            room.open = false;
            toRoom("player:roomClosed", { error: "Der Host ist nicht zurückgekommen. Bitte später erneut beitreten." });
            emitRoomState();
          }, graceMs);
        }
        if (client.data && client.data.playerId) {
          const p = room.playersById.get(client.data.playerId);
          if (p && p.clientId === client.id) { p.clientId = null; p.lastSeenAt = Date.now(); }
        }
        emitRoomState();
      },

      snapshot,
      persistable,
      get code() { return room.code; },
      get open() { return room.open; },
      get hostOnline() { return hostOnline(); },
      get playerCount() { return room.playersById.size; },
      /** Alle Timer stoppen (Tests, Seitenwechsel). */
      dispose() { clearHostGrace(); }
    };
  }

  return { createRoomHub, ROOM_ALPHABET, ROOM_CODE_LENGTH };
});

/* =========================================================
   Family Music Quiz · Raum-Ereignisse
   ---------------------------------------------------------
   Gehört zu roomHub.js. Hier steht, was bei jedem Ereignis
   passiert, das ein Host oder ein Handy schickt.

   Jede Funktion bekommt (client, payload, ack):
   - client:  wer es geschickt hat (siehe roomHub.js)
   - payload: die Daten, immer ein Objekt
   - ack:     Rückruf für die Antwort, kann null sein

   Sicherheitsregeln, die hier gelten:
   - host:*-Ereignisse nur vom aktuellen Host.
   - Ein Handy antwortet und pausiert immer nur für sich selbst.
     Die mitgeschickte playerId zählt nur, wenn der Host sendet.
   ========================================================= */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.FMQ = root.FMQ || {};
    root.FMQ.createRoomHandlers = api.createRoomHandlers;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** ctx: alles, was roomHub.js an Zustand und Helfern hineinreicht. */
  function createRoomHandlers(ctx) {
    const {
      room, members, randomUUID, cleanName, normalizeName, publicPlayer,
      hostOnline, clearHostGrace, resetRoundState, startNewSession,
      slimPrompt, promptForPlayer, sendTo, toRoom, snapshot,
      emitRoomState, emitPromptToPlayers
    } = ctx;

    const isHostClient = client => client.id === room.hostClientId;
    const deny = (ack, error) => { if (ack) ack({ ok: false, error }); };

    const handlers = {
      // ---- Host ------------------------------------------
      "host:createRoom"(client, payload, ack) {
        if (!client.canHost) return deny(ack, "Dieses Gerät darf keinen Raum eröffnen.");
        // Ein Reload des Host-Tabs übernimmt den bestehenden Raum,
        // statt alle Handys rauszuwerfen.
        if (payload.newSession) startNewSession();
        clearHostGrace();
        room.hostClientId = client.id;
        room.open = true;
        client.data.isHost = true;
        members.add(client);
        if (payload.newSession) resetRoundState();
        if (ack) ack(snapshot());
        toRoom("player:hostBack", { roomCode: room.code });
        emitRoomState();
      },

      "host:closeRoom"(client, _payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann den Raum schließen.");
        toRoom("player:roomClosed", { error: "Der Host hat die Sitzung beendet. Für eine neue Runde bitte den neuen Code scannen." });
        room.open = false;
        startNewSession();
        if (ack) ack({ ok: true, roomCode: room.code });
        emitRoomState();
      },

      "host:startPrompt"(client, payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann Prompts starten.");
        const obj = v => (v && typeof v === "object" ? v : null);
        room.prompt = {
          id: payload.id || randomUUID(),
          type: payload.type || "generic",
          title: payload.title || "Neue Frage",
          text: payload.text || "Bitte antworten.",
          options: Array.isArray(payload.options) ? payload.options : [],
          recipientIds: Array.isArray(payload.recipientIds) ? payload.recipientIds : null,
          excludedPlayerIds: Array.isArray(payload.excludedPlayerIds) ? payload.excludedPlayerIds : [],
          waitingText: payload.waitingText || "",
          sentText: payload.sentText || "",
          kind: payload.kind || "",
          tracksByPlayer: obj(payload.tracksByPlayer),
          assignmentsByPlayer: obj(payload.assignmentsByPlayer),
          voteDuelsByPlayer: obj(payload.voteDuelsByPlayer),
          meta: obj(payload.meta),
          createdAt: Date.now()
        };
        room.answers = new Map();
        emitPromptToPlayers();
        emitRoomState();
        if (ack) ack({ ok: true, prompt: slimPrompt(room.prompt) });
      },

      "host:reveal"(client, payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann auflösen.");
        toRoom("player:reveal", payload);
        if (ack) ack({ ok: true });
      },

      "host:resetRound"(client, _payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann Runden zurücksetzen.");
        resetRoundState();
        toRoom("player:resetRound");
        emitRoomState();
        if (ack) ack({ ok: true });
      },

      "host:setController"(client, payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann die Steuerung vergeben.");
        room.controllerId = payload.playerId || null;
        if (!room.controllerId) room.controllerActions = [];
        emitRoomState();
        if (ack) ack({ ok: true, controllerId: room.controllerId });
      },

      "host:setControllerActions"(client, payload, ack) {
        if (!isHostClient(client)) return deny(ack, "Nur der Host kann Handy-Buttons setzen.");
        room.controllerActions = Array.isArray(payload.actions)
          ? payload.actions.filter(a => a && a.id && a.label).slice(0, 18).map(a => ({
            id: String(a.id),
            label: String(a.label),
            // Art des Knopfs (bestimmt die Farbe am Handy) und ob er
            // gerade "aktiv" ist (z. B. Abspielen, solange Musik läuft).
            kind: ["play", "stop", "reveal", "next"].includes(a.kind) ? a.kind : "other",
            active: a.active === true,
            options: Array.isArray(a.options)
              ? a.options.filter(o => o && o.id && o.label).slice(0, 4).map(o => ({ id: String(o.id), label: String(o.label) }))
              : []
          }))
          : [];
        emitRoomState();
        if (ack) ack({ ok: true, controllerActions: room.controllerActions });
      },

      // ---- Spieler ---------------------------------------
      "player:join"(client, payload, ack) {
        const requestedCode = String(payload.roomCode || "").trim().toLowerCase();
        if (requestedCode && requestedCode !== room.code) {
          return ack && ack({ ok: false, code: "WRONG_ROOM", error: "Dieser Raumcode passt nicht. Bitte den Code auf dem großen Bildschirm prüfen." });
        }
        if (!room.open) {
          return ack && ack({ ok: false, code: "CLOSED", error: "Der Raum ist noch nicht offen. Der Host muss zuerst den Mehrgeräte-Modus starten." });
        }
        const name = cleanName(payload.name);
        if (!name) return ack && ack({ ok: false, code: "NO_NAME", error: "Bitte einen Namen eingeben." });

        const token = String(payload.playerToken || "").trim() || null;

        // Reihenfolge: bekanntes Token > gleicher Name (nur wenn offline) > neuer Spieler.
        let player = token ? room.playersById.get(room.playerIdByToken.get(token)) : null;
        if (!player) {
          const normalized = normalizeName(name);
          player = [...room.playersById.values()].find(p => normalizeName(p.name) === normalized && !p.clientId) || null;
        }

        if (!player) {
          player = { id: randomUUID(), token: token || randomUUID(), name, active: true, clientId: client.id, lastSeenAt: Date.now() };
          room.playersById.set(player.id, player);
        } else {
          player.name = name;
          player.clientId = client.id;
          player.lastSeenAt = Date.now();
          if (typeof payload.active === "boolean") player.active = payload.active;
          if (token) player.token = token;
        }
        room.playerIdByToken.set(player.token, player.id);

        client.data.playerId = player.id;
        members.add(client);

        if (ack) ack({
          ok: true,
          roomCode: room.code,
          playerToken: player.token,
          player: publicPlayer(player),
          prompt: promptForPlayer(player.id),
          alreadyAnswered: room.answers.has(player.id),
          controllerId: room.controllerId,
          controllerActions: room.controllerActions,
          hostOnline: hostOnline()
        });
        emitRoomState();
      },

      "player:setActive"(client, payload, ack) {
        // Der Host darf jeden pausieren, ein Handy nur sich selbst.
        const targetId = isHostClient(client) ? (payload.playerId || client.data.playerId) : client.data.playerId;
        const player = room.playersById.get(targetId);
        if (!player) return deny(ack, "Spieler nicht gefunden.");
        player.active = payload.active !== false;
        player.lastSeenAt = Date.now();
        if (ack) ack({ ok: true, player: publicPlayer(player) });
        emitRoomState();
      },

      "player:submitAnswer"(client, payload, ack) {
        // Antworten zählen immer für den Spieler dieser Verbindung.
        // Früher konnte ein Handy per playerId für andere antworten.
        const playerId = client.data.playerId || (client.canHost ? payload.playerId : null);
        const player = room.playersById.get(playerId);
        if (!player) return ack && ack({ ok: false, code: "NO_PLAYER", error: "Verbindung verloren. Bitte kurz neu beitreten." });
        if (!room.prompt) return ack && ack({ ok: false, code: "NO_PROMPT", error: "Gerade läuft keine Frage." });
        if (payload.promptId !== room.prompt.id) return ack && ack({ ok: false, code: "STALE", error: "Diese Frage ist schon vorbei." });
        if (room.answers.has(playerId)) return ack && ack({ ok: true, duplicate: true });

        const answerPayload = { playerId, playerName: player.name, promptId: payload.promptId, type: room.prompt.type, answer: payload.answer, submittedAt: Date.now() };
        room.answers.set(playerId, answerPayload);
        if (room.hostClientId) sendTo(room.hostClientId, "host:answerSubmitted", answerPayload);
        emitRoomState();
        if (ack) ack({ ok: true });
      },

      "player:controlAction"(client, payload, ack) {
        const playerId = client.data.playerId;
        if (!playerId || playerId !== room.controllerId) return deny(ack, "Du hast gerade keine Steuerung.");
        const allowed = new Set((room.controllerActions || []).flatMap(a => [a.id, ...((a.options || []).map(o => o.id))]));
        if (!allowed.has(payload.action)) return deny(ack, "Diese Steuerung ist gerade nicht verfügbar.");
        if (!room.hostClientId) return deny(ack, "Der Host ist gerade offline.");
        sendTo(room.hostClientId, "host:controlAction", { playerId, action: payload.action });
        if (ack) ack({ ok: true });
      }
    };

    return handlers;
  }

  return { createRoomHandlers };
});

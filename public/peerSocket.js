/* =========================================================
   Family Music Quiz · Handy-Leitung zum iPad (WebRTC)
   ---------------------------------------------------------
   Baut ein Objekt, das sich für player.js wie ein Socket.IO-
   Socket verhält:
     socket.on("connect" | "disconnect" | "connect_error" | <Ereignis>, fn)
     socket.emit(ereignis, daten, rueckruf)
     socket.connect() / socket.disconnect()
   Zusätzlich:
     socket.setRoom(code)   welcher Raum (= welches iPad) gemeint ist

   Unterschied zum Laptop-Server: Ohne Raumcode weiß das Handy
   nicht, wen es anrufen soll. Darum verbindet es sich erst,
   wenn ein Code bekannt ist (aus dem QR-Code oder eingetippt).

   Robustheit:
   - Ping alle 4 s. Kommt 12 s lang nichts zurück, gilt die
     Leitung als tot und wird neu aufgebaut. Wichtig nach dem
     Entsperren des Handys: iOS meldet tote Leitungen nicht.
   - Nachrichten, die gesendet werden, solange keine Leitung
     steht, werden gesammelt und nach dem Verbinden verschickt.
   - Rückrufe, auf die nie eine Antwort kommt, melden nach 15 s
     einen Fehler. player.js setzt dann den Absenden-Knopf zurück.
   ========================================================= */

(() => {
  "use strict";
  const N = window.FMQNet;

  const PING_EVERY_MS = 4000;
  const DEAD_AFTER_MS = 12000;
  const ACK_TIMEOUT_MS = 15000;
  const CONNECT_TIMEOUT_MS = 12000;

  N.createPeerSocket = () => {
    const listeners = new Map();
    const fire = (event, data) => {
      for (const fn of listeners.get(event) || []) {
        try { fn(data); } catch (e) { console.error("[FMQ handy]", event, e); }
      }
    };

    let roomCode = "";
    let peer = null;
    let conn = null;
    let manualOff = false;
    let attempt = 0;
    let retryTimer = null;
    let pingTimer = null;
    let connectTimer = null;
    let lastSeen = 0;
    // true, solange ein Verbindungsaufbau läuft. Ohne diese Sperre
    // starten setRoom() und emit() kurz nacheinander je einen
    // eigenen Aufbau, der zweite wirft den ersten weg, und die
    // erste Nachricht (meist der Beitritt) geht verloren.
    let opening = false;
    let ackSeq = 0;
    const pendingAcks = new Map(); // Nummer → { fn, timer }
    const outbox = [];             // Umschläge, die auf eine Leitung warten

    // ---- Rückrufe --------------------------------------------
    const settleAck = (id, result) => {
      const entry = pendingAcks.get(id);
      if (!entry) return;
      pendingAcks.delete(id);
      clearTimeout(entry.timer);
      try { entry.fn(result); } catch (e) { console.error(e); }
    };
    const failAllAcks = (code, error) => {
      for (const id of [...pendingAcks.keys()]) settleAck(id, { ok: false, code, error });
    };

    // ---- Eingehende Nachrichten ------------------------------
    const decode = N.createDecoder(msg => {
      lastSeen = Date.now();
      if (msg.k === "pong") return;
      if (msg.k === "a") { settleAck(msg.a, msg.d); return; }
      if (msg.k === "e") fire(msg.ev, msg.d);
    });

    const flushOutbox = () => {
      while (outbox.length && conn && conn.open) N.sendOver(conn, outbox.shift());
    };

    // ---- Leitung auf- und abbauen ----------------------------
    const isOpen = () => !!(conn && conn.open);

    const dropConnection = (reason) => {
      clearInterval(pingTimer);
      clearTimeout(connectTimer);
      const wasOpen = isOpen();
      const c = conn;
      conn = null;
      if (c) { try { c.close(); } catch {} }
      failAllAcks("DISCONNECTED", "Verbindung kurz weg. Bitte nochmal tippen.");
      if (wasOpen) { socket.connected = false; fire("disconnect", reason); }
    };

    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      if (manualOff || !roomCode) return;
      // 0,5 s, 1 s, 2 s, dann alle 4 s. Schnell genug fürs Gefühl,
      // ohne den Vermittlungsserver zu bombardieren.
      const delay = Math.min(500 * 2 ** attempt, 4000);
      attempt++;
      retryTimer = setTimeout(openConnection, delay);
    };

    /** Eigene Anmeldung beim Vermittlungsserver (zufälliger Name). */
    const ensurePeer = () => new Promise((resolve, reject) => {
      if (peer && !peer.destroyed && peer.open) return resolve(peer);
      if (peer && !peer.destroyed && peer.disconnected) {
        try { peer.reconnect(); } catch { peer.destroy(); peer = null; }
      }
      if (!peer || peer.destroyed) {
        peer = new window.Peer(N.peerOptions());
        // Fehler, die die ganze Anmeldung betreffen. Der wichtigste:
        // "peer-unavailable" = unter diesem Raumcode ist kein iPad da.
        peer.on("error", err => {
          const type = err && err.type;
          if (type === "peer-unavailable") {
            const text = `Raum „${roomCode}" nicht gefunden. Code prüfen – oder der große Bildschirm ist gerade aus.`;
            fire("connect_error", { fmqMessage: text, code: "NO_HOST" });
            failAllAcks("NO_HOST", text);
            dropConnection("no-host");
            scheduleRetry();
            return;
          }
          fire("connect_error", { fmqMessage: "Keine Verbindung zur Vermittlung. Internet da?", code: type });
          if (["network", "server-error", "socket-error", "socket-closed", "disconnected"].includes(type)) {
            try { peer.destroy(); } catch {}
            peer = null;
            dropConnection("peer-error");
            scheduleRetry();
          }
        });
      }
      const p = peer;
      if (p.open) return resolve(p);
      const onOpen = () => { p.off("error", onErr); resolve(p); };
      const onErr = err => { p.off("open", onOpen); reject(err); };
      p.once("open", onOpen);
      p.once("error", onErr);
    });

    const openConnection = async () => {
      clearTimeout(retryTimer);
      if (manualOff || !roomCode || isOpen() || opening) return;
      opening = true;
      const targetRoom = roomCode;
      let p;
      try { p = await ensurePeer(); } catch { opening = false; scheduleRetry(); return; }
      if (manualOff || !roomCode || isOpen()) { opening = false; return; }
      // Raum wurde während des Wartens gewechselt: setRoom hat schon
      // einen neuen Aufbau gestartet, dieser hier ist überholt.
      if (targetRoom !== roomCode) return;

      // Alte, halb offene Leitung wegräumen, bevor eine neue entsteht.
      if (conn) dropConnection("replace");

      const c = p.connect(N.peerIdForRoom(roomCode), { reliable: true, serialization: "raw" });
      conn = c;
      opening = false; // ab hier schützt "conn" vor Doppelaufbau (s. emit)

      // Bleibt der Verbindungsaufbau hängen (ICE findet keinen Weg),
      // nach 12 s abbrechen und neu versuchen.
      connectTimer = setTimeout(() => {
        if (conn === c && !c.open) {
          fire("connect_error", { fmqMessage: "Verbindung zum großen Bildschirm klappt gerade nicht. Neuer Versuch …", code: "TIMEOUT" });
          dropConnection("timeout");
          scheduleRetry();
        }
      }, CONNECT_TIMEOUT_MS);

      c.on("open", () => {
        if (conn !== c) return;
        clearTimeout(connectTimer);
        attempt = 0;
        lastSeen = Date.now();
        socket.connected = true;
        // Lebenszeichen und Totmannschalter.
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (conn !== c) return;
          if (Date.now() - lastSeen > DEAD_AFTER_MS) { dropConnection("silent"); scheduleRetry(); return; }
          N.sendOver(c, { k: "ping" });
        }, PING_EVERY_MS);
        fire("connect");
        flushOutbox();
      });
      c.on("data", decode);
      const onGone = () => {
        if (conn !== c) return;
        dropConnection("closed");
        scheduleRetry();
      };
      c.on("close", onGone);
      c.on("error", onGone);
    };

    // ---- Öffentliche Schnittstelle ---------------------------
    const socket = {
      connected: false,
      transport: "peer",

      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return socket;
      },

      emit(event, data, ack) {
        const envelope = { k: "e", ev: event, d: data };
        if (typeof ack === "function") {
          const id = ++ackSeq;
          envelope.a = id;
          const timer = setTimeout(() => settleAck(id, { ok: false, code: "TIMEOUT", error: "Keine Antwort vom großen Bildschirm. Bitte nochmal." }), ACK_TIMEOUT_MS);
          pendingAcks.set(id, { fn: ack, timer });
        }
        if (isOpen()) N.sendOver(conn, envelope);
        else {
          outbox.push(envelope);
          // Läuft schon ein Aufbau (conn da, aber noch nicht offen),
          // nur einreihen. Die Nachricht geht beim "open" raus.
          if (!conn) openConnection();
        }
        return socket;
      },

      /** Raum wählen. Ein neuer Code baut die Leitung neu auf. */
      setRoom(code) {
        const next = String(code || "").trim().toLowerCase();
        if (next === roomCode) { if (!isOpen() && !conn) openConnection(); return; }
        roomCode = next;
        attempt = 0;
        opening = false; // ein laufender Aufbau zum alten Raum zählt nicht mehr
        dropConnection("room-change");
        if (roomCode) openConnection();
      },

      connect() {
        manualOff = false;
        attempt = 0;
        openConnection();
        return socket;
      },

      disconnect() {
        manualOff = true;
        clearTimeout(retryTimer);
        outbox.length = 0;
        dropConnection("manual");
        return socket;
      }
    };

    // Handy wird entsperrt oder der Tab kommt zurück: sofort prüfen,
    // statt auf den nächsten Ping-Takt zu warten.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || manualOff || !roomCode) return;
      attempt = 0;
      if (!isOpen()) { openConnection(); return; }
      // Leitung sieht offen aus. Nach dem Sperren ist sie oft trotzdem
      // tot. Einmal anpingen und 3 s auf irgendein Lebenszeichen warten.
      const resumedAt = Date.now();
      const c = conn;
      N.sendOver(c, { k: "ping" });
      setTimeout(() => {
        if (conn === c && lastSeen < resumedAt) { dropConnection("resume"); openConnection(); }
      }, 3000);
    });
    window.addEventListener("online", () => { if (!isOpen()) { attempt = 0; openConnection(); } });

    return socket;
  };
})();

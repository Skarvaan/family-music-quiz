window.FMQ = window.FMQ || {};
var FMQ = window.FMQ;

/* =========================================================
   Family Music Quiz · iPad als Server (WebRTC, ohne Laptop)
   ---------------------------------------------------------
   So funktioniert es:
   1. Das iPad öffnet die Spielseite (z. B. von GitHub Pages).
   2. Es meldet sich beim kostenlosen PeerJS-Vermittlungsserver
      unter einem Namen an, der aus dem Raumcode entsteht
      (z. B. "bgnf-fmq-abc123").
   3. Die Handys scannen den QR-Code, öffnen die Handy-Seite und
      fragen beim Vermittlungsserver nach genau diesem Namen.
   4. Danach reden iPad und Handy DIREKT miteinander. Der
      Vermittlungsserver sieht keine Spielinhalte, er stellt nur
      einmal die Verbindung her (wie eine Telefonvermittlung).

   Die Raumlogik selbst (wer ist drin, welche Frage läuft, wer
   hat geantwortet) ist dieselbe wie im Node-Server:
   js/net/roomHub.js. Diese Datei verbindet sie nur mit WebRTC.

   Nach außen sieht das Ergebnis aus wie ein Socket.IO-Socket
   (on/emit mit Rückruf). Darum muss multiplayer.js kaum wissen,
   ob gerade Laptop-Server oder iPad-Betrieb läuft.
   ========================================================= */

(() => {
  "use strict";
  const N = window.FMQNet;

  // Wie lange ein gespeicherter Raum nach einem Reload noch gilt.
  // Ein Spieleabend dauert selten länger, danach lieber frisch.
  const RESTORE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const STORAGE_KEY = "fmq_peer_room";
  // Kommt von einem Handy so lange gar nichts (nicht mal ein Ping),
  // gilt es als weg. Handys pingen alle 4 Sekunden.
  const CLIENT_SILENCE_MS = 20000;

  const loadSaved = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Date.now() - (saved.savedAt || 0) < RESTORE_MAX_AGE_MS) return saved;
    } catch { /* kaputter Eintrag, ignorieren */ }
    return null;
  };

  /** Adresse, die die Handys öffnen. Liegt neben index.html in public/. */
  FMQ.peerJoinUrl = code => {
    const url = new URL("public/player.html", FMQ.REDIRECT_URI);
    url.searchParams.set("room", code);
    return N.carryParams(url.toString());
  };

  /**
   * Bildschirm wach halten. Geht das iPad in den Ruhezustand,
   * reißen alle WebRTC-Verbindungen ab. Safari kann das seit iOS 16.4.
   * Muss nach jedem Zurückholen des Tabs neu angefordert werden.
   */
  let wakeLock = null;
  FMQ.keepScreenOn = async () => {
    try {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      if (wakeLock && !wakeLock.released) return;
      wakeLock = await navigator.wakeLock.request("screen");
    } catch { /* nicht erlaubt oder nicht unterstützt: dann eben Auto-Sperre in den Einstellungen aus */ }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && FMQ.isMultiDevice?.()) FMQ.keepScreenOn();
  });

  /**
   * Baut den Host auf und liefert ein socket-ähnliches Objekt.
   * Wird von FMQ.enableMultiDeviceMode genau einmal aufgerufen.
   */
  FMQ.createPeerHostSocket = () => {
    if (typeof window.Peer !== "function") {
      throw new Error("PeerJS fehlt (vendor/peerjs.min.js). Ohne das geht der Mehrgeräte-Modus ohne Laptop nicht.");
    }

    // ---- socket-ähnliche Hülle für multiplayer.js -----------
    const listeners = new Map();
    const fire = (event, data) => {
      for (const fn of listeners.get(event) || []) {
        try { fn(data); } catch (e) { console.error("[FMQ host]", event, e); }
      }
    };

    let peer = null;
    let registerAttempt = 0;
    let registerTimer = null;

    const save = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...hub.persistable(), savedAt: Date.now() })); } catch { /* Speicher voll/gesperrt */ }
    };

    const hub = FMQ.createRoomHub({
      restore: loadSaved(),
      getHostUrls: code => [FMQ.peerJoinUrl(code)],
      onChange: save,
      // Neuer Raumcode = neuer Name beim Vermittlungsserver.
      onCodeChange: code => { save(); registerPeer(code); }
    });

    // Das iPad selbst ist ebenfalls ein "Client" der Raumlogik,
    // nur eben ohne Leitung dazwischen.
    const localClient = { id: "host-local", canHost: true, data: {}, send: (event, data) => fire(event, data) };
    hub.connect(localClient);

    const socket = {
      connected: false,
      transport: "peer",
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return socket;
      },
      off(event, fn) {
        listeners.set(event, (listeners.get(event) || []).filter(f => f !== fn));
        return socket;
      },
      /** Wie socket.emit: geht direkt in die Raumlogik, Antwort asynchron. */
      emit(event, payload, ack) {
        // Asynchron wie bei einem echten Netzwerk. Sonst würden
        // Rückrufe mitten in laufendem Rendercode feuern.
        Promise.resolve().then(() => hub.handle(localClient, event, payload, typeof ack === "function" ? ack : undefined));
        return socket;
      },
      get roomCode() { return hub.code; },
      /** Peer-Status für die Lobby-Anzeige. */
      status: "starting"
    };

    // ---- Verbindung zu einem Handy ---------------------------
    const attachConnection = conn => {
      const client = {
        id: "peer-" + conn.connectionId,
        canHost: false, // Handys dürfen keine host:*-Ereignisse auslösen
        data: {},
        send: (event, data) => N.sendOver(conn, { k: "e", ev: event, d: data })
      };
      let attached = false;
      let lastSeen = Date.now();
      let watchdog = null;

      const detach = () => {
        if (!attached) return;
        attached = false;
        clearInterval(watchdog);
        hub.disconnect(client);
      };

      const decode = N.createDecoder(msg => {
        lastSeen = Date.now();
        if (msg.k === "ping") { N.sendOver(conn, { k: "pong" }); return; }
        if (msg.k !== "e") return;
        const ack = msg.a != null ? res => N.sendOver(conn, { k: "a", a: msg.a, d: res }) : undefined;
        hub.handle(client, msg.ev, msg.d, ack);
      });

      const onOpen = () => {
        if (attached) return;
        attached = true;
        lastSeen = Date.now();
        hub.connect(client);
        // Ein Handy, das einfach verschwindet (Akku leer, WLAN weg),
        // schließt seine Leitung nicht sauber. Ohne Wachhund stünde
        // es ewig als "online" in der Lobby.
        watchdog = setInterval(() => {
          if (Date.now() - lastSeen > CLIENT_SILENCE_MS) { try { conn.close(); } catch {} detach(); }
        }, 5000);
      };

      conn.on("open", onOpen);
      if (conn.open) onOpen();
      conn.on("data", decode);
      conn.on("close", detach);
      conn.on("error", detach);
    };

    // ---- Anmeldung beim Vermittlungsserver -------------------
    const setStatus = (status, connected) => {
      socket.status = status;
      const was = socket.connected;
      socket.connected = connected;
      if (connected && !was) fire("connect");
      if (!connected && was) fire("disconnect");
      FMQ.renderDeviceModePanel?.();
    };

    const retryRegister = (code, delayMs) => {
      clearTimeout(registerTimer);
      registerTimer = setTimeout(() => { if (hub.code === code) registerPeer(code); }, delayMs);
    };

    function registerPeer(code) {
      clearTimeout(registerTimer);
      if (peer) { try { peer.destroy(); } catch {} peer = null; }
      setStatus("starting", false);

      const thisPeer = new window.Peer(N.peerIdForRoom(code), N.peerOptions());
      peer = thisPeer;

      thisPeer.on("open", () => {
        if (peer !== thisPeer) return;
        registerAttempt = 0;
        setStatus("online", true);
      });

      thisPeer.on("connection", conn => attachConnection(conn));

      // Verbindung zum Vermittlungsserver weg (z. B. kurz Funkloch).
      // Bestehende Handy-Leitungen laufen meistens weiter, neue
      // Handys kommen aber erst nach dem Wiederanmelden rein.
      thisPeer.on("disconnected", () => {
        if (peer !== thisPeer || thisPeer.destroyed) return;
        setStatus("reconnecting", false);
        setTimeout(() => { if (peer === thisPeer && !thisPeer.destroyed) { try { thisPeer.reconnect(); } catch { registerPeer(code); } } }, 1500);
      });

      thisPeer.on("error", err => {
        if (peer !== thisPeer) return;
        const type = err && err.type;
        // "peer-unavailable" betrifft nur ausgehende Verbindungen,
        // die der Host nie aufbaut. Ignorieren.
        if (type === "peer-unavailable") return;
        registerAttempt++;
        const delay = Math.min(2000 * registerAttempt, 10000);
        if (type === "unavailable-id") {
          // Nach einem Reload hält der Server den alten Namen noch
          // ein paar Sekunden fest. Einfach geduldig neu versuchen.
          FMQ.showMultiDeviceHint?.("Raum wird wieder aufgebaut … (alter Tab ist noch angemeldet)");
        } else {
          FMQ.showMultiDeviceHint?.(`Vermittlung gerade nicht erreichbar (${type || "Fehler"}). Neuer Versuch …`);
        }
        setStatus("reconnecting", false);
        retryRegister(code, delay);
      });
    }

    // Raum direkt speichern, damit ein Reload denselben Code behält.
    save();
    registerPeer(hub.code);

    // Kommt das iPad aus dem Hintergrund (z. B. nach kurzem Wechsel
    // in die Spotify-App), Anmeldung prüfen und notfalls erneuern.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !peer) return;
      if (peer.destroyed) registerPeer(hub.code);
      else if (peer.disconnected) { try { peer.reconnect(); } catch { registerPeer(hub.code); } }
    });

    return socket;
  };
})();

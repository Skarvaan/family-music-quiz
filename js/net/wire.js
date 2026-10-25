/* =========================================================
   Family Music Quiz · Leitungsformat für den WebRTC-Betrieb
   ---------------------------------------------------------
   Wird vom iPad (Host) UND von den Handys geladen.

   Warum ein eigenes Format?
   - Socket.IO kennt "emit mit Rückruf" (ack). WebRTC-Datenkanäle
     kennen nur "Nachricht rein, Nachricht raus". Dieses Format
     baut die Rückrufe nach, damit player.js und die Host-Logik
     unverändert weiterarbeiten können.
   - Safari begrenzt einzelne WebRTC-Nachrichten auf rund 64 KB.
     Bei den Song-Challenges bekommt jedes Handy bis zu 300 Tracks
     seiner Playlist geschickt, das kann größer werden. Deshalb
     werden große Nachrichten in Stücke geteilt und auf der
     anderen Seite wieder zusammengesetzt.

   Umschläge (alles JSON-Text):
     { k:"e", ev, d, a? }   Ereignis, a = Rückruf-Nummer (optional)
     { k:"a", a, d }        Antwort auf Rückruf a
     { k:"ping" } / { k:"pong" }   Lebenszeichen
     { k:"c", id, i, n, s } Stück i von n einer großen Nachricht
   ========================================================= */

window.FMQNet = window.FMQNet || {};

(() => {
  "use strict";
  const N = window.FMQNet;

  // 8000 Zeichen pro Stück. Selbst wenn jedes Zeichen ein Umlaut
  // (3 Byte in UTF-8) wäre und JSON es zusätzlich escapen müsste,
  // bleiben wir unter Safaris Grenze.
  N.CHUNK_CHARS = 8000;

  // Präfix für die Peer-ID auf dem Vermittlungsserver. Der Server
  // ist öffentlich und wird weltweit geteilt, darum ein möglichst
  // eigener Name, damit wir nie mit fremden Apps kollidieren.
  N.PEER_PREFIX = "bgnf-fmq-";

  N.peerIdForRoom = code => N.PEER_PREFIX + String(code || "").trim().toLowerCase();

  /**
   * Optionen für new Peer(...).
   * Normalfall: PeerJS-Cloud (kostenlos, keine Einrichtung).
   * Für Tests oder einen eigenen Vermittlungsserver:
   *   ?peerserver=127.0.0.1:9000  an die Adresse hängen.
   */
  N.peerOptions = () => {
    const opts = { debug: 1 };
    const raw = new URLSearchParams(location.search).get("peerserver");
    if (raw) {
      const [host, port] = raw.split(":");
      opts.host = host;
      opts.port = Number(port) || 9000;
      opts.path = "/";
      opts.secure = location.protocol === "https:";
    }
    return opts;
  };

  /** Hängt Test-Parameter (eigener Peer-Server, Transport) an eine Beitritts-URL. */
  N.carryParams = url => {
    const here = new URLSearchParams(location.search);
    const u = new URL(url);
    for (const key of ["peerserver", "net"]) if (here.get(key)) u.searchParams.set(key, here.get(key));
    return u.toString();
  };

  /** Objekt → Liste von Textnachrichten (meist genau eine). */
  N.encode = obj => {
    const text = JSON.stringify(obj);
    if (text.length <= N.CHUNK_CHARS) return [text];
    const id = Math.random().toString(36).slice(2, 10);
    const n = Math.ceil(text.length / N.CHUNK_CHARS);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(JSON.stringify({ k: "c", id, i, n, s: text.slice(i * N.CHUNK_CHARS, (i + 1) * N.CHUNK_CHARS) }));
    }
    return out;
  };

  /**
   * Gegenstück zu encode. Liefert eine Funktion, die rohe
   * Nachrichten annimmt und fertige Objekte an onMessage gibt.
   */
  N.createDecoder = onMessage => {
    const partial = new Map(); // id → { n, parts[], at }
    return raw => {
      let msg;
      try { msg = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.k !== "c") { onMessage(msg); return; }

      // Stückchen sammeln. Reihenfolge ist im zuverlässigen Kanal
      // garantiert, wir verlassen uns trotzdem auf den Index.
      let entry = partial.get(msg.id);
      if (!entry) {
        entry = { n: msg.n, parts: new Array(msg.n), got: 0, at: Date.now() };
        partial.set(msg.id, entry);
      }
      if (entry.parts[msg.i] === undefined) { entry.parts[msg.i] = msg.s; entry.got++; }
      if (entry.got === entry.n) {
        partial.delete(msg.id);
        try { onMessage(JSON.parse(entry.parts.join(""))); } catch { /* kaputt angekommen, ignorieren */ }
      }
      // Liegengebliebene Reste (Verbindung riss mitten im Senden ab) aufräumen.
      const now = Date.now();
      for (const [id, e] of partial) if (now - e.at > 60000) partial.delete(id);
    };
  };

  /** Sendet ein Objekt über eine PeerJS-DataConnection, stückelt bei Bedarf. */
  N.sendOver = (conn, obj) => {
    if (!conn || !conn.open) return false;
    try {
      for (const part of N.encode(obj)) conn.send(part);
      return true;
    } catch {
      return false;
    }
  };
})();

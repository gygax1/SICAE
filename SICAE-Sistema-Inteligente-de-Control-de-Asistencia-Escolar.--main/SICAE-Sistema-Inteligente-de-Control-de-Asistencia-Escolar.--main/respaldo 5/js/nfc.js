/* ===============================
   ===== NFC VIA API (POLLING) ===
=============================== */

let timerNFC = null;
let escuchando = false;

let ultimoUID = null;
let ultimoTiempo = 0;
const COOLDOWN_MS = 450;
const POLL_NFC_MS = 900;

/* ===============================
   ===== INICIAR NFC
=============================== */
function iniciarNFCControlado({ onUID, onTimeout, onError, onStatus, onHeartbeat } = {}) {
  if (escuchando) {
    console.info("[NFC] Ya estaba escuchando");
    return;
  }

  if (typeof obtenerEventoNFCPendiente !== "function") {
    console.error("[NFC] API NFC no disponible");
    if (typeof onError === "function") onError("API_NFC_NO_DISPONIBLE");
    if (typeof onStatus === "function") onStatus("ERROR_NO_API");
    return;
  }

  detenerNFC();
  escuchando = true;

  if (typeof onStatus === "function") {
    onStatus("SUBSCRIBED");
  }

  const poll = async () => {
    if (!escuchando) return;

    try {
      const evento = await obtenerEventoNFCPendiente();
      if (!evento) return;

      const uid = normalizarUID(evento.uid);
      const eventId = evento.id;

      if (!uid || !eventId) {
        console.warn("[NFC] Evento incompleto recibido", evento);
        return;
      }

      if (typeof onHeartbeat === "function") {
        onHeartbeat({ ts: Date.now(), uid, eventId });
      }

      const ahora = Date.now();
      if (uid === ultimoUID && ahora - ultimoTiempo < COOLDOWN_MS) {
        console.info(`[NFC] UID ignorado por cooldown uid=${uid}`);
        return;
      }

      ultimoUID = uid;
      ultimoTiempo = ahora;

      if (typeof onUID === "function") {
        console.info(`[NFC] UID aceptado uid=${uid}`);
        onUID(uid);
      }
    } catch (err) {
      console.error("[NFC] Error en polling:", err);

      if (typeof onStatus === "function") {
        onStatus("CHANNEL_ERROR");
      }

      if (typeof onError === "function") {
        onError(err?.message || err);
      }
    }
  };

  timerNFC = setInterval(poll, POLL_NFC_MS);
  poll();

  if (typeof onTimeout === "function") {
    setTimeout(() => {
      if (escuchando) {
        console.warn("[NFC] Timeout de lectura");
        onTimeout();
      }
    }, 12000);
  }
}

/* ===============================
   ===== DETENER NFC
=============================== */
function detenerNFC() {
  if (timerNFC) {
    clearInterval(timerNFC);
    timerNFC = null;
  }

  escuchando = false;
  ultimoUID = null;
  ultimoTiempo = 0;
  console.info("[NFC] Lectura detenida");
}

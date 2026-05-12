/* ======================================================
   ===== ASISTENCIAS ALUMNOS (STORAGE + REALTIME) =====
====================================================== */

(function initAsistenciasSync() {

  const bc = typeof createAppBroadcastChannel === "function"
    ? createAppBroadcastChannel("victory-data")
    : new BroadcastChannel("victory-data");

  bc.onmessage = e => {
    if (e.data === "asistencias") {
      cargarAsistencias();
      actualizarContador();
    }
  };

  window.addEventListener("storage", e => {
    const keyOk = typeof isAppStorageKeyMatch === "function"
      ? isAppStorageKeyMatch(e.key, "asistencias")
      : (e.key === "asistencias");
    if (keyOk) {
      cargarAsistencias();
      actualizarContador();
    }
  });

})();

/* ======================================================
   ===== UTILIDADES =====================================
====================================================== */

/**
 * Devuelve timestamp seguro (number)
 * Soporta number o ISO string
 */
function obtenerTimestampSeguro(a) {
  if (!a || !a.entrada_ts) return 0;

  if (typeof a.entrada_ts === "number") {
    return a.entrada_ts;
  }

  if (typeof a.entrada_ts === "string") {
    const t = new Date(a.entrada_ts).getTime();
    return isNaN(t) ? 0 : t;
  }

  return 0;
}

/**
 * Convierte timestamp (number o ISO) a hora formateada
 */
function formatearHoraTS(ts) {

  if (!ts) return "-";

  const h = horaDesdeTS(ts);
  return h || "-";
}

function aplicarFiltroHorarioDocente(lista = []) {
  const filtro = typeof window.filtroAsistenciaHorarioDocente === "function"
    ? window.filtroAsistenciaHorarioDocente
    : null;

  if (!filtro) return lista;

  return lista.filter(item => {
    try {
      return filtro(item) !== false;
    } catch (_) {
      return true;
    }
  });
}

/* ======================================================
   ===== CARGAR TABLA ===================================
====================================================== */

function cargarAsistencias() {

  const asistencias = obtenerAsistencias();
  const hoyFecha = hoy();

  const tbody = document.getElementById("tablaAsistencias");
  if (!tbody || !Array.isArray(asistencias)) return;

  tbody.innerHTML = "";

  const listaBase = asistencias
    .filter(a =>
      a &&
      a.fecha === hoyFecha &&
      typeof a.nombre === "string"
    );

  aplicarFiltroHorarioDocente(listaBase)
    .sort((a, b) =>
      obtenerTimestampSeguro(b) - obtenerTimestampSeguro(a)
    )
    .forEach(a => {

      const tr = document.createElement("tr");

      const tdNombre = document.createElement("td");
      tdNombre.textContent = a.nombre || "Alumno";

      const tdMatricula = document.createElement("td");
      tdMatricula.textContent = a.matricula || a.alumno_matricula || "-";

      const tdGradoGrupo = document.createElement("td");
      const grado = String(a.grado || "").trim();
      const grupo = String(a.grupo || "").trim();
      tdGradoGrupo.textContent = (grado || grupo)
        ? `${grado}${grado && grupo ? " / " : ""}${grupo}`
        : (a.grado_grupo || "-");

      const tdEntrada = document.createElement("td");
      tdEntrada.textContent = formatearHoraTS(a.entrada_ts);

      const tdSalida = document.createElement("td");
      tdSalida.textContent = formatearHoraTS(a.salida_ts);

      tr.append(tdNombre, tdMatricula, tdGradoGrupo, tdEntrada, tdSalida);
      tbody.appendChild(tr);
    });
}

/* ======================================================
   ===== CONTADOR AFORO =================================
====================================================== */

function actualizarContador() {

  const asistencias = obtenerAsistencias();
  const hoyFecha = hoy();

  if (!Array.isArray(asistencias)) return;

  const listaBase = asistencias.filter(a =>
    a &&
    a.fecha === hoyFecha &&
    a.entrada_ts &&
    !a.salida_ts
  );
  const dentro = aplicarFiltroHorarioDocente(listaBase).length;

  const contador = document.getElementById("contadorAforo");
  if (!contador) return;

  const strong = contador.querySelector("strong");

  if (strong) {
    strong.textContent = dentro;
  } else {
    contador.textContent = `Dentro: ${dentro}`;
  }
}

/* ======================================================
   ===== NOTIFICADOR GLOBAL =============================
====================================================== */

function notificarCambioAsistencias() {
  const bc = typeof createAppBroadcastChannel === "function"
    ? createAppBroadcastChannel("victory-data")
    : new BroadcastChannel("victory-data");
  bc.postMessage("asistencias");
}

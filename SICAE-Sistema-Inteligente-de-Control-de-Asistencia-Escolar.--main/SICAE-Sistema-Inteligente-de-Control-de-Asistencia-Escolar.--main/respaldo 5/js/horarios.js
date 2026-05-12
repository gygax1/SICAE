/* ======================================================
   ===== HORARIOS (MAPEO DOCENTE / GRUPO) ===============
====================================================== */

(() => {

const HORARIOS_STORAGE_KEY = "horarios_mapa_v1";
const HORARIOS_CHANNEL_NAME = "horarios-mapa";
const HORARIOS_REMOTE_TABLE = "/horarios_mapa";
const HORARIOS_REMOTE_ID = "main";
const DIAS_SEMANA = ["LU", "MA", "MI", "JU", "VI"];
const DEFAULT_PERIODOS = [
  { numero: 1, inicio: "07:00", fin: "07:50" },
  { numero: 2, inicio: "07:50", fin: "08:40" },
  { numero: 3, inicio: "08:40", fin: "09:30" },
  { numero: 4, inicio: "09:50", fin: "10:40" },
  { numero: 5, inicio: "10:40", fin: "11:30" },
  { numero: 6, inicio: "11:30", fin: "12:20" },
  { numero: 7, inicio: "12:20", fin: "13:10" },
  { numero: 8, inicio: "13:10", fin: "14:00" }
];

const getStore = typeof storageGetItem === "function"
  ? storageGetItem
  : key => localStorage.getItem(key);
const setStore = typeof storageSetItem === "function"
  ? storageSetItem
  : (key, value) => localStorage.setItem(key, value);
const createChannel = typeof createAppBroadcastChannel === "function"
  ? createAppBroadcastChannel
  : base => new BroadcastChannel(base);

let pushTimerId = null;
let pushPendiente = null;
let pushEnCurso = false;
let syncIntervalId = null;
let syncEnCurso = false;
let syncConfig = {
  intervalMs: 10000,
  prefer: "newer"
};
let eventosSyncLigados = false;

let bc = null;
try {
  bc = createChannel(HORARIOS_CHANNEL_NAME);
} catch {
  bc = null;
}

function uidSimple() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normText(value) {
  return String(value || "").trim();
}

function normUpper(value) {
  return normText(value).toUpperCase();
}

function normLower(value) {
  return normText(value).toLowerCase();
}

function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function diaCodeFromDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDay();
  if (day === 1) return "LU";
  if (day === 2) return "MA";
  if (day === 3) return "MI";
  if (day === 4) return "JU";
  if (day === 5) return "VI";
  return "";
}

function hmToMinutes(hm = "") {
  const txt = String(hm || "").trim();
  const match = /^(\d{2}):(\d{2})$/.exec(txt);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return (hh * 60) + mm;
}

function minutesNow(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return (d.getHours() * 60) + d.getMinutes();
}

function grupoKey(grado, grupo) {
  const g = normUpper(grado);
  const gr = normUpper(grupo);
  if (!g && !gr) return "";
  return `${g}|${gr}`;
}

function grupoLabelFromKey(key = "") {
  const parts = String(key || "").split("|");
  const grado = normUpper(parts[0] || "");
  const grupo = normUpper(parts[1] || "");
  if (!grado && !grupo) return "";
  return `${grado}${grado && grupo ? " " : ""}${grupo}`;
}

function defaultMapa() {
  return {
    version: 1,
    config: {
      dias: [...DIAS_SEMANA],
      periodos: DEFAULT_PERIODOS.map(p => ({ ...p }))
    },
    grupos: [],
    docentes: [],
    salones: [],
    clases: [],
    updated_at: new Date().toISOString()
  };
}

function normPeriodo(item = {}, index = 0) {
  const numero = Number(item.numero || index + 1);
  const inicio = normText(item.inicio || "");
  const fin = normText(item.fin || "");
  return {
    numero: Number.isFinite(numero) && numero > 0 ? numero : index + 1,
    inicio,
    fin
  };
}

function normGrupo(item = {}) {
  const keyDirect = normUpper(item.key || "");
  const key = keyDirect || grupoKey(item.grado, item.grupo);
  const label = normText(item.label || item.nombre || grupoLabelFromKey(key));
  const [grado = "", grupo = ""] = key.split("|");
  return {
    key,
    label: label || grupoLabelFromKey(key),
    grado: normUpper(item.grado || grado || ""),
    grupo: normUpper(item.grupo || grupo || "")
  };
}

function normDocente(item = {}) {
  const username = normLower(item.username || item.usuario || "");
  const nombre = normText(item.nombre || item.full_name || "");
  const idRaw = normText(item.id || "");
  const id = idRaw || username || slug(nombre) || uidSimple();
  return {
    id,
    username,
    nombre: nombre || username || id
  };
}

function normSalon(item = {}) {
  const nombre = normText(item.nombre || item.name || "");
  const idRaw = normText(item.id || "");
  const id = idRaw || slug(nombre) || uidSimple();
  return {
    id,
    nombre: nombre || id,
    lector_id: normText(item.lector_id || item.lector || item.device_id || "")
  };
}

function normClase(item = {}) {
  const key = normUpper(item.grupo_key || item.group_key || "");
  const label = normText(item.grupo_label || item.group_label || grupoLabelFromKey(key));
  const dia = normUpper(item.dia || item.day || "");
  const periodo = Number(item.periodo || item.slot || 0);
  return {
    id: normText(item.id || "") || uidSimple(),
    grupo_key: key,
    grupo_label: label || grupoLabelFromKey(key),
    dia: DIAS_SEMANA.includes(dia) ? dia : "",
    periodo: Number.isFinite(periodo) ? periodo : 0,
    materia: normText(item.materia || item.subject || ""),
    docente_id: normText(item.docente_id || ""),
    docente_nombre: normText(item.docente_nombre || item.docente || ""),
    docente_username: normLower(item.docente_username || item.usuario_docente || ""),
    salon_id: normText(item.salon_id || ""),
    salon_nombre: normText(item.salon_nombre || item.salon || ""),
    lector_id: normText(item.lector_id || item.reader_id || item.device_id || ""),
    updated_at: normText(item.updated_at || "") || new Date().toISOString()
  };
}

function normalizarMapa(raw = {}) {
  const base = defaultMapa();
  const map = raw && typeof raw === "object" ? raw : {};

  const periodosRaw = Array.isArray(map?.config?.periodos) ? map.config.periodos : base.config.periodos;
  const periodos = periodosRaw.map((p, idx) => normPeriodo(p, idx));

  const grupos = Array.isArray(map.grupos)
    ? map.grupos.map(normGrupo).filter(g => g.key)
    : [];
  const docentes = Array.isArray(map.docentes)
    ? map.docentes.map(normDocente).filter(d => d.id)
    : [];
  const salones = Array.isArray(map.salones)
    ? map.salones.map(normSalon).filter(s => s.id)
    : [];
  const clases = Array.isArray(map.clases)
    ? map.clases.map(normClase).filter(c => c.id && c.grupo_key && c.dia && c.periodo > 0)
    : [];

  const gruposMap = new Map(grupos.map(g => [g.key, g]));
  clases.forEach(c => {
    const key = String(c.grupo_key || "").trim().toUpperCase();
    if (!key || gruposMap.has(key)) return;
    gruposMap.set(key, normGrupo({
      key,
      label: String(c.grupo_label || grupoLabelFromKey(key) || key).trim()
    }));
  });

  return {
    version: Number(map.version || 1),
    config: {
      dias: [...DIAS_SEMANA],
      periodos
    },
    grupos: dedupeBy(Array.from(gruposMap.values()), g => g.key),
    docentes: dedupeBy(docentes, d => d.id),
    salones: dedupeBy(salones, s => s.id),
    clases: dedupeBy(clases, c => c.id),
    updated_at: normText(map.updated_at || "") || new Date().toISOString()
  };
}

function dedupeBy(lista = [], keyFn = x => x) {
  const out = [];
  const seen = new Set();

  for (const item of lista) {
    const key = String(keyFn(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function tsFromISO(value) {
  const t = new Date(String(value || "")).getTime();
  return Number.isFinite(t) ? t : 0;
}

function arrayFromResponse(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  return [payload];
}

function objectFromResponse(payload) {
  const arr = arrayFromResponse(payload);
  return arr[0] || null;
}

function apiDisponible() {
  return typeof apiRequest === "function" && navigator.onLine;
}

function resolverUpdatedBy(value = "") {
  const explicit = normText(value);
  if (explicit) return explicit;

  const user = typeof getAuthUser === "function" ? getAuthUser() : null;
  const username = normLower(user?.username || "");
  const nombre = normText(user?.nombre || "");
  const id = normText(user?.id || "");

  return username || nombre || id || "web_client";
}

function ligarEventosSyncRemoto() {
  if (eventosSyncLigados) return;
  eventosSyncLigados = true;

  window.addEventListener("online", async () => {
    await flushPushPendiente();
    await sincronizarMapaAhora({ prefer: "newer" });
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    await sincronizarMapaAhora({ prefer: syncConfig.prefer || "newer" });
  });
}

async function cargarMapaRemoto() {
  if (!apiDisponible()) return null;

  try {
    const payload = await apiRequest(HORARIOS_REMOTE_TABLE, {
      query: {
        select: "id,mapa,updated_at,updated_by",
        id: `eq.${HORARIOS_REMOTE_ID}`,
        limit: 1
      }
    });

    const row = objectFromResponse(payload);
    if (!row || !row.mapa) return null;

    const map = normalizarMapa(row.mapa);
    if (row.updated_at) {
      map.updated_at = String(row.updated_at);
    }
    return map;
  } catch (_) {
    return null;
  }
}

async function guardarMapaRemotoInmediato(mapa = null, { updatedBy = "" } = {}) {
  if (!apiDisponible()) return false;
  const normalizado = normalizarMapa(mapa || leerMapa());
  const by = resolverUpdatedBy(updatedBy);

  const row = {
    id: HORARIOS_REMOTE_ID,
    mapa: normalizado,
    updated_by: by
  };

  try {
    await apiRequest(HORARIOS_REMOTE_TABLE, {
      method: "POST",
      query: { on_conflict: "id" },
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: row
    });
    return true;
  } catch (_) {
    try {
      await apiRequest(HORARIOS_REMOTE_TABLE, {
        method: "PATCH",
        query: { id: `eq.${HORARIOS_REMOTE_ID}` },
        headers: { Prefer: "return=representation" },
        body: {
          mapa: normalizado,
          updated_by: by
        }
      });
      return true;
    } catch {
      return false;
    }
  }
}

function programarPushRemoto(mapa = null, { updatedBy = "" } = {}) {
  pushPendiente = {
    mapa: normalizarMapa(mapa || leerMapa()),
    updatedBy: resolverUpdatedBy(updatedBy)
  };

  if (pushTimerId || pushEnCurso) return;
  pushTimerId = setTimeout(() => {
    pushTimerId = null;
    flushPushPendiente();
  }, 320);
}

async function flushPushPendiente() {
  if (pushEnCurso || !pushPendiente) return false;
  if (!apiDisponible()) return false;

  pushEnCurso = true;
  const job = pushPendiente;
  pushPendiente = null;

  try {
    const ok = await guardarMapaRemotoInmediato(job.mapa, {
      updatedBy: job.updatedBy
    });

    if (!ok) {
      pushPendiente = job;
      if (!pushTimerId) {
        pushTimerId = setTimeout(() => {
          pushTimerId = null;
          flushPushPendiente();
        }, 3500);
      }
    }
    return ok;
  } finally {
    pushEnCurso = false;
  }
}

async function sincronizarMapaAhora({ prefer = "newer" } = {}) {
  if (syncEnCurso) return leerMapa();
  syncEnCurso = true;

  try {
    const local = leerMapa();
    const remote = await cargarMapaRemoto();
    const localTs = tsFromISO(local.updated_at);
    const remoteTs = tsFromISO(remote?.updated_at);

    if (remote && remoteTs > localTs) {
      return guardarMapa(remote, { emit: true, syncRemote: false });
    }

    if (!remote && prefer === "push-local") {
      await guardarMapaRemotoInmediato(local);
      return local;
    }

    if (remote && localTs > remoteTs && (prefer === "push-local" || prefer === "newer")) {
      await guardarMapaRemotoInmediato(local);
      return local;
    }

    return local;
  } finally {
    syncEnCurso = false;
  }
}

function iniciarSyncRemoto({ intervalMs = 10000, prefer = "newer" } = {}) {
  const ms = Number(intervalMs || 10000);
  syncConfig = {
    intervalMs: Number.isFinite(ms) && ms >= 2000 ? ms : 10000,
    prefer: String(prefer || "newer").trim() || "newer"
  };

  ligarEventosSyncRemoto();

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  syncIntervalId = setInterval(() => {
    sincronizarMapaAhora({ prefer: syncConfig.prefer });
  }, syncConfig.intervalMs);

  sincronizarMapaAhora({ prefer: syncConfig.prefer });
}

function detenerSyncRemoto() {
  if (!syncIntervalId) return;
  clearInterval(syncIntervalId);
  syncIntervalId = null;
}

function leerMapa() {
  try {
    const raw = getStore(HORARIOS_STORAGE_KEY);
    if (!raw) return defaultMapa();
    const parsed = JSON.parse(raw);
    return normalizarMapa(parsed);
  } catch {
    return defaultMapa();
  }
}

function emitirCambio() {
  try {
    window.dispatchEvent(new CustomEvent("horarios:changed"));
  } catch {
    // ignore
  }
  try {
    bc?.postMessage({ type: "horarios:changed", ts: Date.now() });
  } catch {
    // ignore
  }
}

function guardarMapa(mapa = null, { emit = true, syncRemote = true, updatedBy = "" } = {}) {
  const normalizado = normalizarMapa(mapa || {});
  normalizado.updated_at = new Date().toISOString();
  setStore(HORARIOS_STORAGE_KEY, JSON.stringify(normalizado));
  if (syncRemote) {
    programarPushRemoto(normalizado, { updatedBy });
  }
  if (emit) emitirCambio();
  return normalizado;
}

function mergeGruposDesdeAlumnos(mapa = null, alumnos = []) {
  const m = normalizarMapa(mapa || leerMapa());
  const actuales = new Map(m.grupos.map(g => [g.key, g]));

  (Array.isArray(alumnos) ? alumnos : []).forEach(a => {
    const key = grupoKey(a?.grado, a?.grupo);
    if (!key || actuales.has(key)) return;
    const grupo = normGrupo({
      key,
      label: `${normUpper(a?.grado || "")} ${normUpper(a?.grupo || "")}`.trim(),
      grado: a?.grado,
      grupo: a?.grupo
    });
    if (grupo.key) actuales.set(grupo.key, grupo);
  });

  m.grupos = Array.from(actuales.values()).sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base", numeric: true }));
  return m;
}

function upsertClase(mapa = null, clase = {}) {
  const m = normalizarMapa(mapa || leerMapa());
  const incoming = normClase(clase);
  if (!incoming.grupo_key || !incoming.dia || !incoming.periodo) return m;

  if (incoming.docente_id) {
    m.clases = m.clases.filter(c =>
      !(
        String(c.docente_id || "") === String(incoming.docente_id || "") &&
        String(c.dia || "") === String(incoming.dia || "") &&
        Number(c.periodo || 0) === Number(incoming.periodo || 0) &&
        String(c.grupo_key || "") !== String(incoming.grupo_key || "")
      )
    );
  }

  const byKey = m.clases.findIndex(c =>
    c.grupo_key === incoming.grupo_key &&
    c.dia === incoming.dia &&
    Number(c.periodo) === Number(incoming.periodo)
  );

  if (byKey >= 0) {
    const prev = m.clases[byKey];
    m.clases[byKey] = {
      ...prev,
      ...incoming,
      id: prev.id || incoming.id,
      updated_at: new Date().toISOString()
    };
    return m;
  }

  m.clases.push({
    ...incoming,
    id: incoming.id || uidSimple(),
    updated_at: new Date().toISOString()
  });
  return m;
}

function eliminarClase(mapa = null, { grupo_key = "", dia = "", periodo = 0 } = {}) {
  const m = normalizarMapa(mapa || leerMapa());
  const key = normUpper(grupo_key);
  const day = normUpper(dia);
  const slot = Number(periodo || 0);

  m.clases = m.clases.filter(c =>
    !(c.grupo_key === key && c.dia === day && Number(c.periodo) === slot)
  );
  return m;
}

function obtenerPeriodoActual(mapa = null, date = new Date()) {
  const m = normalizarMapa(mapa || leerMapa());
  const nowMins = minutesNow(date);

  for (const p of m.config.periodos) {
    const ini = hmToMinutes(p.inicio);
    const fin = hmToMinutes(p.fin);
    if (ini === null || fin === null) continue;
    if (nowMins >= ini && nowMins < fin) {
      return p;
    }
  }
  return null;
}

function normalizarDocenteRef(ref = {}) {
  return {
    id: normText(ref.id || ""),
    username: normLower(ref.username || ref.usuario || ""),
    nombre: normText(ref.nombre || "")
  };
}

function clasePerteneceADocente(clase = {}, docenteRef = {}) {
  const ref = normalizarDocenteRef(docenteRef);
  if (!ref.id && !ref.username && !ref.nombre) return false;

  const cId = normText(clase.docente_id || "");
  const cUser = normLower(clase.docente_username || "");
  const cName = normText(clase.docente_nombre || "");

  if (ref.id && cId && ref.id === cId) return true;
  if (ref.username && cUser && ref.username === cUser) return true;
  if (ref.nombre && cName && normLower(ref.nombre) === normLower(cName)) return true;
  return false;
}

function obtenerClasesPorGrupo(grupoKeyInput = "", mapa = null) {
  const m = normalizarMapa(mapa || leerMapa());
  const key = normUpper(grupoKeyInput);
  if (!key) return [];
  return m.clases.filter(c => c.grupo_key === key);
}

function obtenerClasesPorDocente(docenteRef = {}, mapa = null) {
  const m = normalizarMapa(mapa || leerMapa());
  return m.clases.filter(c => clasePerteneceADocente(c, docenteRef));
}

function obtenerClasesActualesDocente(docenteRef = {}, date = new Date(), mapa = null) {
  const m = normalizarMapa(mapa || leerMapa());
  const dia = diaCodeFromDate(date);
  if (!dia) return [];

  const periodo = obtenerPeriodoActual(m, date);
  if (!periodo?.numero) return [];

  return m.clases.filter(c =>
    clasePerteneceADocente(c, docenteRef) &&
    c.dia === dia &&
    Number(c.periodo) === Number(periodo.numero)
  );
}

function suscribirCambios(callback) {
  if (typeof callback !== "function") return () => {};

  const onCustom = () => callback(leerMapa());
  const onStorage = e => {
    const key = typeof isAppStorageKeyMatch === "function"
      ? isAppStorageKeyMatch(e?.key, HORARIOS_STORAGE_KEY)
      : e?.key === HORARIOS_STORAGE_KEY;
    if (key) callback(leerMapa());
  };
  const onBC = e => {
    if (e?.data?.type === "horarios:changed") {
      callback(leerMapa());
    }
  };

  window.addEventListener("horarios:changed", onCustom);
  window.addEventListener("storage", onStorage);
  bc?.addEventListener("message", onBC);

  return () => {
    window.removeEventListener("horarios:changed", onCustom);
    window.removeEventListener("storage", onStorage);
    bc?.removeEventListener("message", onBC);
  };
}

window.HORARIOS_STORAGE_KEY = HORARIOS_STORAGE_KEY;
window.horarioDiasSemana = [...DIAS_SEMANA];
window.horarioDefaultPeriodos = DEFAULT_PERIODOS.map(p => ({ ...p }));
window.horarioDiaCode = diaCodeFromDate;
window.horarioGrupoKey = grupoKey;
window.horarioGrupoLabelFromKey = grupoLabelFromKey;
window.horarioLeerMapa = leerMapa;
window.horarioGuardarMapa = guardarMapa;
window.horarioMergeGruposDesdeAlumnos = mergeGruposDesdeAlumnos;
window.horarioUpsertClase = upsertClase;
window.horarioEliminarClase = eliminarClase;
window.horarioObtenerPeriodoActual = obtenerPeriodoActual;
window.horarioNormalizarDocenteRef = normalizarDocenteRef;
window.horarioObtenerClasesPorGrupo = obtenerClasesPorGrupo;
window.horarioObtenerClasesPorDocente = obtenerClasesPorDocente;
window.horarioObtenerClasesActualesDocente = obtenerClasesActualesDocente;
window.horarioSuscribirCambios = suscribirCambios;
window.horarioCargarMapaRemoto = cargarMapaRemoto;
window.horarioGuardarMapaRemoto = guardarMapaRemotoInmediato;
window.horarioSincronizarAhora = sincronizarMapaAhora;
window.iniciarSyncHorariosRemoto = iniciarSyncRemoto;
window.detenerSyncHorariosRemoto = detenerSyncRemoto;
window.horarioFlushPushPendiente = flushPushPendiente;

})();

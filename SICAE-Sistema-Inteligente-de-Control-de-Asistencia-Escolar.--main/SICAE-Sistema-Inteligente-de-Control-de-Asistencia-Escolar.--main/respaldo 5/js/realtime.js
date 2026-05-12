/* ======================================================
   ===== API COMPATIBLE (SUPABASE/POSTGRESQL) ===========
====================================================== */

(() => {

const SUPABASE_PROJECT_URL = "https://xdkeuutuzqksftrdlalw.supabase.co";
const SUPABASE_REST_URL = `${SUPABASE_PROJECT_URL}/rest/v1`;
const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_PROJECT_URL).host.split(".")[0] || "";
  } catch {
    return "";
  }
})();
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FsC1zSEdwd52sZucSn7N8w_XdWuKStI";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhka2V1dXR1enFrc2Z0cmRsYWx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTc3MTksImV4cCI6MjA5NDEzMzcxOX0.tM4_vl_d7IpFDY5aciDnkwVEoKZgJqDfjdYbzXCFFvc";
const DEFAULT_API_BASE_URL = SUPABASE_REST_URL;
const SUPABASE_API_KEY_STORAGE_KEY = "SUPABASE_API_KEY";
const getStore = typeof storageGetItem === "function"
  ? storageGetItem
  : key => localStorage.getItem(key);
const setStore = typeof storageSetItem === "function"
  ? storageSetItem
  : (key, value) => localStorage.setItem(key, value);
const buildChannel = typeof createAppBroadcastChannel === "function"
  ? createAppBroadcastChannel
  : base => new BroadcastChannel(base);

function esSupabaseRest(url) {
  return /supabase\.co\/rest\/v1$/i.test(String(url || "").trim().replace(/\/+$/, ""));
}

function isSupabaseRestOfCurrentProject(url) {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (!esSupabaseRest(clean)) return false;
  try {
    return new URL(clean).host === new URL(SUPABASE_REST_URL).host;
  } catch {
    return false;
  }
}

function isSupabaseRequestUrl(url) {
  try {
    const parsed = new URL(String(url || ""), window.location.origin);
    return /\.supabase\.co$/i.test(parsed.hostname) && /^\/rest\/v1(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function shouldIncludeCredentials(url) {
  return !isSupabaseRequestUrl(url);
}

function resolveSupabaseApiKey() {
  const fromWindow = String(window.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (fromWindow) return fromWindow;

  const fromStorage = String(getStore(SUPABASE_API_KEY_STORAGE_KEY) || "").trim();
  if (fromStorage) return fromStorage;

  return SUPABASE_PUBLISHABLE_KEY;
}

function parseJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function tokenPerteneceAProyectoActual(token) {
  const payload = parseJwtPayload(token);
  const ref = String(payload?.ref || "").trim();
  return !!ref && ref === SUPABASE_PROJECT_REF;
}

function resolveBearerToken() {
  const fromAuth = typeof getAuthToken === "function"
    ? getAuthToken()
    : String(getStore("asistencia_auth_token") || "");

  const token = String(fromAuth || "").trim();
  if (!token || token.startsWith("sb_publishable_") || token === "postgrest-direct") {
    return SUPABASE_ANON_KEY;
  }
  if (token.includes(".") && !tokenPerteneceAProyectoActual(token)) {
    return SUPABASE_ANON_KEY;
  }
  return token;
}

const API_BASE_URL = (() => {
  const fromWindow = String(window.API_BASE_URL || "").trim();
  if (fromWindow) {
    const clean = fromWindow.replace(/\/+$/, "");
    if (!esSupabaseRest(clean) || isSupabaseRestOfCurrentProject(clean)) {
      return clean;
    }
  }

  const fromStorage = String(getStore("API_BASE_URL") || "").trim();
  if (fromStorage && fromStorage !== "/api") {
    const clean = fromStorage.replace(/\/+$/, "");
    if (!esSupabaseRest(clean) || isSupabaseRestOfCurrentProject(clean)) {
      return clean;
    }
  }

  return DEFAULT_API_BASE_URL;
})();
const IS_SUPABASE_REST_MODE = esSupabaseRest(API_BASE_URL);

function ordenarLlamadasApi({ backend = [], postgrest = [] } = {}) {
  if (IS_SUPABASE_REST_MODE) {
    return Array.isArray(postgrest) ? postgrest : [];
  }

  return [
    ...(Array.isArray(backend) ? backend : []),
    ...(Array.isArray(postgrest) ? postgrest : [])
  ];
}

window.API_BASE_URL = API_BASE_URL;
window.SUPABASE_PROJECT_URL = SUPABASE_PROJECT_URL;
window.SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.supabaseClient = null;
setStore("API_BASE_URL", API_BASE_URL);
const tokenActual = String(getStore("asistencia_auth_token") || "").trim();
if (
  !tokenActual ||
  tokenActual.startsWith("sb_publishable_") ||
  tokenActual === "postgrest-direct" ||
  (tokenActual.includes(".") && !tokenPerteneceAProyectoActual(tokenActual))
) {
  setStore("asistencia_auth_token", SUPABASE_ANON_KEY);
}
setStore(SUPABASE_API_KEY_STORAGE_KEY, SUPABASE_PUBLISHABLE_KEY);

const bc = buildChannel("victory-data");

let pollAlumnosId = null;
let pollAttendanceId = null;
let alumnosSincronizados = false;
let authErrorRedireccionado = false;
let attendanceNotificacionesInicializadas = false;
const attendanceEventosNotificados = new Map();

const POLL_ALUMNOS_MS = 10000;
const POLL_ATTENDANCE_MS = 2500;

function pgEq(value) {
  return `eq.${String(value)}`;
}

function pgGte(value) {
  return `gte.${String(value)}`;
}

function pgLt(value) {
  return `lt.${String(value)}`;
}

function construirFiltroRangoCreatedAt({ inicioISO = null, finISO = null } = {}) {
  const filtros = [
    inicioISO ? `created_at.gte.${inicioISO}` : "",
    finISO ? `created_at.lt.${finISO}` : ""
  ].filter(Boolean);

  return filtros.length ? `(${filtros.join(",")})` : null;
}

function llamadasAttendancePostgrest({ inicioISO = null, finISO = null, order = "asc", alumnoId = null } = {}) {
  const filtroRango = construirFiltroRangoCreatedAt({ inicioISO, finISO });
  const baseQuery = {
    select: "*",
    ...(filtroRango ? { and: filtroRango } : {}),
    order: `created_at.${order}`,
    limit: 10000
  };

  if (!alumnoId) {
    return [
      () => apiRequest("/attendance", { query: baseQuery })
    ];
  }

  return [
    () => apiRequest("/attendance", { query: { ...baseQuery, alumno_id: pgEq(alumnoId) } }),
    () => apiRequest("/attendance", { query: { ...baseQuery, cliente_id: pgEq(alumnoId) } }),
    () => apiRequest("/attendance", {
      query: {
        ...baseQuery,
        or: `(alumno_id.eq.${alumnoId},cliente_id.eq.${alumnoId})`
      }
    })
  ];
}

function esURLAbsoluta(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function construirURL(path, query = {}) {
  const base = String(API_BASE_URL || "/api").replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  const raw = `${base}${cleanPath}`;

  const url = esURLAbsoluta(raw)
    ? new URL(raw)
    : new URL(raw, window.location.origin);

  Object.entries(query || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, v);
  });

  return url.toString();
}

async function apiRequest(path, { method = "GET", query = null, body = null, headers = {}, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = construirURL(path, query || {});
    const supabaseApiKey = resolveSupabaseApiKey();
    const token = resolveBearerToken();

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(supabaseApiKey ? { apikey: supabaseApiKey } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: shouldIncludeCredentials(url) ? "include" : "omit"
    });

    const raw = await res.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (!res.ok) {
      const bypass = typeof isAuthBypassEnabled === "function" ? isAuthBypassEnabled() : false;
      if (res.status === 401 && !bypass && !authErrorRedireccionado && typeof clearAuthSession === "function") {
        authErrorRedireccionado = true;
        setTimeout(() => clearAuthSession({ redirect: true }), 80);
      }

      const err = new Error(`[API ${res.status}] ${method} ${path}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function apiTry(calls = [], { acceptNull = false } = {}) {
  let lastError = null;

  for (const call of calls) {
    try {
      const data = await call();

      if (data === undefined) continue;
      if (data === null && !acceptNull) continue;

      return data;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return null;
}

function arrayDesdeRespuesta(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function objetoDesdeRespuesta(payload) {
  if (!payload) return null;

  if (Array.isArray(payload)) return payload[0] || null;
  if (payload.data && !Array.isArray(payload.data)) return payload.data;
  if (payload.item && !Array.isArray(payload.item)) return payload.item;
  if (payload.row && !Array.isArray(payload.row)) return payload.row;
  if (payload.result && !Array.isArray(payload.result)) return payload.result;

  return payload;
}

function mensajeErrorApi(err, fallback = "No se pudo completar la operacion") {
  const payload = err?.payload && typeof err.payload === "object" ? err.payload : {};
  const base = String(payload.message || err?.message || fallback || "").trim();
  const details = String(payload.details || "").trim();
  const hint = String(payload.hint || "").trim();

  return [base, details, hint].filter(Boolean).join(" | ");
}

function clasificarErrorInsertAlumno(err) {
  const payload = err?.payload && typeof err.payload === "object" ? err.payload : {};
  const code = String(payload.code || "").trim();
  const status = Number(err?.status || 0);
  const message = mensajeErrorApi(err, "Error al registrar alumno");
  const full = message.toLowerCase();

  if (code === "23505" || full.includes("duplicate key") || full.includes("duplicate")) {
    if (full.includes("ux_alumnos_correo_ci") || full.includes("correo")) {
      return {
        code: code || "23505",
        field: "correo",
        message: "Ese correo ya existe en la base de datos."
      };
    }

    if (full.includes("ux_alumnos_matricula_ci") || full.includes("matricula")) {
      return {
        code: code || "23505",
        field: "matricula",
        message: "Esa matrícula ya existe en la base de datos."
      };
    }

    if (
      full.includes("ux_alumnos_tarjeta_uid_ci") ||
      full.includes("tarjeta_uid") ||
      full.includes("uid")
    ) {
      return {
        code: code || "23505",
        field: "tarjeta",
        message: "Esa tarjeta NFC ya esta registrada en la base de datos."
      };
    }

    return {
      code: code || "23505",
      field: null,
      message: "Ya existe un alumno con datos duplicados en la base de datos."
    };
  }

  if (
    code === "42501" ||
    status === 401 ||
    status === 403 ||
    full.includes("permission denied") ||
    full.includes("row-level security")
  ) {
    return {
      code: code || String(status || "AUTH"),
      field: null,
      message: "La base de datos rechazo el registro por permisos (RLS/policies)."
    };
  }

  return {
    code: code || (status ? String(status) : "UNKNOWN"),
    field: null,
    message: message || "Error al registrar alumno"
  };
}

function resultadoInsertAlumno({ ok = false, alumno = null, code = null, field = null, message = "" } = {}) {
  return {
    ok: !!ok,
    alumno: alumno || null,
    code: code || null,
    field: field || null,
    message: String(message || "").trim()
  };
}

async function verificarAlumnoInsertadoRemoto(id) {
  const idRaw = String(id || "").trim();
  if (!idRaw || !navigator.onLine) return false;

  try {
    const payload = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest(`/alumnos/${encodeURIComponent(idRaw)}`),
        () => apiRequest("/alumnos", { query: { id: idRaw, limit: 1 } })
      ],
      postgrest: [
        () => apiRequest("/alumnos", {
          query: {
            select: "id",
            id: pgEq(idRaw),
            limit: 1
          }
        })
      ]
    }), { acceptNull: true });

    if (Array.isArray(payload)) {
      return payload.some(row => String(row?.id || "").trim() === idRaw);
    }

    const arr = arrayDesdeRespuesta(payload);
    if (arr.length) {
      return arr.some(row => String(row?.id || "").trim() === idRaw);
    }

    const obj = objetoDesdeRespuesta(payload);
    return String(obj?.id || "").trim() === idRaw;
  } catch (_) {
    return false;
  }
}

function alumnoVacioBase() {
  return {
    id: "",
    nombre: "",
    correo: "",
    fechaNacimiento: "",
    telefono: "",
    matricula: "",
    grado: "",
    grupo: "",
    tipoSangre: "",
    alergias: "",
    tutorNombre: "",
    tutorParentesco: "",
    tutorTelefono: "",
    tutorCorreo: "",
    tarjetaUID: "",
    fechaRegistro: hoy()
  };
}

function normalizarAlumno(raw = {}) {
  const base = alumnoVacioBase();

  return {
    ...base,
    id: raw.id ?? base.id,
    nombre: String(raw.nombre ?? "").trim(),
    correo: String(raw.correo ?? raw.email ?? "").trim(),
    fechaNacimiento: String(raw.fechaNacimiento ?? raw.fecha_nacimiento ?? "").trim(),
    telefono: String(raw.telefono ?? raw.phone ?? "").trim(),
    matricula: String(raw.matricula ?? raw.student_id ?? "").trim().toUpperCase(),
    grado: String(raw.grado ?? raw.grade ?? "").trim().toUpperCase(),
    grupo: String(raw.grupo ?? raw.group ?? "").trim().toUpperCase(),
    tipoSangre: String(raw.tipoSangre ?? raw.tipo_sangre ?? "").trim().toUpperCase(),
    alergias: String(raw.alergias ?? "").trim(),
    tutorNombre: String(raw.tutorNombre ?? raw.tutor_nombre ?? "").trim(),
    tutorParentesco: String(raw.tutorParentesco ?? raw.tutor_parentesco ?? "").trim().toUpperCase(),
    tutorTelefono: String(raw.tutorTelefono ?? raw.tutor_telefono ?? "").trim(),
    tutorCorreo: String(raw.tutorCorreo ?? raw.tutor_correo ?? "").trim().toLowerCase(),
    tarjetaUID: normalizarUID(raw.tarjetaUID ?? raw.tarjeta_uid ?? ""),
    fechaRegistro: String(raw.fechaRegistro ?? raw.fecha_registro ?? hoy()).trim()
  };
}

function guardarAlumnosLocalCompat(lista) {
  const normalizados = (Array.isArray(lista) ? lista : []).map(normalizarAlumno);

  guardarAlumnos(normalizados);
}

function upsertAlumnoLocal(alumno) {
  const lista = obtenerAlumnos();
  const normalizado = normalizarAlumno(alumno);

  const idx = lista.findIndex(a => String(a.id) === String(normalizado.id));

  if (idx >= 0) lista[idx] = { ...lista[idx], ...normalizado };
  else lista.push(normalizado);

  guardarAlumnosLocalCompat(lista);
  bc.postMessage("alumnos");
}

function alumnoAPayloadServidor(alumno, { legacy = false } = {}) {
  const a = normalizarAlumno(alumno);

  const core = {
    id: a.id,
    nombre: a.nombre,
    correo: a.correo || null,
    fecha_nacimiento: a.fechaNacimiento || null,
    telefono: a.telefono || null,
    matricula: a.matricula || null,
    grado: a.grado || null,
    grupo: a.grupo || null,
    tarjeta_uid: a.tarjetaUID || null,
    fecha_registro: a.fechaRegistro || hoy()
  };

  if (legacy) {
    return core;
  }

  return {
    ...core,
    tipo_sangre: a.tipoSangre || null,
    alergias: a.alergias || null,
    tutor_nombre: a.tutorNombre || null,
    tutor_parentesco: a.tutorParentesco || null,
    tutor_telefono: a.tutorTelefono || null,
    tutor_correo: a.tutorCorreo || null
  };
}

function esErrorColumnaNoExiste(err) {
  const payload = err?.payload && typeof err.payload === "object" ? err.payload : {};
  const code = String(payload.code || "").trim();
  const message = String(payload.message || err?.message || "").toLowerCase();

  if (code === "PGRST204") return true;
  if (message.includes("could not find") && message.includes("column")) return true;
  if (message.includes("column") && message.includes("does not exist")) return true;
  return false;
}

async function insertarAlumnoRemotoConPayload(payload) {
  return apiTry(ordenarLlamadasApi({
    backend: [
      () => apiRequest("/alumnos", { method: "POST", body: payload }),
      () => apiRequest("/students", { method: "POST", body: payload })
    ],
    postgrest: [
      () => apiRequest("/alumnos", {
        method: "POST",
        body: payload,
        headers: { Prefer: "return=representation" }
      }),
      () => apiRequest("/alumnos", { method: "POST", body: payload })
    ]
  }));
}

async function actualizarAlumnoRemotoConPayload(idRaw, idPath, payload) {
  return apiTry(ordenarLlamadasApi({
    backend: [
      () => apiRequest(`/alumnos/${idPath}`, { method: "PUT", body: payload }),
      () => apiRequest(`/alumnos/${idPath}`, { method: "PATCH", body: payload })
    ],
    postgrest: [
      () => apiRequest("/alumnos", {
        method: "PATCH",
        query: { id: pgEq(idRaw) },
        body: payload,
        headers: { Prefer: "return=representation" }
      })
    ]
  }));
}

function normalizarEventoAttendance(raw = {}) {
  const alumnoId = raw.alumno_id ?? raw.cliente_id ?? null;

  return {
    id: raw.id,
    alumno_id: alumnoId,
    uid: normalizarUID(raw.uid ?? raw.tarjeta_uid ?? ""),
    created_at: raw.created_at ?? raw.fecha_hora ?? raw.ts ?? null,
    type: String(raw.type ?? raw.accion ?? "").trim().toLowerCase()
  };
}

function normalizarEventoNFC(raw = {}) {
  const id = raw.id ?? raw.event_id ?? null;
  const uid = normalizarUID(raw.uid ?? raw.tarjeta_uid ?? "");

  if (!id || !uid) return null;

  return {
    id,
    uid,
    created_at: raw.created_at ?? raw.ts ?? new Date().toISOString(),
    processed: !!raw.processed
  };
}

function ordenarEventosPorFecha(eventos = [], asc = true) {
  return [...eventos].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return asc ? ta - tb : tb - ta;
  });
}

function claveEventoAttendance(ev = {}) {
  const id = String(ev?.id || "").trim();
  if (id) return `id:${id}`;

  const alumnoId = String(ev?.alumno_id || ev?.cliente_id || "").trim();
  const uid = normalizarUID(ev?.uid || "");
  const type = String(ev?.type || ev?.accion || "").trim().toLowerCase();
  const createdAt = String(ev?.created_at || "").trim();
  if (!type || (!alumnoId && !uid)) return "";
  return `sig:${alumnoId}|${uid}|${type}|${createdAt}`;
}

function limpiarCacheEventosAttendance(nowTs = Date.now()) {
  const TTL_MS = 1000 * 60 * 30;
  const MAX_SIZE = 6000;
  const minTs = nowTs - TTL_MS;

  for (const [key, ts] of attendanceEventosNotificados.entries()) {
    if (ts < minTs) {
      attendanceEventosNotificados.delete(key);
    }
  }

  if (attendanceEventosNotificados.size <= MAX_SIZE) return;

  const entries = Array.from(attendanceEventosNotificados.entries())
    .sort((a, b) => a[1] - b[1]);
  const removeCount = attendanceEventosNotificados.size - MAX_SIZE;

  for (let i = 0; i < removeCount; i += 1) {
    const key = entries[i]?.[0];
    if (key) attendanceEventosNotificados.delete(key);
  }
}

function marcarEventoAttendanceComoVisto(ev = {}) {
  const key = claveEventoAttendance(ev);
  if (!key) return false;

  const nowTs = Date.now();
  limpiarCacheEventosAttendance(nowTs);

  if (attendanceEventosNotificados.has(key)) return false;
  attendanceEventosNotificados.set(key, nowTs);
  return true;
}

function emitirEventosAttendanceNuevos(nuevos = []) {
  if (!Array.isArray(nuevos) || !nuevos.length) return;
  if (typeof window.onAttendanceEventRemoto !== "function") return;

  for (const ev of nuevos) {
    try {
      window.onAttendanceEventRemoto(ev);
    } catch (err) {
      console.warn("[ATTENDANCE] Error notificando evento remoto:", err?.message || err);
    }
  }
}

async function logEstadoServidor() {
  if (!navigator.onLine) {
    console.warn("[API] Offline: trabajando en modo local");
    return;
  }

  try {
    const checks = ordenarLlamadasApi({
      backend: [
        () => apiRequest("/health"),
        () => apiRequest("/status"),
        () => apiRequest("/", { timeoutMs: 6000 })
      ],
      postgrest: [
        () => apiRequest("/alumnos", { query: { select: "id", limit: 1 } }),
        () => apiRequest("/attendance", { query: { select: "id", limit: 1 } })
      ]
    });

    if (checks.length) {
      await apiTry(checks, { acceptNull: true });
    }

    console.info(`[API] Conexion OK (${API_BASE_URL})`);
  } catch (err) {
    console.error("[API] Error de conexión:", err?.message || err);
  }
}

async function cargarAlumnosIniciales() {
  if (!navigator.onLine) {
    const local = obtenerAlumnos();
    guardarAlumnosLocalCompat(local);
    return local;
  }

  try {
    const payload = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/alumnos"),
        () => apiRequest("/students")
      ],
      postgrest: [
        () => apiRequest("/alumnos", { query: { select: "*", order: "nombre.asc", limit: 5000 } })
      ]
    }));

    const lista = arrayDesdeRespuesta(payload)
      .map(normalizarAlumno)
      .filter(a => a && (a.id || a.nombre || a.tarjetaUID));

    lista.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

    guardarAlumnosLocalCompat(lista);
    bc.postMessage("alumnos");

    console.info("[ALUMNOS] Cargados desde API:", lista.length);
    return lista;
  } catch (err) {
    console.error("[ALUMNOS] Error carga inicial API:", err?.message || err);
    return obtenerAlumnos();
  }
}

async function ensureAlumnosCargados() {
  if (alumnosSincronizados) return obtenerAlumnos();

  const lista = await cargarAlumnosIniciales();
  alumnosSincronizados = true;
  return lista;
}

async function obtenerAlumnoPorUIDRemoto(uid) {
  if (!navigator.onLine) return null;

  const normalizado = normalizarUID(uid);
  if (!normalizado) return null;

  try {
    const payload = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest(`/alumnos/by-uid/${encodeURIComponent(normalizado)}`),
        () => apiRequest(`/alumnos/by_uid/${encodeURIComponent(normalizado)}`),
        () => apiRequest("/alumnos", { query: { uid: normalizado, limit: 1 } })
      ],
      postgrest: [
        () => apiRequest("/alumnos", {
          query: {
            select: "*",
            tarjeta_uid: pgEq(normalizado),
            limit: 1
          }
        })
      ]
    }), { acceptNull: true });

    const obj = objetoDesdeRespuesta(payload);
    if (!obj || (!obj.id && !obj.nombre && !obj.tarjeta_uid && !obj.tarjetaUID)) return null;

    const alumno = normalizarAlumno(obj);
    upsertAlumnoLocal(alumno);
    return alumno;
  } catch (_) {
    return null;
  }
}

async function verificarDuplicadoAlumnoRemoto({ correo, matricula, uid }) {
  if (!navigator.onLine) return null;

  const correoN = String(correo || "").trim().toLowerCase();
  const matriculaN = String(matricula || "").trim().toUpperCase();
  const uidN = normalizarUID(uid);

  if (!IS_SUPABASE_REST_MODE) {
    try {
      const payload = await apiTry([
        () => apiRequest("/alumnos/duplicados", {
          query: { correo: correoN, matricula: matriculaN, uid: uidN }
        }),
        () => apiRequest("/alumnos/duplicate", {
          query: { correo: correoN, matricula: matriculaN, uid: uidN }
        })
      ], { acceptNull: true });

      const obj = objetoDesdeRespuesta(payload) || {};
      const tipo = String(obj.duplicado || obj.tipo || obj.field || "").toLowerCase();

      if (tipo === "correo") return "correo";
      if (tipo === "matricula") return "matricula";
      if (["tarjeta", "uid", "tarjeta_uid"].includes(tipo)) return "tarjeta";

      if (obj.correo === true) return "correo";
      if (obj.matricula === true) return "matricula";
      if (obj.tarjeta === true || obj.uid === true || obj.tarjeta_uid === true) return "tarjeta";
    } catch (_) {
      // fallback abajo
    }
  }

  try {
    const payload = await apiRequest("/alumnos", {
      query: {
        select: "id,correo,matricula,tarjeta_uid",
        limit: 5000
      }
    });
    const lista = arrayDesdeRespuesta(payload).map(normalizarAlumno);

    if (uidN && lista.some(a => normalizarUID(a.tarjetaUID) === uidN)) return "tarjeta";
    if (matriculaN && lista.some(a => String(a.matricula || "").toUpperCase() === matriculaN)) return "matricula";
    if (correoN && lista.some(a => String(a.correo || "").toLowerCase() === correoN)) return "correo";
  } catch (_) {
    // sin fallback remoto
  }

  return null;
}

async function insertarAlumnoSupabase(alumno) {
  if (!navigator.onLine) {
    return resultadoInsertAlumno({
      ok: false,
      code: "OFFLINE",
      message: "Sin conexión a internet. No se pudo registrar en la base de datos."
    });
  }

  try {
    const payload = alumnoAPayloadServidor(alumno);
    let res = null;

    try {
      res = await insertarAlumnoRemotoConPayload(payload);
    } catch (errInsert) {
      if (!esErrorColumnaNoExiste(errInsert)) {
        throw errInsert;
      }
      res = await insertarAlumnoRemotoConPayload(alumnoAPayloadServidor(alumno, { legacy: true }));
    }

    const representacion = objetoDesdeRespuesta(res);
    const guardado = representacion || alumno;
    const idGuardado = String(guardado?.id || alumno?.id || "").trim();
    const confirmado = String(representacion?.id || "").trim()
      ? true
      : await verificarAlumnoInsertadoRemoto(idGuardado);

    if (!confirmado) {
      upsertAlumnoLocal(guardado);
      return resultadoInsertAlumno({
        ok: true,
        alumno: normalizarAlumno(guardado),
        code: "OK_UNVERIFIED_READ",
        message: "Alumno registrado. La lectura de confirmacion fue restringida por permisos."
      });
    }

    upsertAlumnoLocal(guardado);
    return resultadoInsertAlumno({
      ok: true,
      alumno: normalizarAlumno(guardado),
      code: "OK",
      message: "Alumno registrado en la base de datos."
    });
  } catch (err) {
    const info = clasificarErrorInsertAlumno(err);
    console.error("[ALUMNOS] Error insert API:", info.message, err?.payload || err);
    return resultadoInsertAlumno({
      ok: false,
      code: info.code,
      field: info.field,
      message: info.message
    });
  }
}

async function actualizarAlumnoSupabase(alumno) {
  if (!navigator.onLine) return false;

  try {
    const payload = alumnoAPayloadServidor(alumno);
    const idRaw = String(alumno.id);
    const idPath = encodeURIComponent(idRaw);

    try {
      await actualizarAlumnoRemotoConPayload(idRaw, idPath, payload);
    } catch (errUpdate) {
      if (!esErrorColumnaNoExiste(errUpdate)) {
        throw errUpdate;
      }
      await actualizarAlumnoRemotoConPayload(
        idRaw,
        idPath,
        alumnoAPayloadServidor(alumno, { legacy: true })
      );
    }

    upsertAlumnoLocal(alumno);
    return true;
  } catch (err) {
    console.error("[ALUMNOS] Error update API:", err?.message || err);
    return false;
  }
}

async function borrarAlumnoSupabase(id) {
  if (!navigator.onLine) return false;

  try {
    const idRaw = String(id);
    const idPath = encodeURIComponent(idRaw);

    await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest(`/alumnos/${idPath}`, { method: "DELETE" }),
        () => apiRequest("/alumnos", { method: "DELETE", query: { id: idPath } })
      ],
      postgrest: [
        () => apiRequest("/alumnos", { method: "DELETE", query: { id: pgEq(idRaw) } })
      ]
    }), { acceptNull: true });

    const lista = obtenerAlumnos().filter(a => String(a.id) !== String(id));
    guardarAlumnosLocalCompat(lista);
    bc.postMessage("alumnos");
    return true;
  } catch (err) {
    console.error("[ALUMNOS] Error delete API:", err?.message || err);
    return false;
  }
}

async function obtenerEventosAttendanceRemotos({ inicioISO = null, finISO = null, asc = true, alumnoId = null } = {}) {
  if (!navigator.onLine) return [];

  try {
    const order = asc ? "asc" : "desc";
    const filtroAlumnoBackend = alumnoId ? { alumno_id: alumnoId, cliente_id: alumnoId } : {};
    const payload = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/attendance/rango", {
          query: { inicio: inicioISO, fin: finISO, ...filtroAlumnoBackend, order }
        }),
        () => apiRequest("/attendance/events", {
          query: { from: inicioISO, to: finISO, ...filtroAlumnoBackend, order }
        }),
        () => apiRequest("/attendance", {
          query: { from: inicioISO, to: finISO, ...filtroAlumnoBackend, order }
        })
      ],
      postgrest: llamadasAttendancePostgrest({ inicioISO, finISO, order, alumnoId })
    }));

    const eventos = arrayDesdeRespuesta(payload)
      .map(normalizarEventoAttendance)
      .filter(ev => ev && ev.created_at && ev.type);

    return ordenarEventosPorFecha(eventos, asc);
  } catch (err) {
    console.error("[ATTENDANCE] Error obteniendo eventos remotos:", err?.message || err);
    return null;
  }
}

async function obtenerUltimoTipoAsistenciaHoyRemoto(alumnoId) {
  if (!navigator.onLine || !alumnoId) return null;

  const { inicioISO, finISO } = rangoHoyISO();

  if (!IS_SUPABASE_REST_MODE) {
    try {
      const payload = await apiTry([
        () => apiRequest("/attendance/ultimo-tipo", {
          query: { alumno_id: alumnoId, cliente_id: alumnoId, inicio: inicioISO, fin: finISO }
        }),
        () => apiRequest("/attendance/last-type", {
          query: { alumno_id: alumnoId, cliente_id: alumnoId, from: inicioISO, to: finISO }
        })
      ], { acceptNull: true });

      const obj = objetoDesdeRespuesta(payload) || {};
      const tipo = String(obj.type || obj.ultimo_tipo || obj.accion || "").toLowerCase();

      if (tipo === "entrada" || tipo === "salida") return tipo;
    } catch (_) {
      // fallback abajo
    }
  }

  const eventos = await obtenerEventosAttendanceRemotos({
    inicioISO,
    finISO,
    asc: false,
    alumnoId
  });

  if (!Array.isArray(eventos)) return null;

  const ultimo = eventos[0]?.type;
  return (ultimo === "entrada" || ultimo === "salida") ? ultimo : null;
}

async function registrarAsistenciaServidor(payload) {
  const alumnoId = payload?.alumno_id ?? payload?.cliente_id ?? null;
  const payloadNormalizado = {
    ...payload,
    alumno_id: alumnoId,
    cliente_id: alumnoId,
    uid: normalizarUID(payload?.uid)
  };
  const rpcPayload = {
    p_id: payloadNormalizado?.id,
    p_alumno_id: alumnoId,
    p_cliente_id: alumnoId,
    p_uid: payloadNormalizado?.uid,
    p_created_at: payloadNormalizado?.created_at,
    p_source: payloadNormalizado?.source,
    p_device_id: payloadNormalizado?.device_id
  };

  try {
    const rpc = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/attendance/registrar", { method: "POST", body: rpcPayload }),
        () => apiRequest("/rpc/registrar_asistencia", { method: "POST", body: rpcPayload })
      ],
      postgrest: [
        () => apiRequest("/rpc/registrar_asistencia", { method: "POST", body: rpcPayload })
      ]
    }), { acceptNull: true });

    const out = objetoDesdeRespuesta(rpc) || {};
    const accion = String(out.accion || out.type || payloadNormalizado?.type || "").toLowerCase();
    const result = {
      accion: accion || String(payloadNormalizado?.type || "").toLowerCase(),
      event_id: String(out.id || out.event_id || payloadNormalizado?.id || "").trim() || null,
      created_at: out.created_at || payloadNormalizado?.created_at || null,
      alumno_id: out.alumno_id || out.cliente_id || alumnoId || null,
      uid: normalizarUID(out.uid || payloadNormalizado?.uid || "")
    };

    marcarEventoAttendanceComoVisto({
      id: result.event_id,
      alumno_id: result.alumno_id,
      uid: result.uid,
      type: result.accion,
      created_at: result.created_at
    });
    return result;
  } catch (errRpcPrimario) {
    if (IS_SUPABASE_REST_MODE) {
      const payloadErr = errRpcPrimario?.payload && typeof errRpcPrimario.payload === "object"
        ? errRpcPrimario.payload
        : {};
      const code = String(payloadErr.code || "").trim();
      const msg = String(payloadErr.message || errRpcPrimario?.message || "").toLowerCase();
      const rpcAmbigua =
        errRpcPrimario?.status === 300 ||
        code === "PGRST203" ||
        msg.includes("multiple choices") ||
        msg.includes("could not choose the best candidate");
      const missingRpc =
        errRpcPrimario?.status === 404 ||
        code === "PGRST202" ||
        msg.includes("function") ||
        msg.includes("registrar_asistencia");

      if (rpcAmbigua || missingRpc) {
        const err = new Error(
          rpcAmbigua
            ? "RPC registrar_asistencia ambigua/duplicada en Supabase. Ejecuta setup_concurrencia_realtime.sql para limpiar overloads y vuelve a intentar."
            : "RPC registrar_asistencia no disponible en Supabase. Ejecuta setup_concurrencia_realtime.sql y vuelve a intentar."
        );
        err.cause = errRpcPrimario;
        throw err;
      }
      throw errRpcPrimario;
    }

    const res = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/attendance", { method: "POST", body: payloadNormalizado }),
        () => apiRequest("/attendance/event", { method: "POST", body: payloadNormalizado })
      ],
      postgrest: [
        () => apiRequest("/attendance", {
          method: "POST",
          body: payloadNormalizado,
          headers: { Prefer: "return=representation" }
        }),
        () => apiRequest("/attendance", { method: "POST", body: payloadNormalizado })
      ]
    }), { acceptNull: true });

    const out = objetoDesdeRespuesta(res) || {};
    const accion = String(out.accion || out.type || payloadNormalizado?.type || "").toLowerCase();
    const result = {
      accion: accion || String(payloadNormalizado?.type || "").toLowerCase(),
      event_id: String(out.id || out.event_id || payloadNormalizado?.id || "").trim() || null,
      created_at: out.created_at || payloadNormalizado?.created_at || null,
      alumno_id: out.alumno_id || out.cliente_id || alumnoId || null,
      uid: normalizarUID(out.uid || payloadNormalizado?.uid || "")
    };

    marcarEventoAttendanceComoVisto({
      id: result.event_id,
      alumno_id: result.alumno_id,
      uid: result.uid,
      type: result.accion,
      created_at: result.created_at
    });
    return result;
  }
}

async function reconstruirAsistenciasHoy() {
  const { fechaLocal, inicioISO, finISO } = rangoHoyISO();

  const eventos = await obtenerEventosAttendanceRemotos({
    inicioISO,
    finISO,
    asc: true
  });

  if (!Array.isArray(eventos)) return;

  const alumnos = obtenerAlumnos();
  const alumnosPorId = new Map(alumnos.map(a => [String(a.id), a]));
  const alumnosPorUID = new Map(alumnos.map(a => [normalizarUID(a.tarjetaUID), a]));

  const sesiones = {};
  const resultado = [];
  const nuevosEventosRemotos = [];

  for (const ev of eventos) {
    const uidNorm = normalizarUID(ev.uid || "");
    const alumnoByUid = uidNorm ? alumnosPorUID.get(uidNorm) : null;
    const canonicalId = String(ev.alumno_id || alumnoByUid?.id || "").trim();
    const key = canonicalId || (uidNorm ? `uid:${uidNorm}` : "");
    if (!key) continue;

    const evNorm = {
      ...ev,
      _uid_norm: uidNorm,
      _canonical_id: canonicalId
    };

    if (!sesiones[key]) sesiones[key] = [];
    sesiones[key].push(evNorm);
  }

  Object.keys(sesiones).forEach(key => {
    const items = sesiones[key] || [];
    let entradaActiva = null;

    items.forEach(ev => {
      const alumno = ev._canonical_id
        ? (alumnosPorId.get(String(ev._canonical_id)) || {})
        : (alumnosPorUID.get(ev._uid_norm) || {});
      const wasSeen = marcarEventoAttendanceComoVisto(ev);
      if (attendanceNotificacionesInicializadas && wasSeen) {
        nuevosEventosRemotos.push({
          id: ev.id,
          alumno_id: ev._canonical_id || ev.alumno_id || null,
          uid: ev.uid || "",
          type: ev.type,
          created_at: ev.created_at,
          alumno
        });
      }

      if (ev.type === "entrada") {
        entradaActiva = {
          id: ev.id,
          alumno_id: ev._canonical_id || ev.alumno_id || null,
          nombre: alumno.nombre || "Alumno",
          matricula: alumno.matricula || "-",
          grado: alumno.grado || "",
          grupo: alumno.grupo || "",
          grado_grupo: `${alumno.grado || ""}${alumno.grado && alumno.grupo ? " / " : ""}${alumno.grupo || ""}`,
          fecha: fechaLocal,
          entrada_ts: new Date(ev.created_at).getTime(),
          salida_ts: null
        };

        resultado.push(entradaActiva);
      }

      if (ev.type === "salida" && entradaActiva) {
        entradaActiva.salida_ts = new Date(ev.created_at).getTime();
        entradaActiva = null;
      }
    });
  });

  guardarAsistencias(resultado);

  if (typeof notificarCambioAsistencias === "function") {
    notificarCambioAsistencias();
  }

  if (!attendanceNotificacionesInicializadas) {
    attendanceNotificacionesInicializadas = true;
    return;
  }

  emitirEventosAttendanceNuevos(nuevosEventosRemotos);
}

function iniciarRealtimeAlumnos() {
  if (pollAlumnosId) return;

  const tick = async () => {
    if (!navigator.onLine) return;
    await cargarAlumnosIniciales();
  };

  tick();
  pollAlumnosId = setInterval(tick, POLL_ALUMNOS_MS);
  console.info("[ALUMNOS] Polling activo");
}

function iniciarRealtimeAttendance() {
  if (pollAttendanceId) return;

  const tick = async () => {
    if (!navigator.onLine) return;
    await reconstruirAsistenciasHoy();
  };

  tick();
  pollAttendanceId = setInterval(tick, POLL_ATTENDANCE_MS);
  console.info("[ATTENDANCE] Polling activo");
}

async function autocerrarAsistenciasPendientes() {
  if (!navigator.onLine) return;
  if (IS_SUPABASE_REST_MODE) return;

  try {
    await apiTry([
      () => apiRequest("/attendance/autocierre", { method: "POST" }),
      () => apiRequest("/attendance/auto-close", { method: "POST" })
    ], { acceptNull: true });
  } catch (err) {
    console.warn("[AUTO-CIERRE] Endpoint no disponible:", err?.message || err);
  }
}

async function migrarUIDEnAttendance(uidAnterior, uidNuevo) {
  if (!navigator.onLine) return;
  if (IS_SUPABASE_REST_MODE) return;
  if (!uidAnterior || !uidNuevo || uidAnterior === uidNuevo) return;

  try {
    await apiTry([
      () => apiRequest("/attendance/migrar-uid", {
        method: "PATCH",
        body: { uidAnterior, uidNuevo }
      }),
      () => apiRequest("/attendance/uid-migration", {
        method: "POST",
        body: { uid_anterior: uidAnterior, uid_nuevo: uidNuevo }
      })
    ], { acceptNull: true });
  } catch (err) {
    console.error("[ATTENDANCE] Error migrando UID:", err?.message || err);
  }
}

async function marcarEventoNFCProcesado(eventId) {
  if (!eventId) return false;

  try {
    const idRaw = String(eventId);
    const idPath = encodeURIComponent(idRaw);

    await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest(`/nfc-events/${idPath}/process`, { method: "POST" }),
        () => apiRequest(`/nfc-events/${idPath}`, { method: "PATCH", body: { processed: true } }),
        () => apiRequest("/nfc-events/process", { method: "POST", body: { id: eventId } })
      ],
      postgrest: [
        () => apiRequest("/nfc_events", {
          method: "PATCH",
          query: { id: pgEq(idRaw) },
          body: { processed: true },
          headers: { Prefer: "return=representation" }
        })
      ]
    }), { acceptNull: true });

    return true;
  } catch (err) {
    console.warn("[NFC] No se pudo marcar processed:", err?.message || err);
    return false;
  }
}

async function obtenerEventoNFCPendiente() {
  if (!navigator.onLine) return null;

  try {
    const claim = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/nfc-events/claim", { method: "POST" }),
        () => apiRequest("/nfc-events/next", { method: "POST" })
      ],
      postgrest: [
        () => apiRequest("/rpc/claim_next_nfc_event", { method: "POST", body: {} }),
        () => apiRequest("/rpc/claim_nfc_event", { method: "POST", body: {} })
      ]
    }), { acceptNull: true });

    const evClaim = normalizarEventoNFC(objetoDesdeRespuesta(claim));
    if (evClaim) return evClaim;
    if (IS_SUPABASE_REST_MODE) return null;
  } catch (_) {
    if (IS_SUPABASE_REST_MODE) return null;
    // fallback abajo
  }

  try {
    const list = await apiTry(ordenarLlamadasApi({
      backend: [
        () => apiRequest("/nfc-events/pending", { query: { limit: 1 } }),
        () => apiRequest("/nfc-events", { query: { processed: false, limit: 1 } })
      ],
      postgrest: [
        () => apiRequest("/nfc_events", {
          query: {
            select: "*",
            processed: "eq.false",
            order: "created_at.asc",
            limit: 1
          }
        })
      ]
    }), { acceptNull: true });

    const eventos = arrayDesdeRespuesta(list)
      .map(normalizarEventoNFC)
      .filter(Boolean);

    const ev = eventos[0] || null;
    if (!ev) return null;

    await marcarEventoNFCProcesado(ev.id);
    return ev;
  } catch (err) {
    console.error("[NFC] Error obteniendo evento:", err?.message || err);
    return null;
  }
}

async function construirResumenDashboardLocal() {
  const alumnos = obtenerAlumnos() || [];
  const asistenciasLocales = obtenerAsistencias() || [];
  const base = {
    total_alumnos: alumnos.length,
    presentes: asistenciasLocales.filter(x => x?.entrada_ts && !x?.salida_ts).length,
    entradas_hoy: 0,
    salidas_hoy: 0,
    asistencias_hoy: asistenciasLocales.length,
    recientes: []
  };

  const { inicioISO: ini, finISO: fn } = rangoHoyISO();
  const eventos = await obtenerEventosAttendanceRemotos({ inicioISO: ini, finISO: fn, asc: true });
  if (!Array.isArray(eventos)) return base;

  const entradas = eventos.filter(e => e.type === "entrada").length;
  const salidas = eventos.filter(e => e.type === "salida").length;
  const lastByPersona = new Map();
  const alumnosPorUID = new Map(
    alumnos.map(a => [normalizarUID(a.tarjetaUID || a.tarjeta_uid || ""), a]).filter(x => x[0])
  );

  eventos.forEach(e => {
    const uidNorm = normalizarUID(e.uid || "");
    const alumnoByUid = uidNorm ? alumnosPorUID.get(uidNorm) : null;
    const key = String(e.alumno_id || alumnoByUid?.id || (uidNorm ? `uid:${uidNorm}` : ""));
    if (!key) return;
    lastByPersona.set(key, e.type);
  });

  const presentes = Array.from(lastByPersona.values()).filter(t => t === "entrada").length;

  return {
    total_alumnos: alumnos.length,
    presentes,
    entradas_hoy: entradas,
    salidas_hoy: salidas,
    asistencias_hoy: eventos.length,
    recientes: eventos.slice(-20).reverse()
  };
}

async function obtenerResumenDashboardRemoto({ inicioISO = null, finISO = null } = {}) {
  if (!navigator.onLine) {
    return construirResumenDashboardLocal();
  }

  if (IS_SUPABASE_REST_MODE) {
    return construirResumenDashboardLocal();
  }

  try {
    const payload = await apiTry([
      () => apiRequest("/dashboard/resumen", { query: { inicio: inicioISO, fin: finISO } }),
      () => apiRequest("/dashboard/live", { query: { from: inicioISO, to: finISO } })
    ], { acceptNull: true });

    const obj = objetoDesdeRespuesta(payload);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (err) {
    console.warn("[DASHBOARD] No disponible, usando resumen local:", err?.message || err);
    return construirResumenDashboardLocal();
  }
}

async function descargarCsvEndpoint(path, query = {}, filename = "reporte.csv") {
  if (!navigator.onLine) return false;

  const supabaseApiKey = resolveSupabaseApiKey();
  const token = resolveBearerToken();

  const url = construirURL(path, query);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(supabaseApiKey ? { apikey: supabaseApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    credentials: shouldIncludeCredentials(url) ? "include" : "omit"
  });

  if (!res.ok) {
    throw new Error(`descarga_error_${res.status}`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return true;
}

function csvEscape(value) {
  const txt = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(txt)) return txt;
  return `"${txt.replace(/"/g, '""')}"`;
}

function triggerCsvDownload(filename, headers = [], rows = []) {
  const head = headers.map(csvEscape).join(",");
  const body = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const csv = `${head}\n${body}`;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function descargarReporteAsistenciasCsv({ inicioISO = null, finISO = null } = {}) {
  const ymd = hoy();
  const filename = `reporte_asistencias_${ymd}.csv`;

  try {
    return await descargarCsvEndpoint(
      "/reportes/asistencias.csv",
      { inicio: inicioISO, fin: finISO },
      filename
    );
  } catch (_) {
    const { inicioISO: ini, finISO: fn } = rangoHoyISO();
    const eventos = await obtenerEventosAttendanceRemotos({
      inicioISO: inicioISO || ini,
      finISO: finISO || fn,
      asc: true
    });

    if (!Array.isArray(eventos)) return false;

    const alumnos = obtenerAlumnos() || [];
    const byId = new Map(alumnos.map(a => [String(a.id), a]));
    const rows = eventos.map(ev => {
      const al = byId.get(String(ev.alumno_id || "")) || {};
      return [
        ev.created_at || "",
        ev.type || "",
        al.nombre || "Alumno",
        al.matricula || "-",
        al.grado || "",
        al.grupo || "",
        ev.uid || ""
      ];
    });

    triggerCsvDownload(
      filename,
      ["FechaHora", "Acción", "Alumno", "Matrícula", "Grado", "Grupo", "UID"],
      rows
    );
    return true;
  }
}

async function descargarReporteDiarioCsv({ inicioISO = null, finISO = null } = {}) {
  const ymd = hoy();
  const filename = `reporte_diario_${ymd}.csv`;

  try {
    return await descargarCsvEndpoint(
      "/reportes/diario.csv",
      { inicio: inicioISO, fin: finISO },
      filename
    );
  } catch (_) {
    const { inicioISO: ini, finISO: fn } = rangoHoyISO();
    const eventos = await obtenerEventosAttendanceRemotos({
      inicioISO: inicioISO || ini,
      finISO: finISO || fn,
      asc: true
    });

    if (!Array.isArray(eventos)) return false;

    const alumnos = obtenerAlumnos() || [];
    const byId = new Map(alumnos.map(a => [String(a.id), a]));
    const mapa = new Map();

    eventos.forEach(ev => {
      const key = String(ev.alumno_id || ev.uid || "");
      if (!key) return;
      const al = byId.get(String(ev.alumno_id || "")) || {};
      const base = mapa.get(key) || {
        fecha: (ev.created_at || "").slice(0, 10),
        alumno: al.nombre || "Alumno",
        matricula: al.matricula || "-",
        grado: al.grado || "",
        grupo: al.grupo || "",
        primeraEntrada: "",
        ultimaSalida: "",
        eventos: 0
      };

      if (ev.type === "entrada" && !base.primeraEntrada) {
        base.primeraEntrada = ev.created_at || "";
      }
      if (ev.type === "salida") {
        base.ultimaSalida = ev.created_at || "";
      }

      base.eventos += 1;
      mapa.set(key, base);
    });

    const rows = Array.from(mapa.values()).map(x => [
      x.fecha,
      x.alumno,
      x.matricula,
      x.grado,
      x.grupo,
      x.primeraEntrada,
      x.ultimaSalida,
      x.eventos
    ]);

    triggerCsvDownload(
      filename,
      ["Fecha", "Alumno", "Matrícula", "Grado", "Grupo", "PrimeraEntrada", "ÚltimaSalida", "Eventos"],
      rows
    );
    return true;
  }
}

/* ======================================================
   ===== EXPORTS GLOBALES ===============================
====================================================== */

window.apiRequest = apiRequest;
window.ensureAlumnosCargados = ensureAlumnosCargados;
window.obtenerAlumnoPorUIDRemoto = obtenerAlumnoPorUIDRemoto;
window.verificarDuplicadoAlumnoRemoto = verificarDuplicadoAlumnoRemoto;
window.insertarAlumnoSupabase = insertarAlumnoSupabase;
window.actualizarAlumnoSupabase = actualizarAlumnoSupabase;
window.borrarAlumnoSupabase = borrarAlumnoSupabase;
window.reconstruirAsistenciasHoy = reconstruirAsistenciasHoy;
window.obtenerEventosAttendanceRemotos = obtenerEventosAttendanceRemotos;
window.obtenerUltimoTipoAsistenciaHoyRemoto = obtenerUltimoTipoAsistenciaHoyRemoto;
window.registrarAsistenciaServidor = registrarAsistenciaServidor;
window.marcarEventoAttendanceComoVisto = marcarEventoAttendanceComoVisto;
window.obtenerEventoNFCPendiente = obtenerEventoNFCPendiente;
window.marcarEventoNFCProcesado = marcarEventoNFCProcesado;
window.obtenerResumenDashboardRemoto = obtenerResumenDashboardRemoto;
window.descargarReporteAsistenciasCsv = descargarReporteAsistenciasCsv;
window.descargarReporteDiarioCsv = descargarReporteDiarioCsv;

/* ======================================================
   ===== INIT GLOBAL ====================================
====================================================== */

window.addEventListener("load", async () => {
  if (typeof ensureAuthSession === "function") {
    const ok = await ensureAuthSession();
    if (!ok) return;
  }

  await ensureAlumnosCargados();
  await logEstadoServidor();

  if (!navigator.onLine) return;

  iniciarRealtimeAlumnos();
  iniciarRealtimeAttendance();

  await autocerrarAsistenciasPendientes();
  await reconstruirAsistenciasHoy();
});

window.addEventListener("online", async () => {
  console.info("[APP] Conexión restablecida");
  alumnosSincronizados = false;
  authErrorRedireccionado = false;

  if (typeof ensureAuthSession === "function") {
    const ok = await ensureAuthSession();
    if (!ok) return;
  }

  await ensureAlumnosCargados();
  await logEstadoServidor();

  iniciarRealtimeAlumnos();
  iniciarRealtimeAttendance();

  await autocerrarAsistenciasPendientes();
  await reconstruirAsistenciasHoy();
});

window.addEventListener("offline", () => {
  console.warn("[APP] Sin conexión a internet");
});

})();

/* ======================================================
   ===== STORAGE OFFLINE FIRST (SOURCE OF TRUTH) =====
====================================================== */

/* ================= UTIL BASE ================= */

function getAppScopePathname() {
  const path = String(window.location.pathname || "/");
  if (path.endsWith("/")) {
    return path.slice(0, -1) || "/";
  }

  const idx = path.lastIndexOf("/");
  if (idx < 0) return "/";
  return path.slice(0, idx) || "/";
}

function sanitizeNamespace(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "_")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "") || "root";
}

const APP_STORAGE_NAMESPACE = `sicae:${sanitizeNamespace(getAppScopePathname())}`;

function storageKey(key) {
  return `${APP_STORAGE_NAMESPACE}:${String(key || "").trim()}`;
}

function storageGetItem(key) {
  return localStorage.getItem(storageKey(key));
}

function storageSetItem(key, value) {
  localStorage.setItem(storageKey(key), String(value));
}

function storageRemoveItem(key) {
  localStorage.removeItem(storageKey(key));
}

function isAppStorageKeyMatch(eventKey, key) {
  const scoped = storageKey(key);
  return eventKey === scoped || eventKey === key;
}

function appBroadcastChannelName(base) {
  return `${String(base || "victory-data")}:${APP_STORAGE_NAMESPACE}`;
}

function createAppBroadcastChannel(base) {
  return new BroadcastChannel(appBroadcastChannelName(base));
}

window.APP_STORAGE_NAMESPACE = APP_STORAGE_NAMESPACE;
window.storageKey = storageKey;
window.storageGetItem = storageGetItem;
window.storageSetItem = storageSetItem;
window.storageRemoveItem = storageRemoveItem;
window.isAppStorageKeyMatch = isAppStorageKeyMatch;
window.appBroadcastChannelName = appBroadcastChannelName;
window.createAppBroadcastChannel = createAppBroadcastChannel;

function safeGet(key) {
  try {
    const raw = storageGetItem(key);
    return raw ? (JSON.parse(raw) || []) : [];
  } catch {
    return [];
  }
}

function safeSet(key, value) {
  storageSetItem(key, JSON.stringify(value));
}

function normalizarUID(uid) {
  return String(uid || "").trim().toUpperCase();
}

/* ======================================================
   ===== ZONA HORARIA CORREGIDA (MEXICO / CHIAPAS) =====
====================================================== */

const APP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * Devuelve fecha real en zona horaria Mexico
 * Formato: YYYY-MM-DD
 */
function hoy() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: APP_TIMEZONE
  });
}

/**
 * Devuelve hora real Mexico HH:mm:ss
 */
function horaActual() {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: APP_TIMEZONE,
    hour12: false
  });
}

function fechaDesdeTS(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

function horaDesdeTS(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-MX", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function rangoHoyISO() {
  const now = new Date();
  const inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const fin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  return {
    fechaLocal: hoy(),
    inicioISO: inicio.toISOString(),
    finISO: fin.toISOString()
  };
}

/**
 * Timestamp absoluto (NO depende de zona)
 */
function ahoraTimestamp() {
  return Date.now();
}

/* ================= ALUMNOS ================= */

function obtenerAlumnos() {
  return safeGet("alumnos");
}

function guardarAlumnos(data) {
  safeSet("alumnos", data);
}

/* ================= ASISTENCIAS ================= */

function obtenerAsistencias() {
  return safeGet("asistencias");
}

function guardarAsistencias(data) {
  safeSet("asistencias", data);
}

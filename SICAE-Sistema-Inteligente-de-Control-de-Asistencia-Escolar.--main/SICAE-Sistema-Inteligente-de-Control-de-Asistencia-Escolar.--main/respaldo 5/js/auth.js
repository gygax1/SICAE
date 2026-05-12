/* ======================================================
   ===== AUTH APP (LOGIN DIARIO + ROLES) ================
====================================================== */

(() => {

const AUTH_TOKEN_KEY = "asistencia_auth_token";
const AUTH_USER_KEY = "asistencia_auth_user";
const AUTH_LOGIN_DAY_KEY = "asistencia_auth_login_day";

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
const AUTH_APP_TIMEZONE = "America/Mexico_City";
let authDayWatcherId = null;

const getStore = typeof storageGetItem === "function"
  ? storageGetItem
  : key => localStorage.getItem(key);
const setStore = typeof storageSetItem === "function"
  ? storageSetItem
  : (key, value) => localStorage.setItem(key, value);
const removeStore = typeof storageRemoveItem === "function"
  ? storageRemoveItem
  : key => localStorage.removeItem(key);

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

function getApiBaseURLForAuth() {
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

function resolveDefaultAuthToken() {
  const token = String(getStore(AUTH_TOKEN_KEY) || "").trim();
  if (!token || token.startsWith("sb_publishable_") || token === "postgrest-direct") {
    return SUPABASE_ANON_KEY;
  }
  if (token.includes(".") && !tokenPerteneceAProyectoActual(token)) {
    return SUPABASE_ANON_KEY;
  }
  return token;
}

function hoyAuth() {
  if (typeof hoy === "function") return hoy();
  return new Date().toLocaleDateString("en-CA", {
    timeZone: AUTH_APP_TIMEZONE
  });
}

function normalizarRol(value) {
  const rol = String(value || "").trim().toLowerCase();
  if (!rol) return "";
  if (rol === "admin" || rol === "direccion") return "direccion";
  if (rol === "capturista" || rol === "docente") return "docente";
  return rol;
}

function normalizarUsuario(raw = {}) {
  const anio = Number(raw.anio_nacimiento ?? raw.anioNacimiento ?? raw.birth_year ?? 0);

  return {
    id: String(raw.id || "").trim(),
    username: String(raw.username || raw.usuario || "").trim(),
    nombre: String(raw.nombre || raw.nombre_completo || raw.full_name || raw.username || "Usuario").trim(),
    rol: normalizarRol(raw.rol || raw.role || "docente"),
    telefono: String(raw.telefono || "").trim(),
    correo: String(raw.correo || "").trim().toLowerCase(),
    curp: String(raw.curp || "").trim().toUpperCase(),
    anio_nacimiento: Number.isFinite(anio) && anio > 0 ? anio : null,
    sexo: String(raw.sexo || "").trim().toUpperCase()
  };
}

function getAuthToken() {
  return resolveDefaultAuthToken();
}

function getAuthUser() {
  try {
    const raw = getStore(AUTH_USER_KEY);
    if (!raw) return null;
    return normalizarUsuario(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isAuthSessionActiveToday() {
  const user = getAuthUser();
  const diaSesion = String(getStore(AUTH_LOGIN_DAY_KEY) || "").trim();
  const diaHoy = hoyAuth();
  return !!(user?.id && diaSesion && diaSesion === diaHoy);
}

function setAuthSession(token, user, { markDay = true } = {}) {
  const safeToken = String(token || resolveDefaultAuthToken() || SUPABASE_ANON_KEY).trim();
  const safeUser = normalizarUsuario(user || {});

  setStore(AUTH_TOKEN_KEY, safeToken || SUPABASE_ANON_KEY);
  setStore(AUTH_USER_KEY, JSON.stringify(safeUser));

  if (markDay) {
    setStore(AUTH_LOGIN_DAY_KEY, hoyAuth());
  }
}

function clearAuthSession({ redirect = true } = {}) {
  removeStore(AUTH_USER_KEY);
  removeStore(AUTH_LOGIN_DAY_KEY);
  setStore(AUTH_TOKEN_KEY, SUPABASE_ANON_KEY);

  if (redirect) {
    const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.href = `login.html?next=${next}`;
  }
}

function isAuthRoleAllowed(allowed = []) {
  if (!Array.isArray(allowed) || !allowed.length) return true;

  const role = normalizarRol(getAuthUser()?.rol || "");
  if (!role) return false;

  if (role === "direccion") {
    return true;
  }

  return allowed.some(r => normalizarRol(r) === role);
}

function getAuthRole() {
  return normalizarRol(getAuthUser()?.rol || "");
}

function requireAuth() {
  if (isAuthSessionActiveToday()) return true;
  clearAuthSession({ redirect: true });
  return false;
}

async function authFetchMe() {
  return getAuthUser();
}

function objetoRespuesta(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  return payload;
}

function authErrorMessage(err, fallback = "No se pudo completar la operacion") {
  const payload = err?.payload && typeof err.payload === "object" ? err.payload : {};
  return String(
    payload.message ||
    payload.error_description ||
    payload.error ||
    err?.message ||
    fallback
  ).trim();
}

async function callAuthRpc(fnName, payload = {}) {
  const base = getApiBaseURLForAuth().replace(/\/+$/, "");
  const url = `${base}/rpc/${fnName}`;
  const token = getAuthToken();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload || {}),
    credentials: shouldIncludeCredentials(url) ? "include" : "omit"
  });

  const raw = await res.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!res.ok) {
    const err = new Error(`[AUTH ${res.status}] ${fnName}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function appAuthRegisterUser(payload = {}) {
  try {
    const res = await callAuthRpc("app_registrar_usuario", {
      p_rol: String(payload.rol || "").trim().toLowerCase(),
      p_nombre_completo: String(payload.nombre_completo || "").trim(),
      p_telefono: String(payload.telefono || "").trim(),
      p_correo: String(payload.correo || "").trim().toLowerCase(),
      p_curp: String(payload.curp || "").trim().toUpperCase(),
      p_anio_nacimiento: Number(payload.anio_nacimiento || 0),
      p_sexo: String(payload.sexo || "").trim().toUpperCase(),
      p_username: String(payload.username || "").trim().toLowerCase(),
      p_password: String(payload.password || ""),
      p_master_password: String(payload.master_password || "")
    });

    const out = objetoRespuesta(res) || {};
    const user = normalizarUsuario(out.user || out);
    if (!user.id) {
      throw new Error("Registro sin respuesta válida");
    }

    return {
      ok: true,
      user,
      message: String(out.message || "Usuario registrado correctamente")
    };
  } catch (err) {
    return {
      ok: false,
      code: String(err?.payload?.code || err?.status || "AUTH_REGISTER_ERROR"),
      message: authErrorMessage(err, "No se pudo registrar el usuario")
    };
  }
}

async function appAuthLogin({ username, password }) {
  try {
    const res = await callAuthRpc("app_login_usuario", {
      p_username: String(username || "").trim().toLowerCase(),
      p_password: String(password || "")
    });

    const out = objetoRespuesta(res) || {};
    const user = normalizarUsuario(out.user || out);
    if (!user.id) {
      throw new Error("Login sin respuesta válida");
    }

    return {
      ok: true,
      user,
      message: String(out.message || "Sesión iniciada")
    };
  } catch (err) {
    return {
      ok: false,
      code: String(err?.payload?.code || err?.status || "AUTH_LOGIN_ERROR"),
      message: authErrorMessage(err, "Usuario o contraseña inválida")
    };
  }
}

function ensureDefaults() {
  const apiBase = getApiBaseURLForAuth();
  setStore("API_BASE_URL", apiBase);
  setStore(AUTH_TOKEN_KEY, getAuthToken());
}

function startAuthDayWatcher() {
  if (authDayWatcherId) return;

  authDayWatcherId = setInterval(() => {
    const needsAuth = document.body?.dataset?.requiresAuth === "true";
    if (!needsAuth) return;
    if (isAuthSessionActiveToday()) return;
    clearAuthSession({ redirect: true });
  }, 30000);
}

function enforcePageRoleAccess() {
  const raw = String(document.body?.dataset?.pageRoleAllow || "").trim();
  if (!raw) return true;

  const allowedRoles = raw.split(",").map(x => x.trim()).filter(Boolean);
  if (isAuthRoleAllowed(allowedRoles)) return true;

  location.href = "index.html";
  return false;
}

async function ensureAuthSession() {
  ensureDefaults();
  if (!requireAuth()) return false;
  return enforcePageRoleAccess();
}

function hydrateAuthUI() {
  const user = getAuthUser();
  const isActiveToday = isAuthSessionActiveToday();

  const userSlots = document.querySelectorAll("[data-auth-user]");
  userSlots.forEach(el => {
    if (!el) return;
    if (!user || !isActiveToday) {
      el.textContent = "Sin sesión";
      return;
    }

    const nombre = String(user.nombre || user.username || "Usuario").trim();
    el.textContent = nombre;
  });

  const restricted = document.querySelectorAll("[data-role-allow]");
  restricted.forEach(el => {
    const raw = String(el.getAttribute("data-role-allow") || "").trim();
    if (!raw) return;
    const roles = raw.split(",").map(x => x.trim()).filter(Boolean);

    const allowed = isAuthRoleAllowed(roles);
    if (!allowed) {
      const hideIfDenied = String(el.getAttribute("data-role-hide-if-denied") || "")
        .trim()
        .toLowerCase() === "true";
      if (hideIfDenied) {
        el.setAttribute("hidden", "hidden");
        el.style.display = "none";
        return;
      }

      if (el.matches("button") || el.matches("input") || el.matches("select") || el.matches("textarea") || el.matches("a")) {
        el.setAttribute("disabled", "disabled");
      }
      el.classList.add("is-disabled-by-role");
    }
  });

  const logoutButtons = document.querySelectorAll("[data-auth-logout]");
  logoutButtons.forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      clearAuthSession({ redirect: true });
    });
  });
}

/* ======================================================
   ===== NFC LOGIN (polling directo, sin realtime.js) ===
====================================================== */

let _nfcLoginTimer = null;
let _nfcLoginActivo = false;

async function _claimNFCParaLogin() {
  const base = getApiBaseURLForAuth().replace(/\/+$/, "");
  const url = `${base}/rpc/claim_next_nfc_event`;
  const token = getAuthToken();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      },
      body: "{}",
      credentials: shouldIncludeCredentials(url) ? "include" : "omit"
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function iniciarNFCLogin({ onUID, onError } = {}) {
  if (_nfcLoginActivo) return;
  _nfcLoginActivo = true;

  const poll = async () => {
    if (!_nfcLoginActivo) return;
    try {
      const ev = await _claimNFCParaLogin();
      const uid = String(ev?.uid || ev?.tarjeta_uid || "").trim().toUpperCase();
      if (uid && typeof onUID === "function") onUID(uid);
    } catch (err) {
      if (typeof onError === "function") onError(err?.message || err);
    }
  };

  poll();
  _nfcLoginTimer = setInterval(poll, 900);
}

function detenerNFCLogin() {
  _nfcLoginActivo = false;
  if (_nfcLoginTimer) {
    clearInterval(_nfcLoginTimer);
    _nfcLoginTimer = null;
  }
}

async function appAuthLoginPorTarjeta(uid) {
  try {
    const uidN = String(uid || "").trim().toUpperCase();
    if (!uidN) throw new Error("UID vacío");

    const res = await callAuthRpc("app_login_por_tarjeta", { p_uid: uidN });
    const out = objetoRespuesta(res) || {};
    const user = normalizarUsuario(out.user || out);
    if (!user.id) throw new Error("Login por tarjeta sin respuesta válida");

    return {
      ok: true,
      user,
      message: String(out.message || "Sesión iniciada por tarjeta")
    };
  } catch (err) {
    return {
      ok: false,
      code: String(err?.payload?.code || err?.status || "AUTH_NFC_ERROR"),
      message: authErrorMessage(err, "Tarjeta no registrada o no autorizada")
    };
  }
}

/* ======================================================
   ===== GESTIÓN DE USUARIOS (solo dirección) ===========
====================================================== */

async function appObtenerUsuarios() {
  try {
    const base = getApiBaseURLForAuth().replace(/\/+$/, "");
    const campos = "id,username,nombre_completo,rol,telefono,correo,curp,anio_nacimiento,sexo,tarjeta_uid,activo,created_at";
    const url = `${base}/app_usuarios?select=${campos}&order=nombre_completo.asc`;
    const token = getAuthToken();

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      },
      credentials: shouldIncludeCredentials(url) ? "include" : "omit"
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, usuarios: Array.isArray(data) ? data : [] };
  } catch (err) {
    return {
      ok: false,
      message: authErrorMessage(err, "No se pudo obtener la lista de usuarios"),
      usuarios: []
    };
  }
}

async function appActualizarUsuario(payload = {}) {
  try {
    const res = await callAuthRpc("app_actualizar_usuario", {
      p_id:             String(payload.id || ""),
      p_nombre_completo: payload.nombre_completo != null ? String(payload.nombre_completo) : undefined,
      p_telefono:        payload.telefono != null ? String(payload.telefono) : undefined,
      p_correo:          payload.correo != null ? String(payload.correo) : undefined,
      p_curp:            payload.curp != null ? String(payload.curp).toUpperCase() : undefined,
      p_anio_nacimiento: payload.anio_nacimiento != null ? Number(payload.anio_nacimiento) || null : undefined,
      p_sexo:            payload.sexo != null ? String(payload.sexo).toUpperCase() : undefined,
      p_tarjeta_uid:     payload.tarjeta_uid != null ? String(payload.tarjeta_uid).toUpperCase() : undefined,
      p_rol:             payload.rol != null ? String(payload.rol).toLowerCase() : undefined,
      p_activo:          payload.activo != null ? Boolean(payload.activo) : undefined
    });

    const out = objetoRespuesta(res) || {};
    return {
      ok: true,
      user: normalizarUsuario(out.user || out),
      message: String(out.message || "Usuario actualizado")
    };
  } catch (err) {
    return {
      ok: false,
      message: authErrorMessage(err, "No se pudo actualizar el usuario")
    };
  }
}

window.AUTH_TOKEN_KEY = AUTH_TOKEN_KEY;
window.AUTH_USER_KEY = AUTH_USER_KEY;
window.AUTH_LOGIN_DAY_KEY = AUTH_LOGIN_DAY_KEY;
window.getAuthToken = getAuthToken;
window.getAuthUser = getAuthUser;
window.setAuthSession = setAuthSession;
window.clearAuthSession = clearAuthSession;
window.requireAuth = requireAuth;
window.ensureAuthSession = ensureAuthSession;
window.isAuthRoleAllowed = isAuthRoleAllowed;
window.getAuthRole = getAuthRole;
window.hydrateAuthUI = hydrateAuthUI;
window.authFetchMe = authFetchMe;
window.isAuthBypassEnabled = () => false;
window.enableAuthBypass = () => false;
window.isAuthSessionActiveToday = isAuthSessionActiveToday;
window.appAuthRegisterUser = appAuthRegisterUser;
window.appAuthLogin = appAuthLogin;
window.appAuthLoginPorTarjeta = appAuthLoginPorTarjeta;
window.iniciarNFCLogin = iniciarNFCLogin;
window.detenerNFCLogin = detenerNFCLogin;
window.appObtenerUsuarios = appObtenerUsuarios;
window.appActualizarUsuario = appActualizarUsuario;
window.DEFAULT_API_BASE_URL = DEFAULT_API_BASE_URL;
window.SUPABASE_PROJECT_URL = SUPABASE_PROJECT_URL;
window.SUPABASE_REST_URL = SUPABASE_REST_URL;
window.SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

window.addEventListener("load", async () => {
  ensureDefaults();

  const needsAuth = document.body?.dataset?.requiresAuth === "true";
  if (!needsAuth) {
    hydrateAuthUI();
    return;
  }

  const ok = await ensureAuthSession();
  if (!ok) return;

  hydrateAuthUI();
  startAuthDayWatcher();
});

})();


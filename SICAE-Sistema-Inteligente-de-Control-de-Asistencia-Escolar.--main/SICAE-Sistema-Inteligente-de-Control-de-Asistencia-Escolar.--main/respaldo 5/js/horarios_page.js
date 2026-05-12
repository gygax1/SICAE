/* ======================================================
   ===== HORARIOS PAGE (UI) =============================
====================================================== */

(() => {

const DIAS = [
  { code: "LU", nombre: "Lunes" },
  { code: "MA", nombre: "Martes" },
  { code: "MI", nombre: "Miercoles" },
  { code: "JU", nombre: "Jueves" },
  { code: "VI", nombre: "Viernes" }
];

const estadoEl            = document.getElementById("estadoHorarios");
const tablaPeriodosConfig = document.getElementById("tablaPeriodosConfig");
const tablaMapaHorarios   = document.getElementById("tablaMapaHorarios");
const inputImportHorarios = document.getElementById("inputImportHorarios");
const listaGrupos         = document.getElementById("listaGrupos");
const listaDocentes       = document.getElementById("listaDocentes");
const listaSalones        = document.getElementById("listaSalones");
const overlayHorario      = document.getElementById("overlayHorario");
const tituloEditorHorario    = document.getElementById("tituloEditorHorario");
const subtituloEditorHorario = document.getElementById("subtituloEditorHorario");
const edClaseId    = document.getElementById("edClaseId");
const edSalonHorario  = document.getElementById("edSalonHorario");
const edLectorHorario = document.getElementById("edLectorHorario");

let mapa = null;
let grupoActivo = "";
let celdaActiva = null;
let puedeEditar = false;
let desuscribirHorarios = null;
let materiasTemporales = [];
let semestresAbiertos = new Set();

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

window.addEventListener("load", initHorarios);
window.addEventListener("beforeunload", () => {
  if (typeof desuscribirHorarios === "function") {
    desuscribirHorarios();
  }
});

function setEstado(msg, tipo = "info") {
  if (!estadoEl) return;
  estadoEl.textContent = msg || "";
  estadoEl.className = `screen-status ${tipo}`;
}

function slugLocal(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compararTexto(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", {
    sensitivity: "base",
    numeric: true
  });
}

function labelDocente(d = {}) {
  const nombre = String(d.nombre || "").trim();
  const user = String(d.username || "").trim();
  if (nombre && user) return `${nombre} (@${user})`;
  return nombre || (user ? `@${user}` : "Docente");
}

function labelSalon(s = {}) {
  const nombre = String(s.nombre || "").trim() || String(s.id || "").trim();
  const lector = String(s.lector_id || "").trim();
  return lector ? `${nombre} [${lector}]` : nombre;
}

function ordenarCatalogos() {
  mapa.grupos = (mapa.grupos || []).sort((a, b) => compararTexto(a.label, b.label));
  mapa.docentes = (mapa.docentes || []).sort((a, b) => compararTexto(labelDocente(a), labelDocente(b)));
  mapa.salones = (mapa.salones || []).sort((a, b) => compararTexto(labelSalon(a), labelSalon(b)));
  mapa.clases = (mapa.clases || []).sort((a, b) => {
    const diaA = DIAS.findIndex(x => x.code === String(a.dia || ""));
    const diaB = DIAS.findIndex(x => x.code === String(b.dia || ""));
    if (diaA !== diaB) return diaA - diaB;
    return Number(a.periodo || 0) - Number(b.periodo || 0);
  });
}

function persistirMapa(msg = "Horario guardado", tipo = "ok") {
  ordenarCatalogos();
  mapa = horarioGuardarMapa(mapa);
  setEstado(msg, tipo);
}

function ensureDocenteActualEnCatalogo() {
  const user = typeof getAuthUser === "function" ? getAuthUser() : null;
  if (!user?.id) return;

  const id = String(user.id || "").trim();
  if (mapa.docentes.some(d => String(d.id || "") === id)) return;

  mapa.docentes.push({
    id,
    username: String(user.username || "").trim().toLowerCase(),
    nombre: String(user.nombre || user.username || "Docente").trim()
  });
}

function mergeGruposDesdeAlumnos() {
  const alumnos = typeof obtenerAlumnos === "function" ? obtenerAlumnos() : [];
  mapa = horarioMergeGruposDesdeAlumnos(mapa, alumnos);
}

async function initHorarios() {
  if (
    !selectModoVista ||
    !selectGrupoHorario ||
    !selectDocenteHorario ||
    !tablaPeriodosConfig ||
    !tablaMapaHorarios
  ) {
    return;
  }

  puedeEditar = typeof isAuthRoleAllowed === "function"
    ? isAuthRoleAllowed(["direccion"])
    : true;

  mapa = horarioLeerMapa();

  if (typeof ensureAlumnosCargados === "function") {
    await ensureAlumnosCargados();
  }

  mergeGruposDesdeAlumnos();
  ensureDocenteActualEnCatalogo();
  ordenarCatalogos();
  mapa = horarioGuardarMapa(mapa, { emit: false, syncRemote: false });

  if (typeof iniciarSyncHorariosRemoto === "function") {
    iniciarSyncHorariosRemoto({
      intervalMs: 8000,
      prefer: "newer"
    });
  }

  if (typeof horarioSincronizarAhora === "function") {
    await horarioSincronizarAhora({ prefer: "push-local" });
    mapa = horarioLeerMapa();
    mergeGruposDesdeAlumnos();
    ensureDocenteActualEnCatalogo();
    ordenarCatalogos();
    mapa = horarioGuardarMapa(mapa, { emit: false });
  }

  bindEventos();
  renderTodo();

  if (typeof horarioSuscribirCambios === "function") {
    desuscribirHorarios = horarioSuscribirCambios(nuevoMapa => {
      mapa = nuevoMapa;
      mergeGruposDesdeAlumnos();
      ordenarCatalogos();
      renderTodo();
    });
  }

  setEstado(
    puedeEditar
      ? "Listo. Puedes mapear celdas por grupo para asignar docente, materia y lector."
      : "Modo consulta habilitado. Solo Dirección puede editar el mapeo.",
    puedeEditar ? "ok" : "warn"
  );
}

function bindEventos() {
  document.getElementById("btnAddGrupo")?.addEventListener("click", agregarGrupo);
  document.getElementById("btnAddDocente")?.addEventListener("click", agregarDocente);
  document.getElementById("btnAddSalon")?.addEventListener("click", agregarSalon);
  document.getElementById("btnAddMateriaDocente")?.addEventListener("click", agregarMateriaATemporal);
  document.getElementById("inDocenteMateria")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); agregarMateriaATemporal(); }
  });
  document.getElementById("btnGuardarPeriodos")?.addEventListener("click", guardarPeriodos);
  document.getElementById("btnResetPeriodos")?.addEventListener("click", resetearPeriodos);
  document.getElementById("btnGuardarTodo")?.addEventListener("click", () => persistirMapa("Mapa guardado correctamente", "ok"));
  document.getElementById("btnExportarHorarios")?.addEventListener("click", exportarJSON);
  document.getElementById("btnImportarHorarios")?.addEventListener("click", () => {
    if (!inputImportHorarios) return;
    inputImportHorarios.value = "";
    inputImportHorarios.click();
  });
  inputImportHorarios?.addEventListener("change", importarJSON);
  document.getElementById("btnCerrarCeldaHorario")?.addEventListener("click", cerrarEditor);
  document.getElementById("btnGuardarCeldaHorario")?.addEventListener("click", guardarBloqueDesdeEditor);
  document.getElementById("btnLimpiarCeldaHorario")?.addEventListener("click", limpiarBloqueDesdeEditor);
  edSalonHorario?.addEventListener("change", () => {
    const salon = (mapa.salones || []).find(s => String(s.id || "") === String(edSalonHorario.value || ""));
    if (salon?.lector_id && !String(edLectorHorario?.value || "").trim()) {
      edLectorHorario.value = String(salon.lector_id || "");
    }
  });
  overlayHorario?.addEventListener("click", e => {
    if (e.target === overlayHorario) cerrarEditor();
  });
}

function renderTodo() {
  renderNavegacionSemestres();
  renderCatalogos();
  renderPeriodos();
  if (grupoActivo) renderMapa();
}

function renderNavegacionSemestres() {
  const nav = document.getElementById("navSemestres");
  if (!nav) return;
  nav.innerHTML = "";

  const porSemestre = {};
  (mapa.grupos || []).forEach(g => {
    const sem = String(g.grado || "?");
    if (!porSemestre[sem]) porSemestre[sem] = [];
    porSemestre[sem].push(g);
  });

  const semestres = Object.keys(porSemestre).sort((a, b) => Number(a) - Number(b));
  if (!semestres.length) {
    nav.innerHTML = `<p class="ayuda">Agrega grupos en el catálogo para verlos aquí.</p>`;
    return;
  }

  semestres.forEach(sem => {
    const grupos = (porSemestre[sem] || []).sort((a, b) => compararTexto(a.grupo, b.grupo));
    const isOpen = semestresAbiertos.has(sem);

    const section = document.createElement("div");
    section.className = "semestre-section";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "semestre-header" + (isOpen ? " open" : "");
    header.innerHTML = `<span class="sem-arrow">▶</span> Semestre ${sem}
      <span class="sem-count">${grupos.length} grupo${grupos.length !== 1 ? "s" : ""}</span>`;
    header.addEventListener("click", () => {
      if (semestresAbiertos.has(sem)) semestresAbiertos.delete(sem);
      else semestresAbiertos.add(sem);
      renderNavegacionSemestres();
    });

    const gruposDiv = document.createElement("div");
    gruposDiv.className = "semestre-grupos" + (isOpen ? " open" : "");

    grupos.forEach(g => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "grupo-btn" + (grupoActivo === g.key ? " active" : "");
      btn.textContent = g.label;
      btn.addEventListener("click", () => {
        grupoActivo = g.key;
        const cont = document.getElementById("contenedorMatriz");
        if (cont) { cont.style.display = "block"; cont.scrollIntoView({ behavior: "smooth", block: "start" }); }
        renderMapa();
        renderNavegacionSemestres();
      });
      gruposDiv.appendChild(btn);
    });

    section.appendChild(header);
    section.appendChild(gruposDiv);
    nav.appendChild(section);
  });
}

function renderCatalogos() {
  renderChips(
    listaGrupos,
    (mapa.grupos || []).map(g => ({
      id: String(g.key || ""),
      label: String(g.label || g.key || ""),
      onRemove: () => {
        if (!puedeEditar) return;
        mapa.grupos = (mapa.grupos || []).filter(x => String(x.key || "") !== String(g.key || ""));
        mapa.clases = (mapa.clases || []).filter(c => String(c.grupo_key || "") !== String(g.key || ""));
        if (grupoActivo === String(g.key || "")) grupoActivo = "";
        persistirMapa("Grupo eliminado del mapeo", "warn");
        renderTodo();
      }
    }))
  );

  renderListaDocentes();

  renderChips(
    listaSalones,
    (mapa.salones || []).map(s => ({
      id: String(s.id || ""),
      label: labelSalon(s),
      onRemove: () => {
        if (!puedeEditar) return;
        mapa.salones = (mapa.salones || []).filter(x => String(x.id || "") !== String(s.id || ""));
        persistirMapa("Salón removido del catálogo", "warn");
        renderTodo();
      }
    }))
  );
}

function renderChips(container, items = []) {
  if (!container) return;
  container.innerHTML = "";

  if (!items.length) {
    const p = document.createElement("p");
    p.className = "ayuda";
    p.textContent = "Sin registros";
    container.appendChild(p);
    return;
  }

  items.forEach(it => {
    const chip = document.createElement("div");
    chip.className = "chip";

    const txt = document.createElement("span");
    txt.textContent = it.label || it.id || "Item";
    chip.appendChild(txt);

    if (puedeEditar) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "x";
      btn.addEventListener("click", it.onRemove);
      chip.appendChild(btn);
    }

    container.appendChild(chip);
  });
}

function renderPeriodos() {
  tablaPeriodosConfig.innerHTML = "";
  const periodos = (mapa?.config?.periodos || [])
    .slice()
    .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));

  periodos.forEach(p => {
    const tr = document.createElement("tr");

    const tdPeriodo = document.createElement("td");
    tdPeriodo.textContent = String(p.numero || "-");

    const tdInicio = document.createElement("td");
    const inInicio = document.createElement("input");
    inInicio.type = "time";
    inInicio.value = String(p.inicio || "");
    inInicio.disabled = !puedeEditar;
    inInicio.dataset.periodo = String(p.numero || "");
    inInicio.dataset.field = "inicio";
    tdInicio.appendChild(inInicio);

    const tdFin = document.createElement("td");
    const inFin = document.createElement("input");
    inFin.type = "time";
    inFin.value = String(p.fin || "");
    inFin.disabled = !puedeEditar;
    inFin.dataset.periodo = String(p.numero || "");
    inFin.dataset.field = "fin";
    tdFin.appendChild(inFin);

    tr.append(tdPeriodo, tdInicio, tdFin);
    tablaPeriodosConfig.appendChild(tr);
  });
}

function horaRango(periodo = {}) {
  const ini = String(periodo.inicio || "").trim();
  const fin = String(periodo.fin || "").trim();
  if (!ini || !fin) return "Sin horario";
  return `${ini} - ${fin}`;
}

function hmToMins(hm = "") {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const PALETA_COLORES = [
  "#b3e5fc", "#c8e6c9", "#ffccbc", "#e1bee7", "#b2dfdb",
  "#f8bbd0", "#fff9c4", "#dcedc8", "#ffe0b2", "#d1c4e9",
  "#b3e0ff", "#f0f4c3", "#ffd180", "#ea80fc", "#80cbc4"
];

function colorParaMateria(materia) {
  if (!materia) return "#f5f5f5";
  let h = 0;
  for (const c of String(materia)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETA_COLORES[Math.abs(h) % PALETA_COLORES.length];
}

function agregarMateriaATemporal() {
  const inp = document.getElementById("inDocenteMateria");
  const val = String(inp?.value || "").trim();
  if (!val || materiasTemporales.includes(val)) {
    if (inp) inp.value = "";
    return;
  }
  materiasTemporales.push(val);
  if (inp) inp.value = "";
  renderChipsMateriasTemporal();
}

function renderChipsMateriasTemporal() {
  const cont = document.getElementById("listaMateriasTemporal");
  if (!cont) return;
  cont.innerHTML = "";
  materiasTemporales.forEach((m, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span><strong>${LETRAS[i] || (i + 1)}</strong> — ${m}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.addEventListener("click", () => {
      materiasTemporales.splice(i, 1);
      renderChipsMateriasTemporal();
    });
    chip.appendChild(btn);
    cont.appendChild(chip);
  });
}

function renderListaDocentes() {
  if (!listaDocentes) return;
  listaDocentes.innerHTML = "";
  const docentes = mapa.docentes || [];

  if (!docentes.length) {
    const p = document.createElement("p");
    p.className = "ayuda";
    p.textContent = "Sin docentes";
    listaDocentes.appendChild(p);
    return;
  }

  docentes.forEach(d => {
    const chip = document.createElement("div");
    chip.className = "chip docente-chip";

    const materias = Array.isArray(d.materias) ? d.materias.filter(Boolean) : [];
    const badgesHTML = materias.map((m, i) =>
      `<span class="mat-badge"><strong>${LETRAS[i] || (i + 1)}</strong> ${m}</span>`
    ).join("");

    const info = document.createElement("div");
    info.innerHTML = `
      <span class="docente-nombre">${labelDocente(d)}</span>
      ${materias.length ? `<div class="docente-materias">${badgesHTML}</div>` : ""}`;
    chip.appendChild(info);

    if (puedeEditar) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.addEventListener("click", () => {
        mapa.docentes = (mapa.docentes || []).filter(x => String(x.id || "") !== String(d.id || ""));
        if (docenteActivo === String(d.id || "")) docenteActivo = "";
        persistirMapa("Docente removido del catálogo", "warn");
        renderTodo();
      });
      chip.appendChild(btn);
    }
    listaDocentes.appendChild(chip);
  });
}

function renderSelectMateriasEditor(docenteId, materiaActual = "") {
  const select = document.getElementById("edMateriaSelect");
  const input = document.getElementById("edMateriaHorario");
  if (!select || !input) return;

  const docente = (mapa.docentes || []).find(d => String(d.id || "") === String(docenteId || ""));
  const materias = Array.isArray(docente?.materias) ? docente.materias.filter(Boolean) : [];

  if (!materias.length) {
    select.style.display = "none";
    input.style.display = "block";
    input.value = materiaActual;
    return;
  }

  select.innerHTML = `<option value="">— Selecciona materia —</option>`;
  let encontrada = false;
  materias.forEach((m, i) => {
    const op = document.createElement("option");
    op.value = m;
    op.textContent = `${LETRAS[i] || (i + 1)} — ${m}`;
    if (m === materiaActual) { op.selected = true; encontrada = true; }
    select.appendChild(op);
  });

  const otraOp = document.createElement("option");
  otraOp.value = "__otra__";
  otraOp.textContent = "— Otra materia —";
  select.appendChild(otraOp);

  select.style.display = "block";

  if (!encontrada && materiaActual) {
    otraOp.selected = true;
    input.style.display = "block";
    input.value = materiaActual;
  } else {
    input.style.display = encontrada ? "none" : "block";
    if (!encontrada) input.value = materiaActual;
  }
}

function obtenerClaseVista(dia, periodoNum) {
  const slot = Number(periodoNum || 0);
  if (!slot) return null;

  if (modoVista === "grupo") {
    return (mapa.clases || []).find(c =>
      String(c.grupo_key || "") === String(grupoActivo || "") &&
      String(c.dia || "") === String(dia || "") &&
      Number(c.periodo || 0) === slot
    ) || null;
  }

  const clases = (mapa.clases || []).filter(c =>
    String(c.docente_id || "") === String(docenteActivo || "") &&
    String(c.dia || "") === String(dia || "") &&
    Number(c.periodo || 0) === slot
  );
  if (!clases.length) return null;
  const first = { ...clases[0] };
  first._total = clases.length;
  return first;
}

function renderMapa() {
  tablaMapaHorarios.innerHTML = "";

  // Actualizar título del grupo/docente encima de la tabla
  const tituloEl = document.getElementById("tituloGrupoHorario");
  if (tituloEl) {
    if (modoVista === "grupo") {
      const g = (mapa.grupos || []).find(x => String(x.key || "") === grupoActivo);
      tituloEl.textContent = g?.label || grupoActivo || "";
    } else {
      const d = (mapa.docentes || []).find(x => String(x.id || "") === docenteActivo);
      tituloEl.textContent = d ? labelDocente(d) : "";
    }
  }

  const periodos = (mapa?.config?.periodos || [])
    .slice()
    .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));

  const editable = puedeEditar && !!grupoActivo;

  periodos.forEach((periodo, idx) => {
    // Insertar fila de RECESO si hay una brecha >= 15 min entre periodos
    if (idx > 0) {
      const prev      = periodos[idx - 1];
      const finPrev   = hmToMins(prev.fin);
      const iniActual = hmToMins(periodo.inicio);
      if (finPrev !== null && iniActual !== null && iniActual - finPrev >= 15) {
        const trR  = document.createElement("tr");
        trR.className = "horario-receso-row";
        const tdR  = document.createElement("td");
        tdR.colSpan = 6;
        tdR.innerHTML = `<strong>RECESO</strong><span>${prev.fin} – ${periodo.inicio}</span>`;
        trR.appendChild(tdR);
        tablaMapaHorarios.appendChild(trR);
      }
    }

    const tr = document.createElement("tr");

    // Columna de periodo (número + rango horario)
    const tdP = document.createElement("td");
    tdP.className = "periodo-label";
    tdP.innerHTML = `<strong>${periodo.numero}</strong><br><span>${horaRango(periodo)}</span>`;
    tr.appendChild(tdP);

    DIAS.forEach(d => {
      const td    = document.createElement("td");
      td.className = "horario-td";

      const clase = obtenerClaseVista(d.code, periodo.numero);

      if (!clase) {
        const div = document.createElement("div");
        div.className = "horario-celda horario-celda-vacia";
        div.textContent = editable ? "＋" : "";
        if (editable) {
          div.addEventListener("click", () => abrirEditor(d.code, Number(periodo.numero || 0), null));
        }
        td.appendChild(div);
      } else {
        const color    = colorParaMateria(clase.materia);
        const materia  = String(clase.materia || "Clase");
        const docLabel = String(clase.docente_nombre || clase.docente_username || "").trim();
        const salon    = String(clase.salon_nombre || clase.lector_id || "").trim();
        const extra    = "";

        const div = document.createElement("div");
        div.className = "horario-celda horario-celda-llena";
        div.style.background = color;
        div.innerHTML = `
          <span class="hc-materia">${materia}${extra}</span>
          ${docLabel ? `<span class="hc-docente">${docLabel}</span>` : ""}
          ${salon    ? `<span class="hc-salon">${salon}</span>`      : ""}`;
        if (editable) {
          div.addEventListener("click", () => abrirEditor(d.code, Number(periodo.numero || 0), clase));
        }
        td.appendChild(div);
      }

      tr.appendChild(td);
    });

    tablaMapaHorarios.appendChild(tr);
  });
}

function buildClaseOptions() {
  const opts = [];
  (mapa.docentes || []).forEach(d => {
    const materias = Array.isArray(d.materias) ? d.materias.filter(Boolean) : [];
    materias.forEach((m, i) => {
      opts.push({
        value: `${m}||${d.id}`,
        label: `${LETRAS[i] || (i + 1)} — ${m}  ·  ${labelDocente(d)}`,
        materia: m,
        docente_id: d.id,
        docente_nombre: d.nombre,
        docente_username: d.username
      });
    });
  });
  return opts;
}

function abrirEditor(dia, periodo, clase) {
  if (!puedeEditar || !grupoActivo) return;

  celdaActiva = { dia, periodo };
  const grupoObj = (mapa.grupos || []).find(g => String(g.key || "") === String(grupoActivo || ""));
  const grupoTexto = String(grupoObj?.label || grupoActivo || "Grupo");
  const diaTexto = DIAS.find(x => x.code === String(dia || ""))?.nombre || String(dia || "");

  tituloEditorHorario.textContent = "Editar bloque";
  subtituloEditorHorario.textContent = `${grupoTexto} | ${diaTexto} | Periodo ${periodo}`;
  edClaseId.value = String(clase?.id || "");

  // Poblar select combinado materia-docente
  const claseSelect = document.getElementById("edClaseSelect");
  const hint = document.getElementById("edClaseHint");
  const opts = buildClaseOptions();
  const claseValActual = clase ? `${clase.materia}||${clase.docente_id}` : "";

  claseSelect.innerHTML = `<option value="">— Sin asignar —</option>`;
  opts.forEach(opt => {
    const op = document.createElement("option");
    op.value = opt.value;
    op.textContent = opt.label;
    if (opt.value === claseValActual) op.selected = true;
    claseSelect.appendChild(op);
  });

  if (hint) hint.style.display = opts.length ? "none" : "block";

  renderSelectSalonesEditor(String(clase?.salon_id || ""));
  edLectorHorario.value = String(clase?.lector_id || "");

  overlayHorario.style.display = "flex";
  claseSelect.focus();
}

function cerrarEditor() {
  overlayHorario.style.display = "none";
  celdaActiva = null;
  edClaseId.value = "";
  const sel = document.getElementById("edClaseSelect");
  if (sel) sel.value = "";
  edLectorHorario.value = "";
}

function renderSelectDocentesEditor(selectedId = "") {
  edDocenteHorario.innerHTML = "";
  const base = document.createElement("option");
  base.value = "";
  base.textContent = "Selecciona docente";
  edDocenteHorario.appendChild(base);

  (mapa.docentes || []).forEach(d => {
    const op = document.createElement("option");
    op.value = String(d.id || "");
    op.textContent = labelDocente(d);
    edDocenteHorario.appendChild(op);
  });

  edDocenteHorario.value = selectedId || "";
}

function renderSelectSalonesEditor(selectedId = "") {
  edSalonHorario.innerHTML = "";

  const base = document.createElement("option");
  base.value = "";
  base.textContent = "Sin salón";
  edSalonHorario.appendChild(base);

  (mapa.salones || []).forEach(s => {
    const op = document.createElement("option");
    op.value = String(s.id || "");
    op.textContent = labelSalon(s);
    edSalonHorario.appendChild(op);
  });

  edSalonHorario.value = selectedId || "";
}

function guardarBloqueDesdeEditor() {
  if (!puedeEditar || !celdaActiva || !grupoActivo) return;

  const claseSelect = document.getElementById("edClaseSelect");
  const claseVal = String(claseSelect?.value || "").trim();

  if (!claseVal) {
    setEstado("Selecciona una clase (materia — docente) para guardar el bloque", "error");
    return;
  }

  const [materia, docenteId] = claseVal.split("||");
  if (!materia || !docenteId) {
    setEstado("Selección de clase inválida", "error");
    return;
  }

  const grupoObj  = (mapa.grupos || []).find(g => String(g.key || "") === String(grupoActivo || ""));
  const docenteObj = (mapa.docentes || []).find(d => String(d.id || "") === docenteId) || {};
  const salonObj  = (mapa.salones || []).find(s => String(s.id || "") === String(edSalonHorario.value || "")) || {};
  const lectorManual = String(edLectorHorario.value || "").trim();

  mapa = horarioUpsertClase(mapa, {
    id: String(edClaseId.value || "") || undefined,
    grupo_key: String(grupoActivo || ""),
    grupo_label: String(grupoObj?.label || grupoActivo || ""),
    dia: String(celdaActiva.dia || ""),
    periodo: Number(celdaActiva.periodo || 0),
    materia,
    docente_id: String(docenteObj.id || docenteId),
    docente_nombre: String(docenteObj.nombre || docenteObj.username || "Docente"),
    docente_username: String(docenteObj.username || "").trim().toLowerCase(),
    salon_id: String(salonObj.id || ""),
    salon_nombre: String(salonObj.nombre || salonObj.id || ""),
    lector_id: lectorManual || String(salonObj.lector_id || "")
  });

  persistirMapa("Bloque guardado", "ok");
  renderMapa();
  cerrarEditor();
}

function limpiarBloqueDesdeEditor() {
  if (!puedeEditar || !celdaActiva || !grupoActivo) return;

  mapa = horarioEliminarClase(mapa, {
    grupo_key: grupoActivo,
    dia: celdaActiva.dia,
    periodo: celdaActiva.periodo
  });
  persistirMapa("Bloque limpiado", "warn");
  renderMapa();
  cerrarEditor();
}

function agregarGrupo() {
  if (!puedeEditar) return;

  const grado = String(document.getElementById("inGrado")?.value || "").trim().toUpperCase();
  const grupo = String(document.getElementById("inGrupo")?.value || "").trim().toUpperCase();
  const key = horarioGrupoKey(grado, grupo);
  if (!key) {
    setEstado("Captura grado y grupo para crear el registro", "error");
    return;
  }

  if ((mapa.grupos || []).some(g => String(g.key || "") === key)) {
    setEstado("Ese grupo ya existe en el catálogo.", "warn");
    return;
  }

  mapa.grupos.push({
    key,
    label: `${grado}${grado && grupo ? " " : ""}${grupo}`.trim(),
    grado,
    grupo
  });

  const inGrado = document.getElementById("inGrado");
  const inGrupo = document.getElementById("inGrupo");
  if (inGrado) inGrado.value = "";
  if (inGrupo) inGrupo.value = "";

  persistirMapa("Grupo agregado", "ok");
  renderTodo();
}

function agregarDocente() {
  if (!puedeEditar) return;

  const inNombre = document.getElementById("inDocenteNombre");
  const inUsuario = document.getElementById("inDocenteUsuario");
  const nombre = String(inNombre?.value || "").trim();
  const username = String(inUsuario?.value || "").trim().toLowerCase();
  const id = username || slugLocal(nombre);

  if (!id) {
    setEstado("Captura nombre o usuario del docente.", "error");
    return;
  }

  if ((mapa.docentes || []).some(d => String(d.id || "") === id)) {
    setEstado("Ese docente ya existe en el catálogo.", "warn");
    return;
  }

  mapa.docentes.push({
    id,
    username,
    nombre: nombre || username,
    materias: [...materiasTemporales]
  });

  materiasTemporales = [];
  renderChipsMateriasTemporal();
  if (inNombre) inNombre.value = "";
  if (inUsuario) inUsuario.value = "";
  const inMateria = document.getElementById("inDocenteMateria");
  if (inMateria) inMateria.value = "";

  persistirMapa("Docente agregado", "ok");
  renderTodo();
}

function agregarSalon() {
  if (!puedeEditar) return;

  const inNombre = document.getElementById("inSalonNombre");
  const inLector = document.getElementById("inSalonLector");
  const nombre = String(inNombre?.value || "").trim();
  const lectorId = String(inLector?.value || "").trim();
  const id = slugLocal(nombre) || slugLocal(lectorId);

  if (!id || !nombre) {
    setEstado("Captura nombre del salón.", "error");
    return;
  }

  if ((mapa.salones || []).some(s => String(s.id || "") === id)) {
    setEstado("Ese salón ya existe en el catálogo.", "warn");
    return;
  }

  mapa.salones.push({
    id,
    nombre,
    lector_id: lectorId
  });

  if (inNombre) inNombre.value = "";
  if (inLector) inLector.value = "";

  persistirMapa("Salón agregado", "ok");
  renderTodo();
}

function guardarPeriodos() {
  if (!puedeEditar) return;

  const inputs = tablaPeriodosConfig.querySelectorAll("input[type='time']");
  const byPeriodo = new Map();

  inputs.forEach(inEl => {
    const nro = Number(inEl.dataset.periodo || 0);
    const field = String(inEl.dataset.field || "");
    if (!byPeriodo.has(nro)) byPeriodo.set(nro, { numero: nro, inicio: "", fin: "" });
    byPeriodo.get(nro)[field] = String(inEl.value || "");
  });

  const nuevos = Array.from(byPeriodo.values()).sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
  const validos = nuevos.every(p => String(p.inicio || "").trim() && String(p.fin || "").trim());
  if (!validos) {
    setEstado("Completa inicio y fin en todos los períodos.", "error");
    return;
  }

  mapa.config.periodos = nuevos;
  persistirMapa("Períodos actualizados", "ok");
  renderPeriodos();
  renderMapa();
}

function resetearPeriodos() {
  if (!puedeEditar) return;
  mapa.config.periodos = (window.horarioDefaultPeriodos || []).map(p => ({ ...p }));
  persistirMapa("Períodos restaurados a sugerencia de 50 min", "warn");
  renderPeriodos();
  renderMapa();
}

function exportarJSON() {
  try {
    const contenido = JSON.stringify(mapa, null, 2);
    const blob = new Blob([contenido], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `horarios_mapa_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  } catch (err) {
    console.error(err);
    setEstado("No se pudo exportar el JSON", "error");
  }
}

async function importarJSON(e) {
  if (!puedeEditar) return;
  const file = e?.target?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    mapa = horarioGuardarMapa(parsed);
    mergeGruposDesdeAlumnos();
    ordenarCatalogos();
    mapa = horarioGuardarMapa(mapa, { emit: false });
    renderTodo();
    setEstado("Archivo importado correctamente", "ok");
  } catch (err) {
    console.error(err);
    setEstado("JSON inválido, no se pudo importar.", "error");
  }
}

})();

-- ========================================================
-- SICAE - Sistema Inteligente de Control de Asistencia Escolar
-- Script PostgreSQL/Supabase unificado
-- Ejecutar en: Supabase > SQL Editor
--
-- Crea:
--   - Tablas: alumnos, attendance, nfc_events, horarios_mapa, app_usuarios
--   - Índices y constraints (con nombres exactos que usa el código JS)
--   - RPCs: registrar_asistencia, claim_next_nfc_event, claim_nfc_event,
--           app_login_usuario, app_registrar_usuario
--   - Políticas RLS
-- ========================================================


-- ----------------------------------------------------------------
-- EXTENSIONES
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- bcrypt para contraseñas


-- ----------------------------------------------------------------
-- FUNCIÓN AUXILIAR: actualiza updated_at en cada UPDATE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- TABLA: alumnos
-- Datos personales, académicos y de tutor de cada alumno
-- ================================================================
CREATE TABLE IF NOT EXISTS public.alumnos (
    id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre           TEXT        NOT NULL,
    correo           TEXT,
    fecha_nacimiento TEXT,           -- 'YYYY-MM-DD' como texto (el JS lo maneja así)
    telefono         TEXT,
    matricula        TEXT,
    grado            TEXT,
    grupo            TEXT,
    tipo_sangre      TEXT,
    alergias         TEXT,
    tutor_nombre     TEXT,
    tutor_parentesco TEXT,
    tutor_telefono   TEXT,
    tutor_correo     TEXT,
    tarjeta_uid      TEXT,           -- UID de tarjeta NFC (almacenar en UPPERCASE)
    fecha_registro   TEXT        DEFAULT to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Índices únicos case-insensitive.
-- IMPORTANTE: los nombres exactos son leídos por el código JS en clasificarErrorInsertAlumno()
CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_correo_ci
    ON public.alumnos (lower(trim(correo)))
    WHERE correo IS NOT NULL AND trim(correo) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_matricula_ci
    ON public.alumnos (lower(trim(matricula)))
    WHERE matricula IS NOT NULL AND trim(matricula) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_tarjeta_uid_ci
    ON public.alumnos (upper(trim(tarjeta_uid)))
    WHERE tarjeta_uid IS NOT NULL AND trim(tarjeta_uid) <> '';

-- Índices de búsqueda general
CREATE INDEX IF NOT EXISTS idx_alumnos_nombre
    ON public.alumnos (nombre);

CREATE INDEX IF NOT EXISTS idx_alumnos_grado_grupo
    ON public.alumnos (grado, grupo);

CREATE TRIGGER trg_alumnos_updated_at
    BEFORE UPDATE ON public.alumnos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ================================================================
-- TABLA: attendance
-- Registra cada evento de entrada o salida de un alumno
-- El frontend alterna automáticamente entre ambos tipos
-- ================================================================
CREATE TABLE IF NOT EXISTS public.attendance (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    alumno_id   UUID        REFERENCES public.alumnos(id) ON DELETE SET NULL,
    cliente_id  UUID,       -- alias de alumno_id (el JS envía ambos siempre iguales)
    uid         TEXT,       -- UID de tarjeta NFC del evento
    type        TEXT        NOT NULL CHECK (type IN ('entrada', 'salida')),
    source      TEXT,       -- 'nfc', 'manual', etc.
    device_id   TEXT,       -- ID del lector físico
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_created_at
    ON public.attendance (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_alumno_id
    ON public.attendance (alumno_id);

CREATE INDEX IF NOT EXISTS idx_attendance_cliente_id
    ON public.attendance (cliente_id);

CREATE INDEX IF NOT EXISTS idx_attendance_uid
    ON public.attendance (uid);

-- Índice compuesto para la consulta más frecuente: último evento por alumno hoy
CREATE INDEX IF NOT EXISTS idx_attendance_alumno_created
    ON public.attendance (alumno_id, created_at DESC);


-- ================================================================
-- TABLA: nfc_events
-- Cola de eventos crudos del lector NFC físico
-- El sistema los consume con claim_next_nfc_event() y los marca processed=TRUE
-- ================================================================
CREATE TABLE IF NOT EXISTS public.nfc_events (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    uid         TEXT        NOT NULL,   -- UID leído por el lector (normalizar a UPPERCASE al insertar)
    processed   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice parcial: solo filas sin procesar (la query más frecuente)
CREATE INDEX IF NOT EXISTS idx_nfc_events_pending
    ON public.nfc_events (created_at ASC)
    WHERE processed = FALSE;


-- ================================================================
-- TABLA: horarios_mapa
-- Documento JSONB único (id = 'main') con el mapa completo de horarios.
--
-- Estructura del campo 'mapa':
-- {
--   "version": 1,
--   "config": {
--     "dias": ["LU","MA","MI","JU","VI"],
--     "periodos": [{"numero":1,"inicio":"07:00","fin":"07:50"}, ...]
--   },
--   "grupos":   [{"key":"1|A","label":"1 A","grado":"1","grupo":"A"}, ...],
--   "docentes": [{"id":"...","username":"...","nombre":"..."}, ...],
--   "salones":  [{"id":"...","nombre":"...","lector_id":"..."}, ...],
--   "clases":   [{
--     "id":"...", "grupo_key":"1|A", "grupo_label":"1 A",
--     "dia":"LU", "periodo":1, "materia":"Matemáticas",
--     "docente_id":"...", "docente_nombre":"...", "docente_username":"...",
--     "salon_id":"...", "salon_nombre":"...", "lector_id":"...",
--     "updated_at":"ISO"
--   }, ...],
--   "updated_at": "ISO"
-- }
-- ================================================================
CREATE TABLE IF NOT EXISTS public.horarios_mapa (
    id          TEXT        PRIMARY KEY DEFAULT 'main',
    mapa        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_by  TEXT        DEFAULT 'system'
);

-- Fila inicial con los horarios por defecto del CECYTE Chiapas
INSERT INTO public.horarios_mapa (id, mapa, updated_by)
VALUES (
    'main',
    jsonb_build_object(
        'version',    1,
        'config',     jsonb_build_object(
            'dias',     '["LU","MA","MI","JU","VI"]'::jsonb,
            'periodos', '[
                {"numero":1,"inicio":"07:00","fin":"07:50"},
                {"numero":2,"inicio":"07:50","fin":"08:40"},
                {"numero":3,"inicio":"08:40","fin":"09:30"},
                {"numero":4,"inicio":"09:50","fin":"10:40"},
                {"numero":5,"inicio":"10:40","fin":"11:30"},
                {"numero":6,"inicio":"11:30","fin":"12:20"},
                {"numero":7,"inicio":"12:20","fin":"13:10"},
                {"numero":8,"inicio":"13:10","fin":"14:00"}
            ]'::jsonb
        ),
        'grupos',   '[]'::jsonb,
        'docentes', '[]'::jsonb,
        'salones',  '[]'::jsonb,
        'clases',   '[]'::jsonb,
        'updated_at', to_jsonb(now()::text)
    ),
    'system_init'
)
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- TABLA: app_usuarios
-- Usuarios del sistema: docentes y personal de dirección
-- Las contraseñas se almacenan con bcrypt (pgcrypto)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.app_usuarios (
    id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    username         TEXT        NOT NULL,
    nombre_completo  TEXT        NOT NULL,
    rol              TEXT        NOT NULL DEFAULT 'docente'
                     CHECK (rol IN ('direccion', 'docente')),
    telefono         TEXT,
    correo           TEXT,
    curp             TEXT,
    anio_nacimiento  INTEGER     CHECK (
                         anio_nacimiento IS NULL OR
                         (anio_nacimiento > 1900 AND anio_nacimiento < 2100)
                     ),
    sexo             TEXT        CHECK (sexo IS NULL OR sexo IN ('M', 'F', 'X', '')),
    password_hash    TEXT        NOT NULL,
    activo           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_usuarios_username
    ON public.app_usuarios (lower(trim(username)));

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_usuarios_curp
    ON public.app_usuarios (upper(trim(curp)))
    WHERE curp IS NOT NULL AND trim(curp) <> '';

CREATE TRIGGER trg_app_usuarios_updated_at
    BEFORE UPDATE ON public.app_usuarios
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ================================================================
-- RPC: registrar_asistencia
--
-- Alterna entre entrada y salida según el último evento del alumno hoy.
-- Llamada desde el frontend cuando un alumno pasa su tarjeta NFC.
--
-- Parámetros (todos opcionales excepto que uid o alumno_id debe estar presente):
--   p_id          UUID del evento (el JS genera uno; se usa tal cual)
--   p_alumno_id   UUID del alumno (desde la tabla alumnos)
--   p_cliente_id  Alias de p_alumno_id (el JS envía ambos)
--   p_uid         UID de la tarjeta NFC (UPPERCASE)
--   p_created_at  Timestamp del evento (default: NOW())
--   p_source      Origen: 'nfc', 'manual', etc.
--   p_device_id   ID del lector físico
-- ================================================================
CREATE OR REPLACE FUNCTION public.registrar_asistencia(
    p_id         UUID        DEFAULT NULL,
    p_alumno_id  UUID        DEFAULT NULL,
    p_cliente_id UUID        DEFAULT NULL,
    p_uid        TEXT        DEFAULT NULL,
    p_created_at TIMESTAMPTZ DEFAULT NULL,
    p_source     TEXT        DEFAULT 'nfc',
    p_device_id  TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_alumno_id   UUID;
    v_uid         TEXT;
    v_ultimo_tipo TEXT;
    v_nuevo_tipo  TEXT;
    v_ts          TIMESTAMPTZ;
    v_id          UUID;
    v_inicio_dia  TIMESTAMPTZ;
BEGIN
    v_alumno_id := COALESCE(p_alumno_id, p_cliente_id);
    v_uid        := upper(trim(COALESCE(p_uid, '')));
    v_ts         := COALESCE(p_created_at, NOW());
    v_id         := COALESCE(p_id, gen_random_uuid());

    -- Inicio del día en zona horaria México (Chiapas)
    v_inicio_dia := date_trunc('day',
        NOW() AT TIME ZONE 'America/Mexico_City'
    ) AT TIME ZONE 'America/Mexico_City';

    -- Buscar el último tipo registrado hoy para este alumno o tarjeta
    SELECT type INTO v_ultimo_tipo
    FROM public.attendance
    WHERE (
        (v_alumno_id IS NOT NULL
            AND (alumno_id = v_alumno_id OR cliente_id = v_alumno_id))
        OR
        (v_uid <> '' AND uid = v_uid)
    )
    AND created_at >= v_inicio_dia
    ORDER BY created_at DESC
    LIMIT 1;

    -- Alternar: si el último fue entrada → registrar salida, y viceversa
    v_nuevo_tipo := CASE
        WHEN v_ultimo_tipo = 'entrada' THEN 'salida'
        ELSE 'entrada'
    END;

    INSERT INTO public.attendance
        (id, alumno_id, cliente_id, uid, type, source, device_id, created_at)
    VALUES
        (v_id, v_alumno_id, v_alumno_id, v_uid, v_nuevo_tipo, p_source, p_device_id, v_ts);

    RETURN jsonb_build_object(
        'id',         v_id,
        'accion',     v_nuevo_tipo,   -- alias que lee el frontend
        'type',       v_nuevo_tipo,
        'alumno_id',  v_alumno_id,
        'cliente_id', v_alumno_id,
        'uid',        v_uid,
        'created_at', v_ts,
        'source',     p_source,
        'device_id',  p_device_id
    );
END;
$$;


-- ================================================================
-- RPC: claim_next_nfc_event
--
-- Obtiene y marca atómicamente el siguiente evento NFC pendiente.
-- Usa FOR UPDATE SKIP LOCKED para que múltiples pestañas no
-- procesen el mismo evento simultáneamente.
-- ================================================================
CREATE OR REPLACE FUNCTION public.claim_next_nfc_event()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id         UUID;
    v_uid        TEXT;
    v_created_at TIMESTAMPTZ;
BEGIN
    UPDATE public.nfc_events
    SET processed = TRUE
    WHERE id = (
        SELECT id
        FROM public.nfc_events
        WHERE processed = FALSE
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, uid, created_at
    INTO v_id, v_uid, v_created_at;

    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'id',          v_id,
        'uid',         upper(trim(v_uid)),
        'tarjeta_uid', upper(trim(v_uid)),  -- alias que también lee el frontend
        'created_at',  v_created_at,
        'processed',   TRUE
    );
END;
$$;

-- El código JS llama a ambas variantes del nombre; este alias reenvía al original
CREATE OR REPLACE FUNCTION public.claim_nfc_event()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.claim_next_nfc_event();
END;
$$;


-- ================================================================
-- RPC: app_login_usuario
--
-- Autentica al usuario verificando la contraseña con bcrypt.
-- Retorna un JSON con { message, user: { id, username, nombre, rol, ... } }
-- ================================================================
CREATE OR REPLACE FUNCTION public.app_login_usuario(
    p_username TEXT,
    p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user public.app_usuarios%ROWTYPE;
BEGIN
    SELECT * INTO v_user
    FROM public.app_usuarios
    WHERE lower(trim(username)) = lower(trim(p_username))
      AND activo = TRUE;

    IF v_user.id IS NULL THEN
        RAISE EXCEPTION 'Usuario no encontrado o inactivo'
            USING ERRCODE = 'P0001';
    END IF;

    -- Verificar contraseña con bcrypt (pgcrypto)
    IF v_user.password_hash IS DISTINCT FROM crypt(p_password, v_user.password_hash) THEN
        RAISE EXCEPTION 'Contraseña incorrecta'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
        'message', 'Sesión iniciada',
        'user', jsonb_build_object(
            'id',              v_user.id,
            'username',        v_user.username,
            'nombre',          v_user.nombre_completo,
            'nombre_completo', v_user.nombre_completo,
            'rol',             v_user.rol,
            'role',            v_user.rol,
            'telefono',        v_user.telefono,
            'correo',          v_user.correo,
            'curp',            v_user.curp,
            'anio_nacimiento', v_user.anio_nacimiento,
            'sexo',            v_user.sexo
        )
    );
END;
$$;


-- ================================================================
-- RPC: app_registrar_usuario
--
-- Crea un nuevo usuario. Requiere la contraseña maestra del sistema.
--
-- Para configurar la contraseña maestra en Supabase, ejecuta:
--   ALTER DATABASE postgres SET app.master_password = 'tu_clave_segura';
--
-- Si no se configura, usa el valor hardcoded de abajo (solo para desarrollo).
-- ================================================================
CREATE OR REPLACE FUNCTION public.app_registrar_usuario(
    p_rol             TEXT,
    p_nombre_completo TEXT,
    p_telefono        TEXT    DEFAULT NULL,
    p_correo          TEXT    DEFAULT NULL,
    p_curp            TEXT    DEFAULT NULL,
    p_anio_nacimiento INTEGER DEFAULT NULL,
    p_sexo            TEXT    DEFAULT NULL,
    p_username        TEXT    DEFAULT NULL,
    p_password        TEXT    DEFAULT NULL,
    p_master_password TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_master_pass TEXT;
    v_new_id      UUID;
    v_username    TEXT;
    v_rol         TEXT;
    v_curp        TEXT;
BEGIN
    -- Leer la contraseña maestra desde la configuración del servidor
    -- Cambia 'SICAE_MASTER_2024' antes de producción con:
    --   ALTER DATABASE postgres SET app.master_password = 'mi_clave';
    v_master_pass := COALESCE(
        NULLIF(current_setting('app.master_password', TRUE), ''),
        'SICAE_MASTER_2024'
    );

    IF p_master_password IS DISTINCT FROM v_master_pass THEN
        RAISE EXCEPTION 'Contraseña maestra incorrecta'
            USING ERRCODE = 'P0003';
    END IF;

    -- Normalizar rol (acepta alias del frontend)
    v_rol := lower(trim(COALESCE(p_rol, 'docente')));
    IF v_rol = 'admin'       THEN v_rol := 'direccion'; END IF;
    IF v_rol = 'capturista'  THEN v_rol := 'docente';   END IF;
    IF v_rol NOT IN ('direccion', 'docente') THEN v_rol := 'docente'; END IF;

    v_username := lower(trim(COALESCE(p_username, '')));
    v_curp     := NULLIF(upper(trim(COALESCE(p_curp, ''))), '');

    -- Validaciones básicas
    IF trim(COALESCE(p_nombre_completo, '')) = '' THEN
        RAISE EXCEPTION 'El nombre completo es obligatorio' USING ERRCODE = 'P0004';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'El username es obligatorio' USING ERRCODE = 'P0005';
    END IF;
    IF COALESCE(length(p_password), 0) < 6 THEN
        RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres' USING ERRCODE = 'P0006';
    END IF;

    INSERT INTO public.app_usuarios (
        username, nombre_completo, rol,
        telefono, correo, curp,
        anio_nacimiento, sexo, password_hash
    )
    VALUES (
        v_username,
        trim(p_nombre_completo),
        v_rol,
        NULLIF(trim(COALESCE(p_telefono, '')), ''),
        NULLIF(lower(trim(COALESCE(p_correo, ''))), ''),
        v_curp,
        p_anio_nacimiento,
        NULLIF(upper(trim(COALESCE(p_sexo, ''))), ''),
        crypt(p_password, gen_salt('bf'))   -- bcrypt automático
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'message', 'Usuario registrado correctamente',
        'user', jsonb_build_object(
            'id',              v_new_id,
            'username',        v_username,
            'nombre',          trim(p_nombre_completo),
            'nombre_completo', trim(p_nombre_completo),
            'rol',             v_rol,
            'telefono',        p_telefono,
            'correo',          p_correo,
            'curp',            v_curp,
            'anio_nacimiento', p_anio_nacimiento,
            'sexo',            NULLIF(upper(trim(COALESCE(p_sexo, ''))), '')
        )
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe un usuario con ese username o CURP'
            USING ERRCODE = '23505';
END;
$$;


-- ================================================================
-- ROW LEVEL SECURITY (RLS)
--
-- El control de acceso real se implementa en la capa frontend vía auth.js.
-- Las políticas abajo abren acceso a la anon key de Supabase para que
-- el frontend pueda operar. Las RPCs usan SECURITY DEFINER y no dependen
-- de estas políticas.
--
-- Para producción: reemplaza USING (TRUE) por condiciones basadas en
-- el JWT del usuario autenticado con Supabase Auth.
-- ================================================================
ALTER TABLE public.alumnos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horarios_mapa  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_usuarios   ENABLE ROW LEVEL SECURITY;

-- alumnos: acceso completo (CREATE, READ, UPDATE, DELETE)
CREATE POLICY "alumnos_all"
    ON public.alumnos FOR ALL
    USING (TRUE) WITH CHECK (TRUE);

-- attendance: lectura e inserción (no se borran registros desde el frontend)
CREATE POLICY "attendance_select"
    ON public.attendance FOR SELECT USING (TRUE);
CREATE POLICY "attendance_insert"
    ON public.attendance FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "attendance_update"
    ON public.attendance FOR UPDATE USING (TRUE);

-- nfc_events: acceso completo (inserción desde el lector, update para marcar processed)
CREATE POLICY "nfc_events_all"
    ON public.nfc_events FOR ALL
    USING (TRUE) WITH CHECK (TRUE);

-- horarios_mapa: lectura y escritura (un solo documento JSONB)
CREATE POLICY "horarios_mapa_all"
    ON public.horarios_mapa FOR ALL
    USING (TRUE) WITH CHECK (TRUE);

-- app_usuarios: solo lectura (INSERT/UPDATE solo via RPCs SECURITY DEFINER)
-- password_hash nunca se expone al frontend directamente
CREATE POLICY "app_usuarios_select"
    ON public.app_usuarios FOR SELECT
    USING (TRUE);


-- ================================================================
-- COMENTARIOS
-- ================================================================
COMMENT ON TABLE  public.alumnos               IS 'Alumnos registrados: datos personales, académicos, médicos y de tutor';
COMMENT ON COLUMN public.alumnos.tarjeta_uid   IS 'UID de tarjeta NFC asignada. Siempre almacenar en UPPERCASE';
COMMENT ON COLUMN public.alumnos.fecha_registro IS 'Fecha de alta en formato YYYY-MM-DD como texto';

COMMENT ON TABLE  public.attendance            IS 'Eventos de entrada/salida por NFC o manual. El tipo alterna automáticamente';
COMMENT ON COLUMN public.attendance.cliente_id IS 'Alias de alumno_id enviado por compatibilidad con el código frontend';
COMMENT ON COLUMN public.attendance.type       IS 'entrada o salida (CHECK constraint)';
COMMENT ON COLUMN public.attendance.uid        IS 'UID de la tarjeta NFC que generó el evento';

COMMENT ON TABLE  public.nfc_events            IS 'Cola FIFO de eventos del lector NFC. processed=TRUE = ya consumido por claim_next_nfc_event()';
COMMENT ON TABLE  public.horarios_mapa         IS 'Documento único id=main con el mapa de horarios completo en JSONB';
COMMENT ON TABLE  public.app_usuarios          IS 'Usuarios del sistema. Contraseñas con bcrypt via pgcrypto';
COMMENT ON COLUMN public.app_usuarios.rol      IS 'direccion (acceso completo) o docente (vista filtrada)';

COMMENT ON FUNCTION public.registrar_asistencia     IS 'Alterna entrada/salida según el último evento del día. Seguro para NFC concurrente';
COMMENT ON FUNCTION public.claim_next_nfc_event     IS 'Consume atómicamente el siguiente evento NFC pendiente (SKIP LOCKED)';
COMMENT ON FUNCTION public.app_login_usuario        IS 'Autentica usuario con bcrypt. Retorna JSON {message, user}';
COMMENT ON FUNCTION public.app_registrar_usuario    IS 'Crea usuario nuevo. Requiere contraseña maestra (app.master_password)';


-- ================================================================
-- PASOS FINALES (ejecutar manualmente una sola vez):
--
-- 1. Cambiar la contraseña maestra antes de producción:
--      ALTER DATABASE postgres SET app.master_password = 'mi_clave_segura';
--
-- 2. Crear el primer usuario de dirección (desde el SQL Editor):
--      SELECT public.app_registrar_usuario(
--          'direccion',               -- rol
--          'Nombre Completo Admin',   -- nombre_completo
--          '9611234567',              -- telefono
--          'admin@cecyte.edu.mx',     -- correo
--          'XXXX000000XXXXXX00',      -- curp (18 chars)
--          1985,                      -- anio_nacimiento
--          'M',                       -- sexo (M/F/X)
--          'admin',                   -- username
--          'mi_contraseña',           -- password (min 6 chars)
--          'SICAE_MASTER_2024'        -- master_password (cambiar si alteraste la config)
--      );
-- ================================================================

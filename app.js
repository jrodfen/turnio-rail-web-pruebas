(function () {
  var status = document.getElementById('status');
  var loginShell = document.getElementById('login-shell');
  var loginForm = document.getElementById('login-form');
  var appShell = document.getElementById('app-shell');
  var nav = document.getElementById('bottom-nav');
  var list = document.getElementById('radar-list');
  var meta = document.getElementById('radar-meta');
  var api = String(window.TURNIO_EXTERNAL_API || '').replace(/\/$/, '');
  var FRONT_BUILD = String(window.TURNIO_FRONT_BUILD || 'enlaces17');
  var APP_VERSION = String(window.TURNIO_APP_VERSION || 'V.2');
  var supabaseCfg = window.TURNIO_SUPABASE || {};
  var supabase = window.supabase && window.supabase.createClient(
    supabaseCfg.url, supabaseCfg.publishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
  );
  var clientKey = 'turnio_external_client_id';
  var sessionKey = 'turnio_external_session_token';
  var mode = 'TODOS';
  var radar = [];
  var sessionEmail = '';
  // El Worker entrega este perfil tras validar Supabase. Nunca se toma el rol
  // de un dato que haya enviado el navegador por su cuenta.
  var sessionProfile = { role_code: 'LECTURA', can_write: false, is_admin: false, id: '' };
  var puedeEscribir = false;
  var cacheClavero = [];
  var cargandoClavero = false;
  var PREFIJO_AVISO_DEFAULT = 'CG SP Andalucía';
  var mapReady = false;
  var mapMarkers = [];
  var mapIndex = {};
  var flotaMapa = [];
  var flotaModo = 'TODOS';
  var flotaSoloDemora = false;
  var flotaTimer = null;
  var mapaFitHecho = false;
  var intervaloAutoRadar = null;
  var cacheAvisosRed = [];
  var cargandoAvisosRed = null;
  var flotaCargaPromise = null;
  var REGION_MAX = 3;
  var REGIONES_LS_KEY = 'turnio_radar_regiones';
  var regionesSeleccionadas = ['andalucia'];
  var regionesBorrador = ['andalucia'];
  var REGION_LABELS = {
    andalucia: 'Andalucía',
    madrid: 'Madrid',
    cataluna: 'Cataluña',
    levante: 'C. Valenciana',
    norte: 'Norte',
    espana: 'España'
  };
  // Extensión aproximada para el encuadre inicial del mapa. Solo se usa
  // cuando hay una región seleccionada; con varias se conserva el encuadre
  // automático de toda la flota.
  var REGION_MAP_BOUNDS = {
    andalucia: [[35.75, -7.65], [38.35, -1.90]],
    madrid: [[39.75, -4.95], [41.25, -2.45]],
    cataluna: [[40.45, 0.15], [42.95, 3.45]],
    levante: [[37.70, -1.55], [40.90, 0.75]],
    norte: [[41.90, -9.45], [44.10, -1.35]],
    cyl: [[40.00, -7.10], [43.10, -1.90]],
    aragon: [[39.80, -2.35], [42.90, 0.85]],
    extremadura: [[37.70, -7.80], [40.65, -4.75]]
  };

  function leerRegionesGuardadas_() {
    try {
      var raw = localStorage.getItem(REGIONES_LS_KEY);
      if (!raw) return ['andalucia'];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return ['andalucia'];
      return normalizarRegionesFront_(arr);
    } catch (e) {
      return ['andalucia'];
    }
  }
  function normalizarRegionesFront_(lista) {
    var valid = {
      andalucia: 1, madrid: 1, cataluna: 1, levante: 1, norte: 1, espana: 1
    };
    var out = [];
    var seen = {};
    (lista || []).forEach(function (r) {
      var k = String(r || '').toLowerCase().trim();
      if (!valid[k] || seen[k]) return;
      seen[k] = true;
      out.push(k);
    });
    if (!out.length) out = ['andalucia'];
    if (out.indexOf('espana') >= 0) return ['espana'];
    if (out.length > REGION_MAX) out = out.slice(0, REGION_MAX);
    return out;
  }
  function etiquetaRegiones_(lista) {
    return normalizarRegionesFront_(lista).map(function (r) {
      return REGION_LABELS[r] || r;
    }).join(' + ');
  }
  function etiquetaAmbitoRadarHome_() {
    var regs = obtenerRegionesRadar();
    if (regs.indexOf('espana') >= 0) return 'toda España';
    return etiquetaRegiones_(regs) || 'Andalucía';
  }
  function saludoBienvenida_(nombre) {
    var h = new Date().getHours();
    var saludo = h < 12 ? 'Buenos días' : (h < 20 ? 'Buenas tardes' : 'Buenas noches');
    return saludo + ', ' + (nombre || 'Usuario');
  }

  /** Misma fuente y ciudad que GAS producción (Sevilla / Open-Meteo). */
  var CLIMA_HOME_URL_ =
    'https://api.open-meteo.com/v1/forecast?latitude=37.3891&longitude=-5.9845' +
    '&current=temperature_2m,weather_code,relative_humidity_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&forecast_days=2&timezone=Europe%2FMadrid';
  var climaHomeCargando_ = false;
  var climaHomeCache_ = null;

  function descWeatherWmo_(code) {
    var c = Number(code);
    if (c === 0) return 'Despejado';
    if (c <= 3) return 'Poco nuboso';
    if (c <= 48) return 'Niebla o nubes';
    if (c <= 57) return 'Llovizna';
    if (c <= 67) return 'Lluvia';
    if (c <= 77) return 'Nieve o granizo';
    if (c <= 82) return 'Chubascos';
    if (c <= 86) return 'Nieve intensa';
    if (c <= 99) return 'Tormenta';
    return 'Variable';
  }

  function pintarClimaBienvenida_(data) {
    var elC = document.getElementById('welcome-body-clima-ahora');
    var elP = document.getElementById('welcome-body-clima-prev');
    if (!data) {
      if (elC) elC.textContent = 'Sin datos.';
      if (elP) elP.textContent = 'Sin datos.';
      return;
    }
    if (elC) {
      if (data.clima && data.clima.temp != null) {
        elC.innerHTML =
          '<div class="welcome-temp-now">' + Math.round(Number(data.clima.temp)) + '°C</div>' +
          '<div class="welcome-muted">' + esc(descWeatherWmo_(data.clima.code)) +
          (data.clima.humedad != null ? (' · Humedad ' + esc(String(data.clima.humedad)) + '%') : '') +
          '</div>';
      } else {
        elC.textContent = 'Tiempo no disponible.';
      }
    }
    if (elP) {
      if (data.climaPrevision && data.climaPrevision.hoy && data.climaPrevision.manana) {
        var h = data.climaPrevision.hoy;
        var m = data.climaPrevision.manana;
        elP.innerHTML =
          '<div class="welcome-prev-line">Hoy · máx ' + Math.round(Number(h.tmax)) + '° · mín ' +
          Math.round(Number(h.tmin)) + '°</div>' +
          '<div class="welcome-muted">' + esc(descWeatherWmo_(h.code)) + '</div>' +
          '<div class="welcome-prev-line" style="margin-top:10px;">Mañana · máx ' +
          Math.round(Number(m.tmax)) + '° · mín ' + Math.round(Number(m.tmin)) + '°</div>' +
          '<div class="welcome-muted">' + esc(descWeatherWmo_(m.code)) + '</div>';
      } else {
        elP.textContent = 'Previsión no disponible.';
      }
    }
  }

  async function cargarClimaBienvenida_(force) {
    var elC = document.getElementById('welcome-body-clima-ahora');
    var elP = document.getElementById('welcome-body-clima-prev');
    if (!elC && !elP) return;
    if (!force && climaHomeCache_) {
      pintarClimaBienvenida_(climaHomeCache_);
      return;
    }
    if (climaHomeCargando_) return;
    climaHomeCargando_ = true;
    if (elC) elC.textContent = 'Cargando…';
    if (elP) elP.textContent = 'Cargando…';
    try {
      var r = await fetch(CLIMA_HOME_URL_, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var wj = await r.json();
      var out = { clima: null, climaPrevision: null };
      if (wj && wj.current) {
        out.clima = {
          temp: wj.current.temperature_2m,
          code: wj.current.weather_code,
          humedad: wj.current.relative_humidity_2m
        };
      }
      if (wj && wj.daily && wj.daily.time && wj.daily.time.length >= 2) {
        out.climaPrevision = {
          hoy: {
            fecha: wj.daily.time[0],
            tmax: wj.daily.temperature_2m_max[0],
            tmin: wj.daily.temperature_2m_min[0],
            code: wj.daily.weather_code[0]
          },
          manana: {
            fecha: wj.daily.time[1],
            tmax: wj.daily.temperature_2m_max[1],
            tmin: wj.daily.temperature_2m_min[1],
            code: wj.daily.weather_code[1]
          }
        };
      }
      climaHomeCache_ = out;
      pintarClimaBienvenida_(out);
    } catch (e) {
      if (elC) elC.textContent = 'Tiempo no disponible.';
      if (elP) elP.textContent = 'Previsión no disponible.';
    } finally {
      climaHomeCargando_ = false;
    }
  }
  function sincronizarSelectRegionHidden_() {
    var sel = document.getElementById('region');
    if (!sel) return;
    var v = regionesSeleccionadas.length === 1
      ? regionesSeleccionadas[0]
      : regionesSeleccionadas.join('+');
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === v) { found = true; break; }
    }
    if (!found) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
  }
  function pintarResumenRegiones_() {
    var lab = document.getElementById('region-summary-label');
    if (lab) lab.textContent = etiquetaRegiones_(regionesSeleccionadas);
    sincronizarSelectRegionHidden_();
  }
  function obtenerRegionesRadar() {
    return regionesSeleccionadas.slice();
  }
  /** Región primaria para MARCHA_PARADAS (una hoja; multi-región → primera). */
  function regionMarchaActual_() {
    var r = regionesSeleccionadas && regionesSeleccionadas[0]
      ? String(regionesSeleccionadas[0]).toLowerCase()
      : 'andalucia';
    if (r === 'espana') return 'andalucia';
    return r || 'andalucia';
  }
  function setRegionesRadar(lista, opts) {
    opts = opts || {};
    var prev = regionesSeleccionadas.join('+');
    regionesSeleccionadas = normalizarRegionesFront_(lista);
    // El próximo acceso al mapa debe recalcular el encuadre de la selección.
    if (regionesSeleccionadas.join('+') !== prev) mapaFitHecho = false;
    try { localStorage.setItem(REGIONES_LS_KEY, JSON.stringify(regionesSeleccionadas)); } catch (e) {}
    pintarResumenRegiones_();
    if (opts.silent) return;
    if (regionesSeleccionadas.join('+') === prev) return;
    loadRadar({ force: true, keepOnBusy: true });
  }
  function leerChecksRegionesModal_() {
    var box = document.getElementById('region-modal-list');
    if (!box) return [];
    var out = [];
    box.querySelectorAll('input[type="checkbox"]').forEach(function (inp) {
      if (inp.checked) out.push(inp.value);
    });
    return out;
  }
  function pintarChecksRegionesModal_(lista) {
    var set = {};
    normalizarRegionesFront_(lista).forEach(function (r) { set[r] = true; });
    var box = document.getElementById('region-modal-list');
    if (!box) return;
    box.querySelectorAll('.region-check').forEach(function (lab) {
      var inp = lab.querySelector('input');
      if (!inp) return;
      var on = !!set[inp.value];
      inp.checked = on;
      lab.classList.toggle('is-on', on);
    });
    var hint = document.getElementById('region-modal-hint');
    var n = Object.keys(set).length;
    if (hint) {
      if (set.espana) hint.textContent = 'España (todas las regiones)';
      else hint.textContent = n + ' / ' + REGION_MAX + ' seleccionadas';
    }
  }
  function onToggleRegionModalCheck_(inp) {
    var val = String(inp.value || '');
    var checked = !!inp.checked;
    var cur = leerChecksRegionesModal_().filter(function (r) { return r !== val; });
    if (checked) {
      if (val === 'espana') {
        regionesBorrador = ['espana'];
      } else {
        cur = cur.filter(function (r) { return r !== 'espana'; });
        if (cur.length >= REGION_MAX) {
          inp.checked = false;
          toast('Máximo ' + REGION_MAX + ' regiones');
          pintarChecksRegionesModal_(regionesBorrador);
          return;
        }
        cur.push(val);
        regionesBorrador = cur.length ? cur : ['andalucia'];
      }
    } else {
      if (!cur.length) {
        inp.checked = true;
        toast('Deja al menos una región');
        return;
      }
      regionesBorrador = cur;
    }
    regionesBorrador = normalizarRegionesFront_(regionesBorrador);
    pintarChecksRegionesModal_(regionesBorrador);
  }
  function abrirModalRegiones() {
    var modal = document.getElementById('modal-regiones');
    if (!modal) return;
    regionesBorrador = regionesSeleccionadas.slice();
    pintarChecksRegionesModal_(regionesBorrador);
    modal.hidden = false;
  }
  function cerrarModalRegiones() {
    var modal = document.getElementById('modal-regiones');
    if (modal) modal.hidden = true;
  }
  function aplicarModalRegiones() {
    var lista = normalizarRegionesFront_(leerChecksRegionesModal_());
    cerrarModalRegiones();
    setRegionesRadar(lista);
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
    });
  };
  function plainText(s) {
    var text = String(s == null ? '' : s), el = document.createElement('div');
    for (var i = 0; i < 3 && /[<&]/.test(text); i++) {
      el.innerHTML = text;
      text = el.textContent || el.innerText || '';
    }
    return text.replace(/\s+/g, ' ').trim();
  }
  function perfilSesion_(persona) {
    var p = persona || {};
    var role = String(p.role_code || p.roleCode || p.rol || 'LECTURA').toUpperCase();
    if (['ADMIN', 'CGO', 'LECTURA', 'INVITADO', 'COMERCIAL'].indexOf(role) < 0) role = 'LECTURA';
    var isAdmin = p.is_admin === true || p.isAdmin === true || role === 'ADMIN';
    return {
      id: p.id || '',
      role_code: role,
      can_write: p.can_write === true || p.canWrite === true || role === 'ADMIN' || role === 'CGO',
      is_admin: isAdmin,
      active: p.active !== false,
      expires_at: p.expires_at || p.expiresAt || '',
      display_name: p.display_name || p.displayName || p.nombre || '',
      estaciones_preferidas: Array.isArray(p.estaciones_preferidas) ? p.estaciones_preferidas : null
    };
  }
  function esComercial_() {
    return sessionProfile.role_code === 'COMERCIAL';
  }
  function pantallaPermitidaComercial_(screen) {
    return ({
      home: 1, mapa: 1, conexiones: 1, perfil: 1, ajustes: 1
    })[screen] === 1;
  }
  function textoPermisoPerfil_(perfil) {
    if (perfil.role_code === 'ADMIN') return 'Administración: puedes gestionar usuarios y usar todas las funciones operativas.';
    if (perfil.role_code === 'COMERCIAL') return 'Perfil comercial: acceso a Mapa en vivo y Servicios enlazados.';
    if (perfil.can_write) return 'Permiso operativo: puedes generar avisos y usar el Vigilante.';
    if (perfil.role_code === 'INVITADO') return 'Modo invitado: consulta de datos. No puedes generar avisos ni usar el Vigilante.';
    return 'Modo lectura: puedes consultar datos, sin generar avisos ni usar el Vigilante.';
  }
  function aplicarPermisosPerfil_(persona) {
    sessionProfile = perfilSesion_(persona);
    puedeEscribir = !!sessionProfile.can_write;
    document.documentElement.classList.toggle('turnio-solo-lectura', !puedeEscribir);
    document.documentElement.classList.toggle('turnio-es-admin', !!sessionProfile.is_admin);
    document.documentElement.classList.toggle('turnio-es-invitado', sessionProfile.role_code === 'INVITADO');
    aplicarPreferenciasEstaciones_(persona && persona.estaciones_preferidas);
    document.documentElement.classList.toggle('turnio-es-comercial', esComercial_());
    document.querySelectorAll('[data-requiere-escritura]').forEach(function (el) {
      el.hidden = !puedeEscribir;
      el.disabled = !puedeEscribir;
    });
    document.querySelectorAll('[data-requiere-admin]').forEach(function (el) {
      el.hidden = !sessionProfile.is_admin;
      if ('disabled' in el) el.disabled = !sessionProfile.is_admin;
    });
    document.querySelectorAll('[data-ocultar-invitado]').forEach(function (el) {
      el.hidden = sessionProfile.role_code === 'INVITADO' || esComercial_();
    });
    document.querySelectorAll('[data-ocultar-comercial]').forEach(function (el) {
      el.hidden = esComercial_();
    });
    document.querySelectorAll('[data-solo-comercial]').forEach(function (el) {
      el.hidden = !esComercial_();
    });
    var roleText = 'Rol: ' + sessionProfile.role_code;
    var badge = document.getElementById('user-role');
    if (badge) { badge.textContent = roleText; badge.hidden = false; }
    var profileRole = document.getElementById('profile-role');
    if (profileRole) profileRole.textContent = roleText;
    var profilePermissions = document.getElementById('profile-permissions');
    if (profilePermissions) profilePermissions.textContent = textoPermisoPerfil_(sessionProfile);
  }
  function exigirEscritura_(accion) {
    if (puedeEscribir) return true;
    toast((accion || 'Esta acción') + ' no está disponible con tu rol de ' + sessionProfile.role_code + '.', 'error');
    return false;
  }

  var adminCargando_ = false;
  var adminPerfilesCache_ = [];
  var adminExpandidoId_ = '';
  function fmtFechaCorta_(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }
  function isoAFechaInput_(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fechaInputAIso_(val) {
    var s = String(val || '').trim();
    if (!s) return '';
    var d = new Date(s + 'T23:59:59');
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  }
  function adminFiltroTexto_() {
    var el = document.getElementById('admin-buscar');
    return String(el && el.value || '').trim().toLowerCase();
  }
  function pintarAdminLista_() {
    var lista = document.getElementById('admin-lista');
    var meta = document.getElementById('admin-meta');
    if (!lista) return;
    var q = adminFiltroTexto_();
    var filas = adminPerfilesCache_.filter(function (p) {
      if (!q) return true;
      var hay = [p.email, p.display_name, p.role_code].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (meta) {
      meta.textContent = filas.length + (q ? ' / ' + adminPerfilesCache_.length : '') +
        ' perfil' + (adminPerfilesCache_.length === 1 ? '' : 'es');
    }
    if (!adminPerfilesCache_.length) {
      lista.innerHTML = '<p class="empty">No hay perfiles en Supabase.</p>';
      return;
    }
    if (!filas.length) {
      lista.innerHTML = '<p class="empty">Ningún perfil coincide con la búsqueda.</p>';
      return;
    }
    lista.innerHTML = filas.map(function (p) {
      var id = esc(p.id);
      var role = String(p.role_code || 'LECTURA').toUpperCase();
      var esYo = sessionProfile.id && String(sessionProfile.id) === String(p.id);
      var abierto = adminExpandidoId_ && String(adminExpandidoId_) === String(p.id);
      var opts = ['ADMIN', 'CGO', 'LECTURA', 'COMERCIAL', 'INVITADO'].map(function (r) {
        return '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + r + '</option>';
      }).join('');
      return (
        '<article class="admin-row' + (p.active ? '' : ' admin-row--off') + (abierto ? ' open' : '') +
          '" data-admin-id="' + id + '">' +
          '<button type="button" class="admin-row-main" data-admin-toggle="' + id + '" aria-expanded="' + (abierto ? 'true' : 'false') + '">' +
            '<span class="admin-row-who">' +
              '<b>' + esc(p.display_name || p.email || 'Sin nombre') + (esYo ? ' · tú' : '') + '</b>' +
              '<span>' + esc(p.email || '') + '</span>' +
            '</span>' +
            '<span class="admin-row-tags">' +
              '<span class="admin-pill admin-pill--role">' + esc(role) + '</span>' +
              (p.active ? '' : '<span class="admin-pill">Off</span>') +
              (p.linked ? '' : '<span class="admin-pill">Sin Auth</span>') +
            '</span>' +
            '<span class="admin-row-chev" aria-hidden="true">' + (abierto ? '▾' : '▸') + '</span>' +
          '</button>' +
          '<div class="admin-row-edit"' + (abierto ? '' : ' hidden') + '>' +
            '<div class="admin-card-grid">' +
              '<label>Rol<select class="admin-role">' + opts + '</select></label>' +
              '<label class="admin-active-lab"><input type="checkbox" class="admin-active"' +
                (p.active ? ' checked' : '') + (esYo ? ' disabled' : '') + '> Activo</label>' +
              '<label class="admin-exp-lab">Caduca (INVITADO)<input type="date" class="admin-expires" value="' +
                esc(isoAFechaInput_(p.expires_at)) + '"' + (role === 'INVITADO' ? '' : ' disabled') + '></label>' +
            '</div>' +
            '<div class="admin-card-foot">' +
              '<span class="admin-card-meta">Actualizado: ' + esc(fmtFechaCorta_(p.updated_at)) +
                (p.expires_at && role === 'INVITADO' ? ' · Fin: ' + esc(fmtFechaCorta_(p.expires_at)) : '') +
              '</span>' +
              '<button type="button" class="action-btn admin-save" data-admin-save="' + id + '">Guardar</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }
  async function cargarAdminPerfiles_() {
    var lista = document.getElementById('admin-lista');
    var meta = document.getElementById('admin-meta');
    if (!lista) return;
    if (!sessionProfile.is_admin) {
      lista.innerHTML = '<p class="empty">Solo ADMIN.</p>';
      return;
    }
    if (adminCargando_) return;
    adminCargando_ = true;
    lista.innerHTML = '<p class="empty">Cargando perfiles…</p>';
    if (meta) meta.textContent = '…';
    try {
      var d = await call('admin_listar_perfiles');
      adminPerfilesCache_ = Array.isArray(d.perfiles) ? d.perfiles : [];
      pintarAdminLista_();
    } catch (err) {
      adminPerfilesCache_ = [];
      lista.innerHTML = '<p class="empty error-text">' + esc(err.message || err) + '</p>';
      if (meta) meta.textContent = 'error';
    } finally {
      adminCargando_ = false;
    }
  }
  async function guardarAdminPerfil_(card) {
    if (!card || !sessionProfile.is_admin) return;
    var id = card.getAttribute('data-admin-id');
    var roleSel = card.querySelector('.admin-role');
    var activeEl = card.querySelector('.admin-active');
    var expEl = card.querySelector('.admin-expires');
    var btn = card.querySelector('.admin-save');
    if (!id || !roleSel) return;
    var role = String(roleSel.value || '').toUpperCase();
    var active = !!(activeEl && activeEl.checked);
    var expiresAt = role === 'INVITADO' ? fechaInputAIso_(expEl && expEl.value) : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      await call('admin_actualizar_perfil', {
        profile_id: id,
        role_code: role,
        active: active,
        expires_at: expiresAt || null
      });
      toast('Perfil actualizado.', 'success');
      await cargarAdminPerfiles_();
    } catch (err) {
      toast(String(err.message || err), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
  }
  function syncAdminNuevoCaduca_() {
    var rol = document.getElementById('admin-nuevo-rol');
    var wrap = document.getElementById('admin-nuevo-exp-wrap');
    var claveWrap = document.getElementById('admin-nuevo-clave-wrap');
    if (!rol) return;
    var role = String(rol.value || '').toUpperCase();
    if (wrap) wrap.hidden = role !== 'INVITADO';
    if (claveWrap) {
      claveWrap.hidden = role !== 'ADMIN';
      if (role !== 'ADMIN') {
        var c = document.getElementById('admin-nuevo-clave');
        if (c) c.value = '';
      }
    }
  }
  var avisoAppPendienteId_ = '';
  var avisoAppCache_ = [];

  function fmtAvisoFecha_(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('es-ES', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return String(iso);
    }
  }

  function htmlAvisoItem_(aviso, conBorrar) {
    if (!aviso || !aviso.id) return '';
    var meta = [];
    var f = fmtAvisoFecha_(aviso.created_at);
    if (f) meta.push(f);
    if (aviso.created_by) meta.push(aviso.created_by);
    if (aviso.active) meta.push('al entrar');
    var cls = conBorrar ? 'admin-aviso-item' : 'avisos-app-item';
    return '<article class="' + cls + (aviso.active ? ' is-active' : '') +
      '" data-aviso-id="' + esc(aviso.id) + '">' +
      '<button type="button" class="aviso-item-toggle" data-aviso-toggle aria-expanded="false">' +
        '<span class="aviso-item-toggle-main">' +
          '<b>' + esc(aviso.titulo || 'Aviso') + '</b>' +
          (aviso.active ? '<span class="admin-pill admin-pill--role">Al entrar</span>' : '') +
        '</span>' +
        '<span class="aviso-item-chev" aria-hidden="true">▸</span>' +
      '</button>' +
      '<div class="aviso-item-panel" hidden>' +
        (meta.length ? '<p class="' + cls + '-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '<p class="' + cls + '-body">' + esc(aviso.cuerpo || '') + '</p>' +
        (conBorrar
          ? '<button type="button" class="btn secondary" data-aviso-borrar="' + esc(aviso.id) + '">Borrar</button>'
          : '') +
      '</div>' +
      '</article>';
  }

  function toggleAvisoItem_(btn) {
    if (!btn) return;
    var item = btn.closest('.admin-aviso-item, .avisos-app-item');
    if (!item) return;
    var panel = item.querySelector('.aviso-item-panel');
    var chev = btn.querySelector('.aviso-item-chev');
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (panel) panel.hidden = open;
    if (chev) chev.textContent = open ? '▸' : '▾';
    item.classList.toggle('is-open', !open);
  }

  function setAdminAvisoFormVisible_(visible) {
    var form = document.getElementById('admin-aviso-form');
    var btnOpen = document.getElementById('btn-admin-aviso-abrir-form');
    if (form) form.hidden = !visible;
    if (btnOpen) btnOpen.hidden = !!visible;
    if (!visible) {
      var tit = document.getElementById('admin-aviso-titulo');
      var cue = document.getElementById('admin-aviso-cuerpo');
      if (tit) tit.value = '';
      if (cue) cue.value = '';
    }
  }

  function pintarAdminAvisoLista_(avisos) {
    var box = document.getElementById('admin-aviso-lista');
    if (!box) return;
    var list = Array.isArray(avisos) ? avisos : [];
    if (!list.length) {
      box.innerHTML = '<div class="empty">Aún no hay avisos publicados.</div>';
      return;
    }
    box.innerHTML = list.map(function (a) { return htmlAvisoItem_(a, true); }).join('');
  }

  function pintarAdminAvisoEstado_(aviso, avisos) {
    var el = document.getElementById('admin-aviso-estado');
    var btnOff = document.getElementById('btn-admin-aviso-desactivar');
    if (Array.isArray(avisos)) avisoAppCache_ = avisos;
    if (!el) return;
    if (aviso && aviso.id) {
      el.textContent = 'Modal activo · ' + (aviso.titulo || 'Aviso') +
        (aviso.created_at ? ' · ' + fmtAvisoFecha_(aviso.created_at) : '');
      if (btnOff) btnOff.hidden = false;
    } else {
      el.textContent = 'No hay modal activo (el historial sigue visible).';
      if (btnOff) btnOff.hidden = true;
    }
    pintarAdminAvisoLista_(Array.isArray(avisos) ? avisos : avisoAppCache_);
  }

  var mantEstadoOn_ = false;
  var mantBloqueoEnCurso_ = false;

  function pintarLoginMantenimiento_(mant) {
    var box = document.getElementById('login-mantenimiento');
    var msg = document.getElementById('login-mantenimiento-msg');
    if (!box) return;
    var on = !!(mant && mant.on);
    box.hidden = !on;
    if (msg) {
      msg.textContent = on
        ? String(mant.mensaje || 'TURNIO está en mantenimiento. Solo ADMIN puede entrar.')
        : '';
    }
  }

  async function refrescarBannerMantenimientoLogin_() {
    try {
      var r = await fetch(api + '/api/health', { cache: 'no-store' });
      var d = await r.json();
      pintarLoginMantenimiento_(d && d.mantenimiento);
    } catch (_) {
      pintarLoginMantenimiento_({ on: false });
    }
  }

  function pintarAdminMantenimiento_(mant) {
    mantEstadoOn_ = !!(mant && mant.on);
    var btn = document.getElementById('btn-admin-mant-toggle');
    var label = document.getElementById('admin-mant-label');
    var meta = document.getElementById('admin-mant-meta');
    if (btn) {
      btn.classList.toggle('is-on', mantEstadoOn_);
      btn.setAttribute('aria-pressed', mantEstadoOn_ ? 'true' : 'false');
    }
    if (label) label.textContent = mantEstadoOn_ ? 'ON' : 'OFF';
    if (meta) {
      if (mantEstadoOn_) {
        meta.textContent = 'Activo' +
          (mant.by_email ? (' · por ' + mant.by_email) : '') +
          (mant.updated_at ? (' · ' + String(mant.updated_at).replace('T', ' ').slice(0, 19)) : '') +
          '. Solo ADMIN puede usar TURNIO.';
      } else {
        meta.textContent = 'Inactivo. Todos los roles autorizados pueden entrar.';
      }
    }
  }

  async function cargarAdminMantenimiento_() {
    if (!sessionProfile.is_admin) return;
    var meta = document.getElementById('admin-mant-meta');
    if (meta) meta.textContent = 'Comprobando estado…';
    try {
      var d = await call('mantenimiento_estado', {});
      pintarAdminMantenimiento_(d && d.mantenimiento);
    } catch (err) {
      if (meta) meta.textContent = 'Error: ' + String(err.message || err);
    }
  }

  async function toggleAdminMantenimiento_() {
    if (!sessionProfile.is_admin) return;
    var btn = document.getElementById('btn-admin-mant-toggle');
    if (btn) btn.disabled = true;
    try {
      var d;
      if (mantEstadoOn_) {
        if (!window.confirm('¿Desactivar el modo mantenimiento?\nTodos los usuarios autorizados podrán volver a entrar.')) return;
        d = await call('mantenimiento_desactivar', {});
        toast('Mantenimiento OFF', 'success');
      } else {
        if (!window.confirm('¿Activar modo mantenimiento?\nSolo ADMIN podrá entrar. El resto quedará bloqueado de inmediato.')) return;
        d = await call('mantenimiento_activar', {});
        toast('Mantenimiento ON · solo ADMIN', 'success');
      }
      pintarAdminMantenimiento_(d && d.mantenimiento);
    } catch (err) {
      toast(String(err.message || err), 'error');
      cargarAdminMantenimiento_();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  var adminAccesosTimer_ = null;

  function fmtAccesoHora_(iso) {
    var s = String(iso || '');
    if (!s) return '—';
    return s.replace('T', ' ').replace(/\.\d+Z?$/, '').slice(0, 19);
  }

  function etiquetaMotivoAcceso_(motivo) {
    var m = String(motivo || '');
    var mapa = {
      maintenance_mode: 'Mantenimiento',
      turnio_profile_inactive: 'Perfil inactivo',
      turnio_profile_expired: 'Acceso caducado',
      turnio_profile_unavailable: 'Sin perfil',
      supabase_auth_required: 'Sin sesión',
      supabase_session_invalid: 'Sesión inválida'
    };
    return mapa[m] || m || '—';
  }

  function lugarAccesoTxt_(a) {
    var parts = [];
    if (a.city) parts.push(a.city);
    if (a.region && a.region !== a.city) parts.push(a.region);
    if (a.country) parts.push(a.country);
    var lugar = parts.join(', ');
    if (lugar && a.ip) return lugar + ' · ' + a.ip;
    if (lugar) return lugar;
    return a.ip ? ('IP ' + a.ip) : 'Ubicación no disponible';
  }

  function leerFiltrosAccesos_() {
    return {
      periodo: String((document.getElementById('admin-accesos-periodo') || {}).value || '7d'),
      resultado: String((document.getElementById('admin-accesos-resultado') || {}).value || 'todos'),
      email: String((document.getElementById('admin-accesos-email') || {}).value || '').trim(),
      ciudad: String((document.getElementById('admin-accesos-ciudad') || {}).value || '').trim()
    };
  }

  function pintarResumenCiudadesAccesos_(resumen) {
    var box = document.getElementById('admin-accesos-resumen');
    if (!box) return;
    var rows = Array.isArray(resumen) ? resumen : [];
    if (!rows.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = rows.slice(0, 12).map(function (r) {
      var q = r.city || r.region || r.country || '';
      return '<button type="button" class="admin-acceso-chip" data-acceso-ciudad="' + esc(q) + '">' +
        '<span>' + esc(r.lugar || '—') + '</span><b>' + esc(String(r.n || 0)) + '</b></button>';
    }).join('');
  }

  function pintarAlertasCompartidas_(alertas) {
    var box = document.getElementById('admin-accesos-alertas');
    if (!box) return;
    var rows = Array.isArray(alertas) ? alertas : [];
    if (!rows.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = rows.map(function (a) {
      var ips = (a.ips || []).join(', ');
      var lugares = (a.lugares || []).join(' · ');
      return '<button type="button" class="admin-acceso-alerta" data-acceso-email="' + esc(a.email || '') + '">' +
        '<b>Posible cuenta compartida · ' + esc(a.email || '—') + '</b>' +
        '<span>' + esc(String(a.n_ips || 0)) + ' IPs en ' + esc(String(a.ventana_min || 120)) + ' min' +
        (a.role ? (' · ' + esc(a.role)) : '') +
        '<br>' + esc(ips) +
        (lugares ? ('<br>' + esc(lugares)) : '') +
        '<br>' + esc(fmtAccesoHora_(a.desde)) + ' → ' + esc(fmtAccesoHora_(a.hasta)) +
        '</span></button>';
    }).join('');
  }

  function pintarAdminAccesos_(lista, resumen, alertas) {
    var box = document.getElementById('admin-accesos-lista');
    var meta = document.getElementById('admin-accesos-meta');
    if (!box) return;
    var rows = Array.isArray(lista) ? lista : [];
    if (meta) {
      meta.textContent = rows.length
        ? (rows.length + ' registro' + (rows.length === 1 ? '' : 's'))
        : 'Sin accesos con estos filtros.';
    }
    pintarAlertasCompartidas_(alertas);
    pintarResumenCiudadesAccesos_(resumen);
    if (!rows.length) {
      box.innerHTML = '<div class="empty" style="padding:8px;">Sin datos.</div>';
      return;
    }
    box.innerHTML = rows.map(function (a) {
      var ok = !!a.ok;
      return '<article class="admin-acceso-item' + (ok ? '' : ' is-denied') + '">' +
        '<div class="admin-acceso-top">' +
          '<b>' + esc(a.email || '—') + '</b>' +
          '<span class="admin-acceso-badge ' + (ok ? 'ok' : 'no') + '">' + (ok ? 'OK' : 'DENEGADO') + '</span>' +
        '</div>' +
        '<p class="admin-acceso-meta">' +
          esc(fmtAccesoHora_(a.created_at)) +
          ' · ' + esc(a.role || '—') +
          ' · ' + esc(a.via || '—') +
          (ok ? '' : (' · ' + esc(etiquetaMotivoAcceso_(a.motivo)))) +
          '<br>📍 ' + esc(lugarAccesoTxt_(a)) +
        '</p></article>';
    }).join('');
  }

  async function cargarAdminAccesos_() {
    if (!sessionProfile.is_admin) return;
    var meta = document.getElementById('admin-accesos-meta');
    if (meta) meta.textContent = 'Cargando…';
    var f = leerFiltrosAccesos_();
    try {
      var d = await call('admin_listar_accesos', {
        limit: 100,
        periodo: f.periodo,
        resultado: f.resultado,
        email: f.email,
        ciudad: f.ciudad,
        solo_denegados: f.resultado === 'denegados'
      });
      pintarAdminAccesos_(d && d.accesos, d && d.resumen_ciudades, d && d.alertas_compartidas);
    } catch (err) {
      if (meta) meta.textContent = 'Error: ' + String(err.message || err);
    }
  }

  function programarCargaAdminAccesos_() {
    if (adminAccesosTimer_) clearTimeout(adminAccesosTimer_);
    adminAccesosTimer_ = setTimeout(function () {
      adminAccesosTimer_ = null;
      cargarAdminAccesos_();
    }, 280);
  }

  function manejarMantenimientoBloqueo_(d) {
    if (mantBloqueoEnCurso_) return;
    if (sessionProfile && sessionProfile.is_admin) return;
    mantBloqueoEnCurso_ = true;
    var msg = String((d && d.mensaje) || 'TURNIO está en mantenimiento. Solo ADMIN puede entrar.');
    try { pintarLoginMantenimiento_({ on: true, mensaje: msg }); } catch (_) {}
    try {
      setVigilanteState(false, true);
      if (intervaloAutoRadar) {
        clearInterval(intervaloAutoRadar);
        intervaloAutoRadar = null;
      }
      if (fabAbierto_) toggleFAB_(false);
      mostrarFab_(false);
      localStorage.removeItem(sessionKey);
      if (supabase) supabase.auth.signOut();
      appShell.hidden = true;
      nav.hidden = true;
      loginShell.hidden = false;
      loginForm.hidden = false;
    } catch (_) {}
    setStatus('error', msg);
    toast(msg, 'error');
    setTimeout(function () { mantBloqueoEnCurso_ = false; }, 1500);
  }

  async function cargarAdminAviso_() {
    if (!sessionProfile.is_admin) return;
    var el = document.getElementById('admin-aviso-estado');
    if (el) el.textContent = 'Comprobando aviso activo…';
    try {
      var d = await call('aviso_app_estado', {});
      pintarAdminAvisoEstado_(d && d.aviso, d && d.avisos);
    } catch (err) {
      if (el) el.textContent = 'Error: ' + String(err.message || err);
    }
  }

  async function publicarAdminAviso_() {
    if (!sessionProfile.is_admin) return;
    var tit = document.getElementById('admin-aviso-titulo');
    var cue = document.getElementById('admin-aviso-cuerpo');
    var btn = document.getElementById('btn-admin-aviso-publicar');
    var titulo = String(tit && tit.value || '').trim();
    var cuerpo = String(cue && cue.value || '').trim();
    if (!titulo || !cuerpo) {
      toast('Título y mensaje son obligatorios.', 'error');
      return;
    }
    if (!confirm('¿Publicar este aviso? Lo verán al entrar (modal) y quedará en el historial.')) return;
    if (btn) btn.disabled = true;
    try {
      var d = await call('aviso_app_publicar', { titulo: titulo, cuerpo: cuerpo });
      toast('Aviso publicado.', 'success');
      setAdminAvisoFormVisible_(false);
      pintarAdminAvisoEstado_(d && d.aviso, d && d.avisos);
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function desactivarAdminAviso_() {
    if (!sessionProfile.is_admin) return;
    if (!confirm('¿Quitar el modal al entrar? El aviso seguirá en el historial hasta que lo borres.')) return;
    try {
      var d = await call('aviso_app_desactivar', {});
      toast('Modal desactivado.', 'success');
      pintarAdminAvisoEstado_(null, d && d.avisos);
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  async function borrarAdminAviso_(id) {
    if (!sessionProfile.is_admin) return;
    var avisoId = String(id || '').trim();
    if (!avisoId) return;
    if (!confirm('¿Borrar este aviso del historial? Dejará de verse para todos.')) return;
    try {
      var d = await call('aviso_app_borrar', { id: avisoId });
      toast('Aviso borrado.', 'success');
      var activo = null;
      if (d && d.activo_id && Array.isArray(d.avisos)) {
        for (var i = 0; i < d.avisos.length; i++) {
          if (d.avisos[i] && d.avisos[i].id === d.activo_id) {
            activo = d.avisos[i];
            break;
          }
        }
      }
      pintarAdminAvisoEstado_(activo, d && d.avisos);
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  function pintarListaAvisosApp_(avisos) {
    var box = document.getElementById('avisos-app-lista');
    var home = document.getElementById('home-avisos-app');
    var list = Array.isArray(avisos) ? avisos : [];
    avisoAppCache_ = list;
    if (home) {
      home.textContent = list.length
        ? (list.length + ' aviso' + (list.length === 1 ? '' : 's') + ' publicado' + (list.length === 1 ? '' : 's'))
        : 'Sin avisos publicados.';
    }
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="empty">No hay avisos publicados.</div>';
      return;
    }
    box.innerHTML = list.map(function (a) { return htmlAvisoItem_(a, false); }).join('');
  }

  async function cargarAvisosApp_(force) {
    if (sessionProfile.role_code === 'INVITADO') {
      pintarListaAvisosApp_([]);
      return;
    }
    var box = document.getElementById('avisos-app-lista');
    if (box && (!avisoAppCache_.length || force)) {
      box.innerHTML = '<div class="empty">Cargando…</div>';
    }
    try {
      var d = await call('aviso_app_listar', {});
      pintarListaAvisosApp_(d && d.avisos);
    } catch (err) {
      if (box) box.innerHTML = '<div class="empty error-text">' + esc(String(err.message || err)) + '</div>';
      var home = document.getElementById('home-avisos-app');
      if (home) home.textContent = 'No se pudieron cargar los avisos.';
    }
  }

  function cerrarModalAvisoApp_(soloCerrar) {
    var modal = document.getElementById('modal-aviso-app');
    var estabaVisible = !!(modal && !modal.hidden);
    if (modal) modal.hidden = true;
    if (soloCerrar) avisoAppPendienteId_ = avisoAppPendienteId_ || '';
    if (estabaVisible) comprobarSugerenciaAlEntrar_();
  }

  function mostrarModalAvisoApp_(aviso) {
    if (!aviso || !aviso.id) return;
    avisoAppPendienteId_ = String(aviso.id);
    var modal = document.getElementById('modal-aviso-app');
    var tit = document.getElementById('titulo-aviso-app');
    var cue = document.getElementById('aviso-app-cuerpo');
    if (tit) tit.textContent = aviso.titulo || 'Aviso';
    if (cue) cue.textContent = aviso.cuerpo || '';
    if (modal) modal.hidden = false;
  }

  async function aceptarModalAvisoApp_() {
    var id = avisoAppPendienteId_;
    if (!id) {
      cerrarModalAvisoApp_(false);
      return;
    }
    var btn = document.getElementById('btn-aviso-app-aceptar');
    if (btn) btn.disabled = true;
    try {
      await call('aviso_app_aceptar', { id: id });
      avisoAppPendienteId_ = '';
      cerrarModalAvisoApp_(false);
      toast('Aviso aceptado.', 'success');
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function comprobarAvisoAppAlEntrar_() {
    try {
      var d = await call('aviso_app_pendiente', {});
      if (d && d.pendiente && d.aviso) {
        mostrarModalAvisoApp_(d.aviso);
        return;
      }
    } catch (_) { /* no bloquear entrada */ }
    comprobarSugerenciaAlEntrar_();
  }

  var sugerenciaPendienteId_ = '';
  var sugerenciaCache_ = [];

  function labelTipoSugerencia_(tipo) {
    return String(tipo || '').toLowerCase() === 'fallo' ? 'Fallo' : 'Sugerencia';
  }

  function htmlSugerenciaItem_(item) {
    if (!item || !item.id) return '';
    var tipo = String(item.tipo || 'sugerencia').toLowerCase();
    var meta = [];
    var f = fmtAvisoFecha_(item.created_at);
    if (f) meta.push(f);
    if (item.created_by) meta.push(item.created_by);
    var tipoCls = 'admin-sug-tipo' + (tipo === 'fallo' ? ' admin-sug-tipo--fallo' : '');
    return '<article class="admin-aviso-item admin-sug-item' + (tipo === 'fallo' ? ' is-fallo' : '') +
      '" data-sugerencia-id="' + esc(item.id) + '">' +
      '<button type="button" class="aviso-item-toggle" data-sugerencia-toggle aria-expanded="false">' +
        '<span class="aviso-item-toggle-main">' +
          '<span class="' + tipoCls + '">' + esc(labelTipoSugerencia_(tipo)) + '</span>' +
          '<b>' + esc(item.titulo || 'Sin título') + '</b>' +
        '</span>' +
        '<span class="aviso-item-chev" aria-hidden="true">▸</span>' +
      '</button>' +
      '<div class="aviso-item-panel" hidden>' +
        (meta.length ? '<p class="admin-aviso-item-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '<p class="admin-aviso-item-body">' + esc(item.cuerpo || '') + '</p>' +
        '<button type="button" class="btn secondary" data-sugerencia-borrar="' + esc(item.id) + '">Borrar</button>' +
      '</div>' +
      '</article>';
  }

  function pintarAdminSugerencias_(list) {
    var box = document.getElementById('admin-sugerencia-lista');
    var meta = document.getElementById('admin-sugerencia-meta');
    var arr = Array.isArray(list) ? list : [];
    sugerenciaCache_ = arr;
    if (meta) {
      meta.textContent = arr.length
        ? (arr.length + ' mensaje' + (arr.length === 1 ? '' : 's') + ' recibido' + (arr.length === 1 ? '' : 's'))
        : 'Aún no hay sugerencias ni fallos.';
    }
    if (!box) return;
    if (!arr.length) {
      box.innerHTML = '<div class="empty">Nadie ha enviado nada todavía.</div>';
      return;
    }
    box.innerHTML = arr.map(htmlSugerenciaItem_).join('');
  }

  async function cargarAdminSugerencias_() {
    if (!sessionProfile.is_admin) return;
    var meta = document.getElementById('admin-sugerencia-meta');
    if (meta) meta.textContent = 'Cargando…';
    try {
      var d = await call('sugerencia_listar', {});
      pintarAdminSugerencias_(d && d.sugerencias);
    } catch (err) {
      if (meta) meta.textContent = 'Error: ' + String(err.message || err);
    }
  }

  async function enviarSugerencia_(ev) {
    if (ev) ev.preventDefault();
    if (sessionProfile.role_code === 'INVITADO') {
      toast('Los invitados no pueden enviar sugerencias.', 'error');
      return;
    }
    var tipoEl = document.getElementById('sugerencia-tipo');
    var tit = document.getElementById('sugerencia-titulo');
    var cue = document.getElementById('sugerencia-cuerpo');
    var btn = document.getElementById('btn-enviar-sugerencia');
    var tipo = String(tipoEl && tipoEl.value || 'sugerencia').trim().toLowerCase();
    var titulo = String(tit && tit.value || '').trim();
    var cuerpo = String(cue && cue.value || '').trim();
    if (!titulo || !cuerpo) {
      toast('Título y mensaje son obligatorios.', 'error');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      await call('sugerencia_enviar', { tipo: tipo, titulo: titulo, cuerpo: cuerpo });
      toast('Enviado. Administración lo recibirá.', 'success');
      if (tit) tit.value = '';
      if (cue) cue.value = '';
      if (tipoEl) tipoEl.value = 'sugerencia';
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function borrarAdminSugerencia_(id) {
    if (!sessionProfile.is_admin) return;
    var sid = String(id || '').trim();
    if (!sid) return;
    if (!confirm('¿Borrar este mensaje del historial?')) return;
    try {
      var d = await call('sugerencia_borrar', { id: sid });
      toast('Borrado.', 'success');
      pintarAdminSugerencias_(d && d.sugerencias);
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  function cerrarModalSugerencia_(soloCerrar) {
    var modal = document.getElementById('modal-sugerencia');
    if (modal) modal.hidden = true;
    if (soloCerrar) sugerenciaPendienteId_ = sugerenciaPendienteId_ || '';
  }

  function mostrarModalSugerencia_(item) {
    if (!item || !item.id) return;
    sugerenciaPendienteId_ = String(item.id);
    var modal = document.getElementById('modal-sugerencia');
    var tit = document.getElementById('titulo-sugerencia');
    var meta = document.getElementById('sugerencia-meta');
    var cue = document.getElementById('sugerencia-cuerpo-modal');
    var tipoLabel = labelTipoSugerencia_(item.tipo);
    if (tit) tit.textContent = (tipoLabel + ': ' + (item.titulo || '')).trim();
    if (meta) {
      var bits = [];
      var f = fmtAvisoFecha_(item.created_at);
      if (f) bits.push(f);
      if (item.created_by) bits.push(item.created_by);
      meta.textContent = bits.join(' · ');
      meta.hidden = !bits.length;
    }
    if (cue) cue.textContent = item.cuerpo || '';
    if (modal) modal.hidden = false;
  }

  async function aceptarModalSugerencia_() {
    var id = sugerenciaPendienteId_;
    if (!id) {
      cerrarModalSugerencia_(false);
      return;
    }
    var btn = document.getElementById('btn-sugerencia-aceptar');
    if (btn) btn.disabled = true;
    try {
      await call('sugerencia_aceptar', { id: id });
      sugerenciaPendienteId_ = '';
      cerrarModalSugerencia_(false);
      toast('Mensaje aceptado.', 'success');
      comprobarSugerenciaAlEntrar_();
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function comprobarSugerenciaAlEntrar_() {
    if (!sessionProfile.is_admin) return;
    var avisoModal = document.getElementById('modal-aviso-app');
    if (avisoModal && !avisoModal.hidden) return;
    try {
      var d = await call('sugerencia_pendiente', {});
      if (d && d.pendiente && d.sugerencia) {
        mostrarModalSugerencia_(d.sugerencia);
        return;
      }
    } catch (_) { /* no bloquear entrada */ }
    comprobarSolicitudAccesoAlEntrar_();
  }

  var solicitudCache_ = [];

  function mostrarModalSolicitudAcceso_(item, total) {
    var modal = document.getElementById('modal-solicitud-acceso');
    var meta = document.getElementById('solicitud-modal-meta');
    var cuerpo = document.getElementById('solicitud-modal-cuerpo');
    if (!modal || !item) return;
    var n = Number(total || 1);
    if (meta) {
      meta.textContent = (n > 1 ? (n + ' solicitudes pendientes · ') : '') +
        String(item.email || '') +
        (item.centro ? (' · ' + item.centro) : '');
    }
    if (cuerpo) {
      cuerpo.textContent = (item.nombre || 'Sin nombre') + '\n\n' + String(item.motivo || '');
    }
    modal.hidden = false;
  }

  function cerrarModalSolicitudAcceso_() {
    var modal = document.getElementById('modal-solicitud-acceso');
    if (modal) modal.hidden = true;
  }

  async function comprobarSolicitudAccesoAlEntrar_() {
    if (!sessionProfile.is_admin) return;
    var sugModal = document.getElementById('modal-sugerencia');
    if (sugModal && !sugModal.hidden) return;
    try {
      var d = await call('solicitud_acceso_pendiente', {});
      if (d && d.pendiente && d.solicitud) {
        mostrarModalSolicitudAcceso_(d.solicitud, d.total);
      }
    } catch (_) { /* no bloquear */ }
  }

  function htmlSolicitudItem_(item) {
    if (!item || !item.id) return '';
    var estado = String(item.estado || 'pendiente');
    var meta = [];
    var f = fmtAvisoFecha_(item.created_at);
    if (f) meta.push(f);
    if (item.centro) meta.push(item.centro);
    if (estado !== 'pendiente') meta.push(estado + (item.role_code ? (' · ' + item.role_code) : ''));
    var actions = '';
    if (estado === 'pendiente') {
      actions =
        '<div class="admin-solicitud-actions">' +
          '<label class="admin-solicitud-rol">Rol' +
            '<select data-solicitud-rol="' + esc(item.id) + '">' +
              '<option value="CGO" selected>CGO</option>' +
              '<option value="LECTURA">LECTURA</option>' +
              '<option value="COMERCIAL">COMERCIAL</option>' +
              '<option value="INVITADO">INVITADO</option>' +
            '</select>' +
          '</label>' +
          '<button type="button" class="btn primary" data-solicitud-aprobar="' + esc(item.id) + '">Aprobar</button>' +
          '<button type="button" class="btn secondary" data-solicitud-rechazar="' + esc(item.id) + '">Rechazar</button>' +
        '</div>';
    }
    return '<article class="admin-aviso-item admin-solicitud-item is-' + esc(estado) + '" data-solicitud-id="' + esc(item.id) + '">' +
      '<button type="button" class="aviso-item-toggle" data-solicitud-toggle aria-expanded="false">' +
        '<span class="aviso-item-toggle-main">' +
          '<span class="admin-sug-tipo">' + esc(estado) + '</span>' +
          '<b>' + esc(item.nombre || item.email || 'Solicitud') + '</b>' +
        '</span>' +
        '<span class="aviso-item-chev" aria-hidden="true">▸</span>' +
      '</button>' +
      '<div class="aviso-item-panel" hidden>' +
        (meta.length ? '<p class="admin-aviso-item-meta">' + esc(meta.join(' · ')) + '</p>' : '') +
        '<p class="admin-aviso-item-body"><b>' + esc(item.email || '') + '</b>\n' + esc(item.motivo || '') + '</p>' +
        actions +
      '</div>' +
      '</article>';
  }

  function pintarAdminSolicitudes_(list) {
    var box = document.getElementById('admin-solicitud-lista');
    var meta = document.getElementById('admin-solicitud-meta');
    var arr = Array.isArray(list) ? list : [];
    solicitudCache_ = arr;
    var pend = arr.filter(function (x) { return x && x.estado === 'pendiente'; }).length;
    if (meta) {
      meta.textContent = arr.length
        ? (arr.length + ' solicitud' + (arr.length === 1 ? '' : 'es') +
          (pend ? (' · ' + pend + ' pendiente' + (pend === 1 ? '' : 's')) : ''))
        : 'No hay solicitudes todavía.';
    }
    if (!box) return;
    if (!arr.length) {
      box.innerHTML = '<div class="empty">Nadie ha solicitado acceso todavía.</div>';
      return;
    }
    box.innerHTML = arr.map(htmlSolicitudItem_).join('');
  }

  async function cargarAdminSolicitudes_() {
    if (!sessionProfile.is_admin) return;
    var meta = document.getElementById('admin-solicitud-meta');
    if (meta) meta.textContent = 'Cargando…';
    try {
      var d = await call('solicitud_acceso_listar', {});
      pintarAdminSolicitudes_(d && d.solicitudes);
    } catch (err) {
      if (meta) meta.textContent = 'Error: ' + String(err.message || err);
    }
  }

  async function crearAdminPerfil_(ev) {
    if (ev) ev.preventDefault();
    if (!sessionProfile.is_admin) return;
    var emailEl = document.getElementById('admin-nuevo-email');
    var nombreEl = document.getElementById('admin-nuevo-nombre');
    var rolEl = document.getElementById('admin-nuevo-rol');
    var cadEl = document.getElementById('admin-nuevo-caduca');
    var claveEl = document.getElementById('admin-nuevo-clave');
    var btn = document.getElementById('btn-admin-crear');
    var email = String(emailEl && emailEl.value || '').trim().toLowerCase();
    var role = String(rolEl && rolEl.value || 'CGO').toUpperCase();
    var clave = String(claveEl && claveEl.value || '');
    if (!email) {
      toast('Indica un email.', 'error');
      return;
    }
    if (role === 'ADMIN' && clave && clave.length < 8) {
      toast('La clave ADMIN debe tener al menos 8 caracteres.', 'error');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }
    try {
      var payload = {
        email: email,
        display_name: String(nombreEl && nombreEl.value || '').trim(),
        role_code: role,
        active: true,
        expires_at: role === 'INVITADO' ? (fechaInputAIso_(cadEl && cadEl.value) || null) : null
      };
      if (role === 'ADMIN' && clave.length >= 8) payload.password = clave;
      await call('admin_crear_perfil', payload);
      toast(role === 'ADMIN' && clave.length >= 8
        ? 'ADMIN añadido con clave de acceso.'
        : 'Usuario añadido. Ya puede entrar con OTP.', 'success');
      if (emailEl) emailEl.value = '';
      if (nombreEl) nombreEl.value = '';
      if (cadEl) cadEl.value = '';
      if (claveEl) claveEl.value = '';
      if (rolEl) rolEl.value = 'CGO';
      syncAdminNuevoCaduca_();
      await cargarAdminPerfiles_();
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Añadir'; }
    }
  }

  async function definirAdminClave_(ev) {
    if (ev) ev.preventDefault();
    if (!sessionProfile.is_admin) return;
    var p1 = document.getElementById('admin-clave-pass');
    var p2 = document.getElementById('admin-clave-pass2');
    var btn = document.getElementById('btn-admin-clave');
    var a = String(p1 && p1.value || '');
    var b = String(p2 && p2.value || '');
    if (a.length < 8 || a.length > 72) {
      toast('La clave debe tener entre 8 y 72 caracteres.', 'error');
      return;
    }
    if (a !== b) {
      toast('Las claves no coinciden.', 'error');
      return;
    }
    if (!confirm('¿Guardar esta clave para tu cuenta ADMIN? Podrás entrar sin código por correo.')) return;
    if (btn) btn.disabled = true;
    try {
      await call('admin_definir_clave', { password: a });
      toast('Clave guardada. Ya puedes entrar con email + clave.', 'success');
      if (p1) p1.value = '';
      if (p2) p2.value = '';
    } catch (err) {
      toast(String(err.message || err), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function clientId() {
    var id = localStorage.getItem(clientKey) || '';
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(24)), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
      localStorage.setItem(clientKey, id);
    }
    return id;
  }
  async function call(accion, extra) {
    var authHeaders = { 'Content-Type': 'application/json' };
    if (!supabase) throw new Error('No se pudo cargar el acceso seguro.');
    var sesion = await supabase.auth.getSession();
    var accessToken = sesion && sesion.data && sesion.data.session && sesion.data.session.access_token;
    if (!accessToken) throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
    authHeaders.Authorization = 'Bearer ' + accessToken;
    var r = await fetch(api + '/api/turnio', {
      method: 'POST',
      headers: authHeaders,
      cache: 'no-store',
      body: JSON.stringify(Object.assign({
        accion: accion,
        clientId: clientId()
      }, extra || {}))
    });
    var d;
    try { d = await r.json(); } catch (_) { throw new Error('Respuesta no válida del servicio.'); }
    if (!r.ok || d.ok === false || d.exito === false) {
      if (String(d && d.error || '') === 'maintenance_mode') {
        manejarMantenimientoBloqueo_(d);
      }
      throw new Error(mensajeErrorApi_(d) || 'No se pudo completar la operación.');
    }
    return d;
  }
  function mensajeErrorApi_(d) {
    if (!d || typeof d !== 'object') return '';
    var code = String(d.error || '');
    var mapa = {
      maintenance_mode: String(d.mensaje || 'TURNIO está en mantenimiento. Solo ADMIN puede entrar.'),
      mantenimiento_kv_missing: 'No hay almacenamiento para el modo mantenimiento.',
      mantenimiento_write_failed: 'No se pudo cambiar el modo mantenimiento.',
      role_admin_required: 'Solo un ADMIN puede hacer esto.',
      role_read_only: 'Tu rol no permite esta acción.',
      admin_service_not_configured: 'Falta configurar el secreto de administración en el Worker.',
      admin_invalid_role: 'Rol no válido.',
      admin_invalid_profile_id: 'Perfil no válido.',
      admin_invalid_expires_at: 'Fecha de caducidad no válida.',
      admin_cannot_deactivate_self: 'No puedes desactivar tu propia cuenta.',
      admin_cannot_demote_self: 'No puedes quitarte el rol ADMIN a ti mismo.',
      admin_last_admin_protected: 'Debe quedar al menos un ADMIN activo.',
      admin_profile_not_found: 'Perfil no encontrado.',
      admin_unavailable: 'Administración no disponible ahora.',
      admin_invalid_email: 'Email no válido.',
      admin_email_exists: 'Ya existe un perfil con ese email.',
      admin_auth_user_failed: 'No se pudo crear el acceso Auth del usuario.',
      admin_auth_unavailable: 'Auth de Supabase no disponible.',
      admin_create_failed: 'No se pudo crear el perfil.',
      admin_clave_invalida: 'La clave debe tener entre 8 y 72 caracteres.',
      admin_clave_solo_admin: 'Solo se puede definir clave en perfiles ADMIN.',
      admin_clave_failed: 'No se pudo guardar la clave de acceso.',
      solicitud_email_invalido: 'Correo no válido.',
      solicitud_nombre_requerido: 'Indica un nombre para el perfil.',
      solicitud_centro_requerido: 'Indica tu centro o unidad.',
      solicitud_motivo_corto: 'El motivo debe tener al menos 20 caracteres.',
      solicitud_ya_pendiente: 'Ya tienes una solicitud pendiente con ese correo.',
      solicitud_ya_tiene_perfil: 'Ese correo ya tiene perfil en TURNIO.',
      solicitud_rate_limit: 'Demasiadas solicitudes. Prueba más tarde.',
      solicitud_kv_missing: 'No hay almacenamiento para solicitudes.',
      solicitud_no_encontrada: 'Solicitud no encontrada.',
      solicitud_ya_resuelta: 'Esa solicitud ya está resuelta.',
      solicitud_rol_admin_prohibido: 'No se puede aprobar como ADMIN desde aquí. Usa Añadir usuario.',
      solicitud_unavailable: 'No se pudo enviar la solicitud.',
      role_write_required: 'Solo CGO o ADMIN pueden publicar combinados.',
      combinados_sin_filas: 'No hay filas para publicar.',
      combinados_demasiado_grande: 'El fichero es demasiado grande.',
      combinados_publish_failed: 'No se pudo guardar el snapshot compartido.',
      combinados_delete_failed: 'No se pudo borrar la publicación compartida.',
      combinados_unavailable: 'Servicio de combinados no disponible.',
      aviso_titulo_requerido: 'Indica un título para el aviso.',
      aviso_cuerpo_requerido: 'Indica el texto del aviso.',
      aviso_publish_failed: 'No se pudo publicar el aviso.',
      aviso_desactivar_failed: 'No se pudo desactivar el aviso.',
      aviso_no_activo: 'Ese aviso ya no está activo.',
      aviso_ack_failed: 'No se pudo guardar la aceptación.',
      aviso_app_unavailable: 'Avisos de app no disponibles.',
      aviso_no_encontrado: 'Ese aviso ya no existe.',
      role_forbidden: 'Tu rol no puede ver el historial de avisos.',
      sugerencia_tipo_invalido: 'Elige Fallo o Sugerencia.',
      sugerencia_titulo_requerido: 'Indica un título.',
      sugerencia_cuerpo_requerido: 'Indica el mensaje.',
      sugerencia_ack_failed: 'No se pudo guardar la aceptación.',
      sugerencia_no_encontrada: 'Ese mensaje ya no existe.',
      sugerencia_unavailable: 'Sugerencias no disponibles.',
      sugerencias_kv_missing: 'Almacenamiento de sugerencias no disponible.',
      turnio_profile_inactive: 'Tu perfil TURNIO está desactivado.',
      turnio_profile_expired: 'Tu acceso temporal ha caducado.',
      turnio_profile_unavailable: 'No hay perfil TURNIO para este correo. Pide alta a un ADMIN.',
      supabase_auth_required: 'Tu sesión ha caducado. Vuelve a entrar.',
      supabase_session_invalid: 'Sesión no válida. Vuelve a entrar.'
    };
    var base = mapa[code] || code;
    if (code === 'maintenance_mode' && d.mensaje) base = String(d.mensaje);
    else if (d.detail) base += ' (' + String(d.detail).slice(0, 120) + ')';
    return base;
  }
  function setStatus(kind, text) {
    status.className = 'status ' + kind;
    status.textContent = text || '';
    // El aviso técnico de "conexión preparada" no se muestra; errores/OTP sí.
    status.hidden = kind === 'ready' && !text;
  }
  function toast(text, type) {
    var t = document.getElementById('toast');
    if (!t) return;
    montarToast_(t);
    // Sin tipo → azul TURNIO (antes: texto blanco sobre fondo transparente).
    var kind = type || 'info';
    t.textContent = text;
    t.className = 'toast show' + (kind === 'info' ? '' : (' ' + kind));
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () {
      t.classList.remove('show');
      t.className = 'toast';
    }, 3200);
  }

  /** En fullscreen nativo del mapa el toast debe vivir dentro de #screen-mapa. */
  function montarToast_(el) {
    if (!el) return;
    var scr = document.getElementById('screen-mapa');
    var fs = typeof mapaFullscreenEl_ === 'function' ? mapaFullscreenEl_() : (document.fullscreenElement || null);
    var host = document.body;
    if (scr && fs === scr) {
      if (el.parentElement !== scr) scr.appendChild(el);
      return;
    }
    if (el.parentElement !== host) host.appendChild(el);
  }

  function lanzarExitoAnimado(mensaje) {
    var modal = document.getElementById('modal-exito-animado');
    var txt = document.getElementById('texto-exito-animado');
    if (!modal || !txt) {
      toast(mensaje || '¡Hecho!', 'success');
      return;
    }
    txt.textContent = mensaje || '¡Hecho!';
    // Reinicia la animación del check
    var svg = modal.querySelector('.check-svg');
    if (svg) {
      var clone = svg.cloneNode(true);
      svg.parentNode.replaceChild(clone, svg);
    }
    modal.hidden = false;
    modal.style.opacity = '1';
    clearTimeout(window._exitoTimer);
    clearTimeout(window._exitoHideTimer);
    window._exitoTimer = setTimeout(function () {
      modal.style.opacity = '0';
      window._exitoHideTimer = setTimeout(function () {
        modal.hidden = true;
        modal.style.opacity = '1';
      }, 300);
    }, 2500);
  }

  var pantallasEstaciones = null;
  var pantallasCarga = null;
  var pantallasBuscarTimer = null;

  function pantallasNorm_(s) {
    return String(s || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }

  function pantallasTitulo_(n) {
    return String(n || '')
      .toLowerCase()
      .replace(/(^|[\s\-/])([a-zà-ÿ])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function pantallasEsc_(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Pantallas ADIF oficiales (info.adif.es). Evita WebSocket propio, que falla en Renfe/Zscaler/Edge.
  function pantallasOficialUrl_(codigo, modo) {
    return 'https://info.adif.es/?s=' + encodeURIComponent(codigo) +
      '&v=' + (modo === 'al' ? 'al' : 'dl');
  }

  function abrirAdifPantallas_(codigo, modo) {
    window.open(pantallasOficialUrl_(codigo, modo), '_blank', 'noopener');
  }

  var adifInfoStationProbe_ = null;
  var adifSignalRLoading_ = null;
  // Cliente persistente vía ADIF (InfoStation / Gravita). Topic: PRO-ECM-{código}.
  var adifLiveConn_ = null;
  var adifLiveStation_ = '';
  var adifLiveCache_ = Object.create(null);
  var adifLiveStarting_ = null;
  var adifLiveLastMsgAt_ = 0;
  var adifLivePollTimer_ = null;
  var ADIF_EVENTOS_ = [
    'ReceiveMessage', 'receiveMessage', 'SendMessage', 'sendMessage',
    'Receive', 'Update', 'Info', 'StationInfo', 'LastMessage', 'Broadcast'
  ];

  function adifExtraerPayloadMsg_() {
    var args = Array.prototype.slice.call(arguments);
    if (!args.length) return null;
    // Firmas vistas / sospechadas: (payload) | (topic, payload) | (payload, topic)
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a == null || a === '') continue;
      if (typeof a === 'string') {
        var t = a.trim();
        if (!t) continue;
        if (t.charAt(0) === '{' || t.charAt(0) === '[') return t;
        // topic tipo PRO-ECM-18000 → seguir buscando payload
        if (/^(PRO-)?ECM[-_]?\d+$/i.test(t) || /^\d{4,5}$/.test(t)) continue;
        return t;
      }
      if (typeof a === 'object') return a;
    }
    return args.length === 1 ? args[0] : args;
  }

  function adifRegistrarHandlers_(conn, onMsg) {
    ADIF_EVENTOS_.forEach(function (ev) {
      try {
        conn.on(ev, function () {
          var payload = adifExtraerPayloadMsg_.apply(null, arguments);
          if (payload != null) onMsg(payload, ev);
        });
      } catch (_) {}
    });
    if (typeof conn.onany === 'function') {
      try {
        conn.onany(function (evName) {
          var args = Array.prototype.slice.call(arguments, 1);
          var payload = adifExtraerPayloadMsg_.apply(null, args);
          if (payload != null) onMsg(payload, String(evName || 'onany'));
        });
      } catch (_) {}
    }
  }

  function adifPararPoll_() {
    if (adifLivePollTimer_) {
      clearInterval(adifLivePollTimer_);
      adifLivePollTimer_ = null;
    }
  }

  function adifArrancarPoll_(conn, codigo) {
    adifPararPoll_();
    adifLivePollTimer_ = setInterval(function () {
      if (!conn || adifLiveConn_ !== conn) {
        adifPararPoll_();
        return;
      }
      adifJoinTopics_(conn, codigo).catch(function () {});
    }, 8000);
  }

  function setAdifProbeStatus_(text, state) {
    var el = document.getElementById('adif-infostation-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-err', 'is-run');
    if (state) el.classList.add(state);
  }

  function cargarSignalRAdif_() {
    if (window.signalR && window.signalR.HubConnectionBuilder) {
      return Promise.resolve(window.signalR);
    }
    if (adifSignalRLoading_) return adifSignalRLoading_;
    adifSignalRLoading_ = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@microsoft/signalr@8.0.7/dist/browser/signalr.min.js';
      s.async = true;
      s.onload = function () {
        if (window.signalR && window.signalR.HubConnectionBuilder) resolve(window.signalR);
        else reject(new Error('SignalR cargado sin HubConnectionBuilder.'));
      };
      s.onerror = function () {
        adifSignalRLoading_ = null;
        reject(new Error('No se pudo cargar la librería SignalR (CDN).'));
      };
      document.head.appendChild(s);
    });
    return adifSignalRLoading_;
  }

  function codigoEstacionProbeAdif_() {
    var inp = document.getElementById('pantallas-buscar');
    var digits = String((inp && inp.value) || '').replace(/\D/g, '');
    if (digits.length >= 4) return digits.replace(/^0+(?=\d)/, '') || digits;
    // Por defecto Atocha: más tráfico nocturno que Santa Justa.
    return '18000';
  }

  function resumirMensajeAdif_(mensajeCrudo) {
    var datos = typeof mensajeCrudo === 'string' ? JSON.parse(mensajeCrudo) : mensajeCrudo;
    if (datos == null) return { ok: false, resumen: 'payload vacío' };
    var trenes = Array.isArray(datos.trains) ? datos.trains
      : (Array.isArray(datos) ? datos : null);
    if (!trenes) {
      var keys = typeof datos === 'object' ? Object.keys(datos).slice(0, 12).join(', ') : typeof datos;
      return { ok: true, resumen: 'payload sin .trains (keys: ' + keys + ')', trenes: [] };
    }
    var conVia = trenes.filter(function (t) { return t && (t.platform || t.platform_in); }).length;
    var sample = trenes[0] || null;
    var extra = '';
    if (sample) {
      var num =
        (sample.commercial_id && sample.commercial_id[0] && sample.commercial_id[0].number) ||
        sample.technical_number_planif ||
        sample.id ||
        '?';
      var via = sample.platform || sample.platform_in || '—';
      extra = ' · ej. tren ' + num + ' vía ' + via;
    }
    return {
      ok: true,
      resumen: trenes.length + ' tren(es), ' + conVia + ' con vía' + extra,
      trenes: trenes
    };
  }

  async function probarUnModoInfoStation_(signalR, opts, codigo, log) {
    var result = { modo: opts.label, connected: false, message: false, detail: '' };
    var conn = new signalR.HubConnectionBuilder()
      .withUrl('https://info.adif.es/InfoStation', opts.urlOpts)
      .build();
    try {
      conn.keepAliveIntervalInMilliseconds = 10000;
      conn.serverTimeoutInMilliseconds = 120000;
    } catch (_) {}
    adifInfoStationProbe_ = conn;
    var got = [];
    adifRegistrarHandlers_(conn, function (payload, ev) {
      got.push({ ev: ev || 'handler', args: [payload] });
    });
    try {
      await conn.start();
      result.connected = true;
      log('   [' + opts.label + '] conectado');
      var padded = String(codigo);
      while (padded.length < 5) padded = '0' + padded;
      var canales = [];
      [codigo, padded].forEach(function (c) {
        ['PRO-ECM-' + c, 'ECM-' + c, c, 'ECM' + c].forEach(function (ch) {
          if (canales.indexOf(ch) < 0) canales.push(ch);
        });
      });
      if (codigo !== '18000') {
        canales.push('PRO-ECM-18000');
        canales.push('ECM-18000');
      } else {
        canales.push('PRO-ECM-51003');
        canales.push('ECM-51003');
      }
      for (var i = 0; i < canales.length; i++) {
        var canal = canales[i];
        try {
          await conn.invoke('JoinInfo', canal);
          log('   JoinInfo OK · ' + canal);
        } catch (eJoin) {
          log('   JoinInfo FAIL · ' + canal + ' · ' + String(eJoin.message || eJoin));
          continue;
        }
        var ret = null;
        try {
          ret = await conn.invoke('GetLastMessage', canal);
          if (ret != null && ret !== '') {
            got.push({ ev: 'GetLastMessage:return', args: [ret], canal: canal });
            log('   GetLastMessage devolvió datos · ' + canal);
          } else {
            log('   GetLastMessage sin retorno · ' + canal);
          }
        } catch (eGet) {
          log('   GetLastMessage FAIL · ' + canal + ' · ' + String(eGet.message || eGet));
        }
      }
      // Segunda pasada GetLast a +2s (a veces el snapshot llega tras Join).
      await new Promise(function (r) { setTimeout(r, 2000); });
      for (var j = 0; j < Math.min(4, canales.length); j++) {
        try {
          var ret2 = await conn.invoke('GetLastMessage', canales[j]);
          if (ret2 != null && ret2 !== '') {
            got.push({ ev: 'GetLastMessage:retry', args: [ret2], canal: canales[j] });
            log('   GetLastMessage retry OK · ' + canales[j]);
            break;
          }
        } catch (_) {}
      }
      var t0 = Date.now();
      while (!got.length && Date.now() - t0 < 12000) {
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      if (got.length) {
        result.message = true;
        var first = got[0];
        try {
          var raw = first.args && first.args.length === 1 ? first.args[0] : first.args;
          var sum = resumirMensajeAdif_(raw);
          result.detail = first.ev + ' → ' + sum.resumen;
          log('   DATOS vía ' + first.ev + ': ' + sum.resumen);
        } catch (eSum) {
          result.detail = first.ev + ' (no parseable): ' + String(eSum.message || eSum);
          log('   DATOS vía ' + first.ev + ' no parseables');
        }
      } else {
        result.detail = 'sin push ni retorno en ~14 s';
        log('   sin mensajes en este modo');
      }
    } finally {
      try { await conn.stop(); } catch (_) {}
      if (adifInfoStationProbe_ === conn) adifInfoStationProbe_ = null;
    }
    return result;
  }

  async function probarInfoStationAdif_() {
    var btn = document.getElementById('btn-probar-infostation');
    var codigo = codigoEstacionProbeAdif_();
    var lines = [];
    function log(line) {
      lines.push(line);
      setAdifProbeStatus_(lines.join('\n'), 'is-run');
    }
    if (btn) btn.disabled = true;
    try {
      if (adifInfoStationProbe_) {
        try { await adifInfoStationProbe_.stop(); } catch (_) {}
        adifInfoStationProbe_ = null;
      }
      log('1) Cargando SignalR…');
      var signalR = await cargarSignalRAdif_();
      log('2) Estación ' + codigo + (codigo === '18000' ? ' (Atocha)' : codigo === '51003' ? ' (Santa Justa)' : '') + '. Probando modos…');
      var modos = [
        {
          label: 'WS skipNegotiation (GAS)',
          urlOpts: {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets
          }
        },
        {
          label: 'negociado (WS/SSE/LP)',
          urlOpts: {}
        }
      ];
      var results = [];
      for (var m = 0; m < modos.length; m++) {
        log('3.' + (m + 1) + ') Modo ' + modos[m].label);
        try {
          results.push(await probarUnModoInfoStation_(signalR, modos[m], codigo, log));
        } catch (eModo) {
          log('   ERROR modo: ' + String(eModo.message || eModo));
          results.push({
            modo: modos[m].label,
            connected: false,
            message: false,
            detail: String(eModo.message || eModo)
          });
        }
      }
      log('—');
      log('RESUMEN:');
      var anyMsg = false;
      var anyConn = false;
      results.forEach(function (r) {
        anyConn = anyConn || r.connected;
        anyMsg = anyMsg || r.message;
        log('· ' + r.modo + ': ' +
          (r.connected ? 'conexión OK' : 'sin conexión') +
          (r.message ? ' + DATOS' : ' + sin datos') +
          (r.detail ? ' (' + r.detail + ')' : ''));
      });
      if (anyMsg) {
        setAdifProbeStatus_(lines.join('\n'), 'is-ok');
        toast('InfoStation: datos recibidos', 'success');
      } else if (anyConn) {
        lines.push('Conclusión: WebSocket accesible, pero el hub no entrega snapshot (protocolo/canal o sin tráfico en canal).');
        lines.push('El panel web oficial puede seguir funcionando; implantar vía en TURNIO requiere capturar el tráfico real del navegador en info.adif.es.');
        setAdifProbeStatus_(lines.join('\n'), 'is-err');
        toast('InfoStation: conecta sin datos', 'error');
      } else {
        lines.push('Conclusión: no hay conexión usable a InfoStation desde este entorno.');
        setAdifProbeStatus_(lines.join('\n'), 'is-err');
        toast('InfoStation no disponible', 'error');
      }
    } catch (err) {
      var msg = String((err && err.message) || err || 'Error desconocido');
      lines.push('ERROR: ' + msg);
      setAdifProbeStatus_(lines.join('\n'), 'is-err');
      toast('InfoStation no disponible aquí', 'error');
      if (adifInfoStationProbe_) {
        try { await adifInfoStationProbe_.stop(); } catch (_) {}
        adifInfoStationProbe_ = null;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  window.TurnioProbarInfoStation = probarInfoStationAdif_;

  function scriptCapturaAdif_() {
    return [
      '(async () => {',
      '  const log = [];',
      '  const push = (...a) => { const line = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); log.push(line); console.log("[TURNIO-ADIF]", ...a); };',
      '  const OrigWS = window.WebSocket;',
      '  window.WebSocket = function (url, protocols) {',
      '    push("WS open", url);',
      '    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);',
      '    const origSend = ws.send.bind(ws);',
      '    ws.send = (data) => { push("WS SEND", String(data).slice(0, 400)); return origSend(data); };',
      '    ws.addEventListener("message", (ev) => {',
      '      const t = String(ev.data);',
      '      if (/platform|trains|Receive|JoinInfo|GetLast|ECM/i.test(t)) push("WS HIT", t.slice(0, 1200));',
      '      else push("WS RECV", t.slice(0, 200));',
      '    });',
      '    return ws;',
      '  };',
      '  window.WebSocket.prototype = OrigWS.prototype;',
      '  push("Hook WS listo. Recarga F5 esta pestana (info.adif.es) y espera 10s con pantallas visibles.");',
      '  push("Luego ejecuta: copy(__TURNIO_ADIF_LOG.join(String.fromCharCode(10))) y pegalo en el chat.");',
      '  window.__TURNIO_ADIF_LOG = log;',
      '  return "OK — ahora F5";',
      '})();'
    ].join('\n');
  }

  async function copiarScriptCapturaAdif_() {
    var txt = scriptCapturaAdif_();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        throw new Error('no clipboard');
      }
      toast('Script copiado. Pégalo en la consola de info.adif.es y pulsa F5.', 'success');
      setAdifProbeStatus_(
        'Script de captura copiado.\n1) Abre https://info.adif.es/?s=18000\n2) F12 → Consola → pega (Ctrl+V) → Enter\n3) F5\n4) Espera 10 s con salidas visibles\n5) En consola: copy(__TURNIO_ADIF_LOG.join("\\n"))\n6) Pega el resultado aquí en el chat',
        'is-run'
      );
    } catch (_) {
      setAdifProbeStatus_('No se pudo copiar. Script:\n\n' + txt, 'is-err');
      toast('No se pudo copiar al portapapeles; mira el cuadro de diagnóstico.', 'error');
    }
  }
  window.TurnioScriptCapturaAdif = scriptCapturaAdif_;

  function adifNormalizarCodigoEst_(codigo) {
    var digits = String(codigo == null ? '' : codigo).replace(/\D/g, '');
    if (!digits) return '';
    return digits.replace(/^0+(?=\d)/, '') || digits;
  }

  function adifNumTrenDePayload_(t) {
    if (!t || typeof t !== 'object') return '';
    var raw =
      (t.commercial_id && t.commercial_id[0] && t.commercial_id[0].number) ||
      t.technical_number_planif ||
      t.technical_number_in ||
      t.id ||
      '';
    return String(raw).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  }

  function adifViaDePayload_(t) {
    if (!t || typeof t !== 'object') return '';
    var v = t.platform != null && String(t.platform).trim() !== '' ? t.platform : t.platform_in;
    return v != null ? String(v).trim() : '';
  }

  function adifAccesoDePayload_(t) {
    if (!t || typeof t !== 'object') return '';
    var keys = ['access_in', 'access_out', 'access', 'passenger_access', 'hall', 'boarding_access', 'entry'];
    for (var i = 0; i < keys.length; i++) {
      var v = t[keys[i]];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function setAdifLiveStatusUi_(text, state) {
    var el = document.getElementById('adif-live-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-err', 'is-run');
    if (state) el.classList.add(state);
  }

  function aplicarCacheAdifDesdePayload_(mensajeCrudo) {
    var datos = typeof mensajeCrudo === 'string' ? JSON.parse(mensajeCrudo) : mensajeCrudo;
    if (datos == null) return 0;
    var trenes = Array.isArray(datos.trains) ? datos.trains
      : (Array.isArray(datos) ? datos : null);
    if (!trenes) return 0;
    var next = Object.create(null);
    var n = 0;
    trenes.forEach(function (t) {
      var num = adifNumTrenDePayload_(t);
      if (!num) return;
      next[num] = {
        via: adifViaDePayload_(t),
        acceso: adifAccesoDePayload_(t),
        raw: t,
        ts: Date.now()
      };
      n++;
    });
    adifLiveCache_ = next;
    adifLiveLastMsgAt_ = Date.now();
    return n;
  }

  function lookupViaAdif_(numTren) {
    var num = String(numTren == null ? '' : numTren).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!num) return null;
    return adifLiveCache_[num] || null;
  }

  function asegurarChipViaAdif_(host, via, acceso) {
    if (!host) return;
    var chip = host.querySelector('.chip-via-adif');
    if (!via) {
      if (chip) chip.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'chip-via-adif';
      host.insertBefore(chip, host.firstChild);
    }
    chip.textContent = '📡 VÍA ' + via + (acceso ? ' · Acc. ' + acceso : '');
  }

  function inyectarViaAdifEnMallas_() {
    document.querySelectorAll('#resultadosGTFS .flip-card').forEach(function (card) {
      var info = lookupViaAdif_(card.getAttribute('data-num'));
      var tripInfo = card.querySelector('.trip-info');
      asegurarChipViaAdif_(tripInfo, info && info.via, info && info.acceso);
      if (info && info.via) card.classList.add('has-via-adif');
      else card.classList.remove('has-via-adif');
      var backVia = card.querySelector('[data-via-adif-slot]');
      if (backVia) {
        backVia.textContent = info && info.via
          ? ('Vía ADIF: ' + info.via + (info.acceso ? ' · Acceso ' + info.acceso : ''))
          : '';
      }
    });
    document.querySelectorAll('#mallas-resultados .malla-item').forEach(function (item) {
      var info = lookupViaAdif_(item.getAttribute('data-tren'));
      var meta = item.querySelector('.malla-meta');
      asegurarChipViaAdif_(meta, info && info.via, info && info.acceso);
    });
  }

  function codigoEstacionMallasActual_() {
    var input = document.getElementById('inputEstacionBuscar');
    var name = String((input && input.value) || '').trim();
    var mapa = window.mapaEstacionesGlobal || {};
    if (name) {
      var key = Object.keys(mapa).find(function (k) {
        return String(k).toLowerCase() === name.toLowerCase();
      });
      var ids = key ? mapa[key] : null;
      if (ids && ids.length) {
        var code = adifNormalizarCodigoEst_(ids[0]);
        if (code) return code;
      }
    }
    return '51003';
  }

  async function adifJoinTopics_(conn, codigo) {
    var padded = String(codigo);
    while (padded.length < 5) padded = '0' + padded;
    var topics = [];
    [codigo, padded].forEach(function (c) {
      ['PRO-ECM-' + c, 'ECM-' + c].forEach(function (ch) {
        if (topics.indexOf(ch) < 0) topics.push(ch);
      });
    });
    for (var i = 0; i < topics.length; i++) {
      try {
        await conn.invoke('JoinInfo', topics[i]);
      } catch (_) {}
      try {
        var ret = await conn.invoke('GetLastMessage', topics[i]);
        if (ret != null && ret !== '') onAdifLiveMessage_(ret);
      } catch (_) {}
    }
    return topics;
  }

  function onAdifLiveMessage_(mensajeCrudo, evName) {
    try {
      var n = aplicarCacheAdifDesdePayload_(mensajeCrudo);
      var conVia = 0;
      Object.keys(adifLiveCache_).forEach(function (k) {
        if (adifLiveCache_[k] && adifLiveCache_[k].via) conVia++;
      });
      setAdifLiveStatusUi_(
        'Escuchando PRO-ECM-' + adifLiveStation_ + ' · ' + n + ' tren(es), ' + conVia + ' con vía' +
          (evName ? ' · ' + evName : '') +
          (adifLiveLastMsgAt_ ? ' · ' + new Date(adifLiveLastMsgAt_).toLocaleTimeString('es-ES') : ''),
        n ? 'is-ok' : 'is-run'
      );
      inyectarViaAdifEnMallas_();
    } catch (err) {
      setAdifLiveStatusUi_('Mensaje ADIF no parseable: ' + String(err.message || err), 'is-err');
    }
  }

  async function escucharInfoStationEstacion_(codigo) {
    var code = adifNormalizarCodigoEst_(codigo) || '51003';
    if (adifLiveStarting_) return adifLiveStarting_;
    adifLiveStarting_ = (async function () {
      var signalR = await cargarSignalRAdif_();
      var Connected = signalR.HubConnectionState && signalR.HubConnectionState.Connected;
      if (adifLiveConn_ && Connected != null && adifLiveConn_.state === Connected && adifLiveStation_ === code) {
        await adifJoinTopics_(adifLiveConn_, code);
        adifArrancarPoll_(adifLiveConn_, code);
        setAdifLiveStatusUi_('Re-suscrito PRO-ECM-' + code + ' (cache ' + Object.keys(adifLiveCache_).length + ')', 'is-run');
        inyectarViaAdifEnMallas_();
        return;
      }
      if (adifLiveConn_) {
        adifPararPoll_();
        try { await adifLiveConn_.stop(); } catch (_) {}
        adifLiveConn_ = null;
      }
      setAdifLiveStatusUi_('Conectando InfoStation · PRO-ECM-' + code + '…', 'is-run');
      var conn = new signalR.HubConnectionBuilder()
        .withUrl('https://info.adif.es/InfoStation', {
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets
        })
        .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 30000])
        .build();
      try {
        conn.keepAliveIntervalInMilliseconds = 10000;
        conn.serverTimeoutInMilliseconds = 120000;
      } catch (_) {}
      adifRegistrarHandlers_(conn, function (payload, ev) {
        onAdifLiveMessage_(payload, ev);
      });
      conn.onreconnected(function () {
        adifJoinTopics_(conn, adifLiveStation_).catch(function () {});
        adifArrancarPoll_(conn, adifLiveStation_);
      });
      conn.onclose(function () {
        adifPararPoll_();
        setAdifLiveStatusUi_('InfoStation desconectado.', 'is-err');
      });
      await conn.start();
      adifLiveConn_ = conn;
      adifLiveStation_ = code;
      adifLiveCache_ = Object.create(null);
      var topics = await adifJoinTopics_(conn, code);
      adifArrancarPoll_(conn, code);
      setAdifLiveStatusUi_(
        'Conectado · ' + topics[0] + ' (y fallbacks). Esperando trenes…',
        'is-run'
      );
      setTimeout(function () {
        if (adifLiveConn_ !== conn) return;
        adifJoinTopics_(conn, code).catch(function () {});
      }, 1000);
    })();
    try {
      await adifLiveStarting_;
    } finally {
      adifLiveStarting_ = null;
    }
  }

  async function asegurarInfoStationParaMallas_() {
    var a = document.getElementById('screen-mallas');
    var vis = a && (a.classList.contains('active') || a.classList.contains('screen--in-float'));
    if (!vis) return;
    try {
      await escucharInfoStationEstacion_(codigoEstacionMallasActual_());
    } catch (err) {
      setAdifLiveStatusUi_('InfoStation: ' + String(err.message || err), 'is-err');
    }
  }

  window.TurnioEscucharInfoStation = escucharInfoStationEstacion_;
  window.TurnioLookupViaAdif = lookupViaAdif_;

  function asegurarEstacionesPantallas_() {
    if (pantallasEstaciones) return Promise.resolve(pantallasEstaciones);
    if (pantallasCarga) return pantallasCarga;
    pantallasCarga = fetch('./estaciones-pantallas.json')
      .then(function (r) {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo de estaciones.');
        return r.json();
      })
      .then(function (arr) {
        pantallasEstaciones = Array.isArray(arr) ? arr : [];
        return pantallasEstaciones;
      })
      .catch(function (err) {
        pantallasCarga = null;
        throw err;
      });
    return pantallasCarga;
  }

  function filtrarEstacionesPantallas_(q) {
    var raw = String(q || '').trim();
    if (!raw) return [];
    var nq = pantallasNorm_(raw);
    var digits = raw.replace(/\D/g, '');
    var list = pantallasEstaciones || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var st = list[i];
      var code = String(st.c || '');
      var nameN = pantallasNorm_(st.n);
      var score = 0;
      if (digits && code.indexOf(digits) === 0) score = 100 - Math.min(code.length, 20);
      else if (digits && code.indexOf(digits) >= 0) score = 70;
      else if (nameN.indexOf(nq) === 0) score = 60;
      else if (nameN.indexOf(nq) >= 0) score = 40;
      if (score > 0) out.push({ st: st, score: score });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.st.n).localeCompare(String(b.st.n), 'es');
    });
    return out.slice(0, 30).map(function (x) { return x.st; });
  }

  function filaPantallasHtml_(st) {
    var meta = [];
    if (st.cer) meta.push('Cerc.');
    if (st.feve) meta.push('Feve');
    return '<div class="pantallas-res">' +
      '<div class="pantallas-res-info">' +
        '<b>' + pantallasEsc_(pantallasTitulo_(st.n)) + '</b>' +
        '<span>' + pantallasEsc_(st.c) +
          (meta.length ? ' · <span class="pantallas-res-meta">' + pantallasEsc_(meta.join(' · ')) + '</span>' : '') +
        '</span>' +
      '</div>' +
      '<div class="pantallas-res-actions">' +
        '<button type="button" class="pantallas-monit" data-adif-code="' + pantallasEsc_(st.c) + '" data-adif-modo="dl">Salidas</button>' +
        '<button type="button" class="pantallas-monit pantallas-monit--al" data-adif-code="' + pantallasEsc_(st.c) + '" data-adif-modo="al">Llegadas</button>' +
      '</div>' +
    '</div>';
  }

  function pintarResultadosPantallas_(q) {
    var box = document.getElementById('pantallas-resultados');
    if (!box) return;
    var raw = String(q || '').trim();
    if (!raw) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    var hits = filtrarEstacionesPantallas_(raw);
    if (!hits.length) {
      box.innerHTML = '<div class="pantallas-res-empty">Sin coincidencias.</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = hits.map(filaPantallasHtml_).join('');
    box.hidden = false;
  }

  function abrirPantallas() {
    var inp = document.getElementById('pantallas-buscar');
    pintarResultadosPantallas_(inp ? inp.value : '');
    asegurarEstacionesPantallas_().catch(function (err) {
      toast(String(err.message || err), 'error');
    });
  }

  function wirePantallasUi_() {
    var inp = document.getElementById('pantallas-buscar');
    var box = document.getElementById('pantallas-resultados');
    if (inp) {
      inp.addEventListener('input', function () {
        var q = inp.value;
        clearTimeout(pantallasBuscarTimer);
        pantallasBuscarTimer = setTimeout(function () {
          asegurarEstacionesPantallas_()
            .then(function () { pintarResultadosPantallas_(q); })
            .catch(function (err) { toast(String(err.message || err), 'error'); });
        }, 120);
      });
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          inp.value = '';
          pintarResultadosPantallas_('');
        }
      });
    }
    if (box) {
      box.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-adif-code]');
        if (!btn) return;
        abrirAdifPantallas_(btn.getAttribute('data-adif-code'), btn.getAttribute('data-adif-modo'));
      });
    }
    var btnProbe = document.getElementById('btn-probar-infostation');
    if (btnProbe) {
      btnProbe.addEventListener('click', function () {
        probarInfoStationAdif_();
      });
    }
    var btnLive = document.getElementById('btn-escuchar-infostation');
    if (btnLive) {
      btnLive.addEventListener('click', function () {
        var codigo = codigoEstacionProbeAdif_();
        btnLive.disabled = true;
        escucharInfoStationEstacion_(codigo)
          .then(function () {
            toast('Escuchando vía ADIF · ' + codigo, 'success');
          })
          .catch(function (err) {
            toast(String(err.message || err), 'error');
          })
          .then(function () { btnLive.disabled = false; });
      });
    }
    var btnCap = document.getElementById('btn-captura-adif-script');
    if (btnCap) {
      btnCap.addEventListener('click', function () {
        copiarScriptCapturaAdif_();
      });
    }
  }

  // ========== CALCULAR KMS (datos Anthony) ==========
  var kmsData = null;
  var kmsCarga = null;
  var kmsIndex = null;
  var kmsCities = [];
  var kmsTramos = [];
  var kmsSugTimer = null;
  var kmsFR = {
    'Perpignan': 1, 'Narbonne': 1, 'Montpellier St. Roch': 1, 'Nimes Centre': 1,
    'Avignon TGV': 1, 'Aix-en-Provence TGV': 1, 'Marseille Saint Charles': 1,
    'Valence TGV': 1, 'Lyon Part Dieu': 1
  };

  function asegurarKmsData_() {
    if (kmsData && kmsIndex) return Promise.resolve(kmsData);
    if (kmsCarga) return kmsCarga;
    kmsCarga = fetch('./distancias-kms.json')
      .then(function (r) {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo de kilómetros.');
        return r.json();
      })
      .then(function (data) {
        kmsData = data || { cities: [], pairs: [] };
        kmsCities = Array.isArray(kmsData.cities) ? kmsData.cities.slice() : [];
        kmsIndex = Object.create(null);
        (kmsData.pairs || []).forEach(function (p) {
          if (!p || p.length < 3) return;
          var a = String(p[0]);
          var b = String(p[1]);
          var km = Number(p[2]);
          if (!a || !b || !isFinite(km)) return;
          kmsIndex[a + '\t' + b] = km;
          if (kmsIndex[b + '\t' + a] == null) kmsIndex[b + '\t' + a] = km;
        });
        return kmsData;
      })
      .catch(function (err) {
        kmsCarga = null;
        throw err;
      });
    return kmsCarga;
  }

  function kmsEsc_(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kmsLabel_(name) {
    var n = String(name || '');
    return kmsFR[n] ? (kmsEsc_(n) + ' <span class="kms-fr" title="Francia">FR</span>') : kmsEsc_(n);
  }

  function obtenerDistanciaKms_(a, b) {
    if (!kmsIndex) return null;
    var v = kmsIndex[a + '\t' + b];
    return v == null ? null : v;
  }

  function pintarTotalKms_() {
    var totalEl = document.getElementById('kms-total');
    var tbody = document.getElementById('kms-tbody');
    if (!totalEl || !tbody) return;
    if (!kmsTramos.length) {
      totalEl.hidden = true;
      totalEl.textContent = '';
      return;
    }
    var sum = 0;
    for (var i = 0; i < kmsTramos.length; i++) sum += kmsTramos[i].km;
    totalEl.hidden = false;
    totalEl.textContent = 'Total: ' + sum + ' km';
  }

  function pintarTablaKms_() {
    var tbody = document.getElementById('kms-tbody');
    if (!tbody) return;
    tbody.innerHTML = kmsTramos.map(function (t) {
      return '<tr><td>' + kmsLabel_(t.a) + '</td><td>' + kmsLabel_(t.b) + '</td><td>' + t.km + '</td></tr>';
    }).join('');
    pintarTotalKms_();
  }

  function kmsSetMsg_(text) {
    var el = document.getElementById('kms-msg');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  function filtrarCiudadesKms_(q) {
    var nq = String(q || '').trim().toLowerCase();
    if (!nq) return [];
    var out = [];
    for (var i = 0; i < kmsCities.length; i++) {
      var c = kmsCities[i];
      if (c.toLowerCase().indexOf(nq) >= 0) out.push(c);
      if (out.length >= 12) break;
    }
    return out;
  }

  function pintarSugKms_(boxId, inputId, q) {
    var box = document.getElementById(boxId);
    var inp = document.getElementById(inputId);
    if (!box || !inp) return;
    var hits = filtrarCiudadesKms_(q);
    if (!hits.length) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    box.innerHTML = hits.map(function (c, i) {
      return '<button type="button" data-kms-city="' + kmsEsc_(c) + '"' +
        (i === 0 ? ' class="is-on"' : '') + '>' + kmsEsc_(c) + '</button>';
    }).join('');
    box.hidden = false;
  }

  function ocultarSugKms_() {
    ['kms-sug-origen', 'kms-sug-destino'].forEach(function (id) {
      var box = document.getElementById(id);
      if (!box) return;
      box.innerHTML = '';
      box.hidden = true;
    });
  }

  function anadirTramoKms_() {
    var aInp = document.getElementById('kms-origen');
    var bInp = document.getElementById('kms-destino');
    var a = aInp ? aInp.value.trim() : '';
    var b = bInp ? bInp.value.trim() : '';
    if (!a || !b) {
      kmsSetMsg_('Indica origen y destino.');
      return;
    }
    var km = obtenerDistanciaKms_(a, b);
    if (km == null) {
      kmsSetMsg_('No hay distancia para ese par de estaciones.');
      return;
    }
    kmsSetMsg_('');
    kmsTramos.push({ a: a, b: b, km: km });
    pintarTablaKms_();
    ocultarSugKms_();
  }

  function abrirKms() {
    asegurarKmsData_()
      .then(function () { pintarTablaKms_(); })
      .catch(function (err) {
        kmsSetMsg_(String(err.message || err));
        toast(String(err.message || err), 'error');
      });
  }

  function wireKmsField_(inputId, sugId) {
    var inp = document.getElementById(inputId);
    var box = document.getElementById(sugId);
    if (!inp || !box) return;
    inp.addEventListener('input', function () {
      var q = inp.value;
      clearTimeout(kmsSugTimer);
      kmsSugTimer = setTimeout(function () {
        asegurarKmsData_()
          .then(function () { pintarSugKms_(sugId, inputId, q); })
          .catch(function (err) { toast(String(err.message || err), 'error'); });
      }, 80);
    });
    inp.addEventListener('keydown', function (ev) {
      var buttons = box.querySelectorAll('button');
      var on = box.querySelector('button.is-on');
      var idx = on ? Array.prototype.indexOf.call(buttons, on) : -1;
      if (ev.key === 'ArrowDown' && buttons.length) {
        ev.preventDefault();
        idx = Math.min(idx + 1, buttons.length - 1);
        buttons.forEach(function (b, i) { b.classList.toggle('is-on', i === idx); });
      } else if (ev.key === 'ArrowUp' && buttons.length) {
        ev.preventDefault();
        idx = Math.max(idx - 1, 0);
        buttons.forEach(function (b, i) { b.classList.toggle('is-on', i === idx); });
      } else if (ev.key === 'Enter') {
        if (on) {
          ev.preventDefault();
          inp.value = on.getAttribute('data-kms-city') || on.textContent;
          ocultarSugKms_();
        } else {
          ev.preventDefault();
          anadirTramoKms_();
        }
      } else if (ev.key === 'Escape') {
        ocultarSugKms_();
      }
    });
    box.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-kms-city]');
      if (!btn) return;
      inp.value = btn.getAttribute('data-kms-city') || '';
      ocultarSugKms_();
      inp.focus();
    });
  }

  function wireKmsUi_() {
    wireKmsField_('kms-origen', 'kms-sug-origen');
    wireKmsField_('kms-destino', 'kms-sug-destino');
    var btnBuscar = document.getElementById('btn-kms-buscar');
    var btnSwap = document.getElementById('btn-kms-swap');
    var btnBorrar = document.getElementById('btn-kms-borrar');
    var btnLimpiar = document.getElementById('btn-kms-limpiar');
    if (btnBuscar) btnBuscar.addEventListener('click', anadirTramoKms_);
    if (btnSwap) {
      btnSwap.addEventListener('click', function () {
        var a = document.getElementById('kms-origen');
        var b = document.getElementById('kms-destino');
        if (!a || !b) return;
        var t = a.value;
        a.value = b.value;
        b.value = t;
      });
    }
    if (btnBorrar) {
      btnBorrar.addEventListener('click', function () {
        if (!kmsTramos.length) return;
        kmsTramos.pop();
        pintarTablaKms_();
      });
    }
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', function () {
        kmsTramos = [];
        pintarTablaKms_();
        kmsSetMsg_('');
      });
    }
    document.addEventListener('click', function (ev) {
      if (ev.target.closest('#kms-origen, #kms-destino, #kms-sug-origen, #kms-sug-destino')) return;
      ocultarSugKms_();
    });
  }

  function go(screen) {
    if (esComercial_() && !pantallaPermitidaComercial_(screen)) {
      toast('Tu perfil COMERCIAL solo puede usar Mapa y Servicios enlazados.', 'error');
      screen = 'home';
    }
    // Toggle: si ese flotante ya está abierto, el mismo botón lo cierra.
    if (floatState_ && floatState_.screenId === screen) {
      cerrarVentanaFlotante_();
      return;
    }
    if (debeAbrirFlotante_(screen)) {
      abrirVentanaFlotante_(screen);
      return;
    }
    if (floatState_ && pantallaActivaId_() === screen) {
      cerrarVentanaFlotante_();
      return;
    }
    cerrarVentanaFlotante_();
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + screen);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.go === screen);
    });
    if (screen !== 'mapa') {
      detenerAutoFlota();
      cerrarMarchaMapa();
      salirMapaFullscreen_();
    }
    entrarPantalla_(screen);
    gestionarAutoRadar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  var FLOAT_TITLES_ = {
    trafico: 'Circulación',
    mallas: 'Mallas',
    'mallas-localizador': 'Localizador mallas',
    kms: 'Kilómetros',
    pantallas: 'Pantallas estación',
    conexiones: 'Servicios enlazados',
    avisos: 'Avisos de red',
    'avisos-app': 'TURNIO RAIL'
  };
  /** Pantallas base desde las que Circulación/herramientas abren como flotante. */
  var FLOAT_BASE_KEEP_ = { radar: 1, mapa: 1 };
  /** Nunca flotan: siempre pantalla completa (como Inicio). */
  var FLOAT_NUNCA_ = { home: 1, radar: 1, ajustes: 1, perfil: 1, admin: 1, 'avisos-app': 1, sugerencias: 1 };
  var floatState_ = null;
  var floatZ_ = 3000;
  var floatMq_ = null;

  function pantallaActivaId_() {
    var a = document.querySelector('#app-shell > .screen.active, #app-shell .screen.active');
    if (!a) a = document.querySelector('.screen.active:not(.screen--in-float)');
    if (!a || !a.id) return '';
    return String(a.id).replace(/^screen-/, '');
  }

  function esDesktopFloat_() {
    if (window.TURNIO_DESKTOP_FLOAT_WINDOWS === false) return false;
    try {
      return window.matchMedia('(min-width: 900px)').matches;
    } catch (e) {
      return false;
    }
  }

  function debeAbrirFlotante_(screen) {
    if (!esDesktopFloat_()) return false;
    if (FLOAT_NUNCA_[screen]) return false;
    if (!FLOAT_TITLES_[screen]) return false;
    var cur = pantallaActivaId_();
    // Circulación solo flota desde Radar.
    if (screen === 'trafico') return cur === 'radar';
    // Herramientas desde Circulación flotante (abierta desde Radar): también flotan.
    if (floatState_ && floatState_.screenId === 'trafico') return true;
    // Desde Radar/Mapa (sin Circulación a pantalla completa): herramientas flotan.
    if (FLOAT_BASE_KEEP_[cur]) return true;
    // Circulación a pantalla completa (nav/FAB/Mapa/…) → Mallas, Enlazados, etc. a pantalla completa.
    return false;
  }

  function pintarNavActiva_(screen) {
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.go === screen);
    });
  }

  function entrarPantalla_(screen) {
    if (screen !== 'radar') cancelarVigilanteAutoOn_();
    if (screen === 'radar' && !radar.length) loadRadar();
    if (screen === 'radar') {
      refrescarAvisosRed();
      // CGO/ADMIN: Vigilante ON con retardo al entrar (evita avisos al instante).
      if (puedeEscribir && !vigilanteActivo) programarVigilanteAutoOn_();
    }
    if (screen === 'avisos') cargarPantallaAvisos(true);
    if (screen === 'avisos-app') {
      if (sessionProfile.role_code === 'INVITADO') {
        toast('Los invitados no tienen acceso a los avisos TURNIO RAIL.', 'error');
        go('home');
        return;
      }
      cargarAvisosApp_(true);
    }
    if (screen === 'sugerencias') {
      if (sessionProfile.role_code === 'INVITADO') {
        toast('Los invitados no pueden enviar sugerencias.', 'error');
        go('ajustes');
        return;
      }
    }
    if (screen === 'pantallas') abrirPantallas();
    if (screen === 'kms') abrirKms();
    if (screen === 'mapa') openMapa();
    if (screen === 'home') {
      refrescarAvisosRed();
      cargarClimaBienvenida_(false);
      if (sessionProfile.role_code !== 'INVITADO') cargarAvisosApp_(false);
    }
    if (screen === 'mallas') {
      if (window.TurnioMallasGtfs) {
        window.TurnioMallasGtfs.asegurarOperativaGtfs().catch(function (err) {
          var st = document.getElementById('gtfs-status');
          if (st) {
            st.textContent = String(err.message || err);
            st.style.color = 'var(--red)';
          }
          toast(String(err.message || err), 'error');
        });
      }
      precargarFlotaMapa();
      marcarMallasCirculandoDesdeFlota_();
      arrancarAutoFlota();
      asegurarInfoStationParaMallas_();
    }
    if (screen === 'conexiones') {
      asegurarCombinadosCompartidos_().finally(function () {
        if (typeof pintarPanelConexiones_ === 'function') pintarPanelConexiones_();
      });
    }
    if (screen === 'trafico') {
      asegurarCombinadosCompartidos_().finally(function () {
        if (typeof refrescarUiConexiones_ === 'function') refrescarUiConexiones_();
      });
    }
    if (screen === 'mallas-localizador') {
      asegurarRutasMallas().catch(function (err) {
        setMallasStatus(String(err.message || err), true);
      });
      precargarFlotaMapa();
      marcarMallasCirculandoDesdeFlota_();
      arrancarAutoFlota();
    }
    if (screen === 'admin') {
      if (!sessionProfile.is_admin) {
        toast('Solo ADMIN puede entrar en Administración.', 'error');
        go('ajustes');
        return;
      }
      cargarAdminPerfiles_();
      cargarAdminAviso_();
      cargarAdminSugerencias_();
      cargarAdminSolicitudes_();
      cargarAdminMantenimiento_();
      cargarAdminAccesos_();
    }
  }

  function invalidateMapaSiHay_() {
    if (!window._mapaLeaflet) return;
    setTimeout(function () {
      try { window._mapaLeaflet.invalidateSize(); } catch (e) {}
    }, 60);
  }

  function wireFloatDrag_(win, handle) {
    var dragging = false;
    var ox = 0;
    var oy = 0;
    var sx = 0;
    var sy = 0;
    function onMove(e) {
      if (!dragging) return;
      var nx = ox + (e.clientX - sx);
      var ny = oy + (e.clientY - sy);
      var maxX = Math.max(0, window.innerWidth - 80);
      var maxY = Math.max(0, window.innerHeight - 48);
      if (nx < -win.offsetWidth + 80) nx = -win.offsetWidth + 80;
      if (ny < 0) ny = 0;
      if (nx > maxX) nx = maxX;
      if (ny > maxY) ny = maxY;
      win.style.left = nx + 'px';
      win.style.top = ny + 'px';
      win.style.right = 'auto';
      win.style.bottom = 'auto';
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      dragging = true;
      var r = win.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      sx = e.clientX;
      sy = e.clientY;
      win.style.zIndex = String(++floatZ_);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  function cerrarVentanaFlotante_() {
    if (!floatState_) return;
    var st = floatState_;
    floatState_ = null;
    document.body.classList.remove('has-turnio-float');
    var screenEl = document.getElementById('screen-' + st.screenId);
    if (screenEl) {
      screenEl.classList.remove('screen--in-float');
      if (st.homeParent) {
        if (st.nextSibling && st.nextSibling.parentNode === st.homeParent) {
          st.homeParent.insertBefore(screenEl, st.nextSibling);
        } else {
          st.homeParent.appendChild(screenEl);
        }
      }
    }
    if (st.winEl && st.winEl.parentNode) st.winEl.parentNode.removeChild(st.winEl);
    var base = pantallaActivaId_();
    if (base) pintarNavActiva_(base);
    invalidateMapaSiHay_();
    gestionarAutoRadar();
  }

  function abrirVentanaFlotante_(screen) {
    var screenEl = document.getElementById('screen-' + screen);
    var host = document.getElementById('float-windows-host');
    if (!screenEl || !host) {
      // Fallback: navegación clásica si falta markup.
      cerrarVentanaFlotante_();
      document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
      if (screenEl) screenEl.classList.add('active');
      entrarPantalla_(screen);
      gestionarAutoRadar();
      return;
    }
    // El toggle (abrir/cerrar) lo resuelve go(); aquí no reenfocar.
    if (floatState_ && floatState_.screenId === screen) {
      cerrarVentanaFlotante_();
      return;
    }
    if (floatState_) cerrarVentanaFlotante_();

    var win = document.createElement('div');
    win.className = 'turnio-float';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', FLOAT_TITLES_[screen] || screen);
    win.style.zIndex = String(++floatZ_);
    win.style.width = Math.min(920, Math.max(520, Math.floor(window.innerWidth * 0.72))) + 'px';
    win.style.height = Math.min(780, Math.max(360, Math.floor(window.innerHeight * 0.78))) + 'px';
    win.style.left = Math.max(16, Math.floor((window.innerWidth - parseInt(win.style.width, 10)) / 2)) + 'px';
    win.style.top = Math.max(24, Math.floor(window.innerHeight * 0.08)) + 'px';

    var head = document.createElement('div');
    head.className = 'turnio-float-head';
    var title = document.createElement('h2');
    title.className = 'turnio-float-title';
    title.textContent = FLOAT_TITLES_[screen] || screen;
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'turnio-float-close';
    closeBtn.setAttribute('aria-label', 'Cerrar ventana');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { cerrarVentanaFlotante_(); });
    head.appendChild(title);
    head.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'turnio-float-body';

    floatState_ = {
      screenId: screen,
      homeParent: screenEl.parentNode,
      nextSibling: screenEl.nextSibling,
      winEl: win
    };
    body.appendChild(screenEl);
    screenEl.classList.add('screen--in-float');
    win.appendChild(head);
    win.appendChild(body);
    host.appendChild(win);
    document.body.classList.add('has-turnio-float');
    wireFloatDrag_(win, head);

    if (screen === 'trafico') {
      pintarNavActiva_(screen);
    }

    entrarPantalla_(screen);
    gestionarAutoRadar();
    invalidateMapaSiHay_();
  }

  function asegurarMediaFloat_() {
    try {
      floatMq_ = window.matchMedia('(min-width: 900px)');
      var onChange = function (ev) {
        if (!ev.matches) cerrarVentanaFlotante_();
      };
      if (floatMq_.addEventListener) floatMq_.addEventListener('change', onChange);
      else if (floatMq_.addListener) floatMq_.addListener(onChange);
    } catch (e) {}
  }
  asegurarMediaFloat_();

  function showApp(persona) {
    loginShell.hidden = true;
    appShell.hidden = false;
    nav.hidden = false;
    mostrarFab_(true);
    var nombre = (persona && persona.nombre) || 'Usuario';
    var email = (persona && persona.email) || document.getElementById('email').value || '';
    aplicarPermisosPerfil_(persona);
    sessionEmail = String(email || '').trim().toLowerCase();
    document.getElementById('welcome-name').textContent = saludoBienvenida_(nombre);
    var welcomeSub = document.getElementById('welcome-sub');
    if (welcomeSub) {
      welcomeSub.textContent = esComercial_()
        ? 'Perfil comercial: Mapa en vivo y Servicios enlazados.'
        : 'Bienvenido a TURNIO. Aquí tienes un primer vistazo al Radar y a los avisos de red.';
    }
    document.getElementById('user-name').textContent = nombre;
    var emailEl = document.getElementById('user-email');
    emailEl.textContent = email;
    emailEl.title = email;
    var userBox = emailEl.parentElement;
    if (userBox) userBox.title = email ? (nombre + ' · ' + email) : nombre;
    document.getElementById('profile-email').textContent = email;
    var profileName = document.getElementById('profile-name');
    if (profileName) profileName.textContent = nombre;
    // COMERCIAL: sin Radar/Vigilante/FAB; precarga mapa + combinados.
    if (esComercial_()) {
      mostrarFab_(false);
      setVigilanteState(false, true);
      precargarFlotaMapa();
      asegurarCombinadosCompartidos_().finally(function () {
        if (typeof refrescarUiConexiones_ === 'function') refrescarUiConexiones_();
      });
      go('home');
      return;
    }
    loadRadar();
    // Un perfil de consulta no puede arrancar un Vigilante aunque el
    // cuadrante heredado de GAS estuviera configurado para activarlo.
    // Auto-ON siempre con retardo (evita modales de críticos al entrar).
    if (puedeEscribir) arrancarVigilanteDesdeCuadrante();
    else setVigilanteState(false, true);
    gestionarAutoRadar();
    refrescarAvisosRed();
    cargarClimaBienvenida_(false);
    // Precarga flota ya; malla 28 MB un poco después para no competir con el 1.er Radar.
    precargarFlotaMapa();
    setTimeout(function () { precargarMallaOperativaAlEntrar_(); }, 2500);
    // Combinados del día publicados por CGO (si no hay cache local).
    asegurarCombinadosCompartidos_().finally(function () {
      if (typeof refrescarUiConexiones_ === 'function') refrescarUiConexiones_();
    });
    // Aviso ADMIN: aceptar = no volver; cerrar X = sale otra vez.
    comprobarAvisoAppAlEntrar_();
  }

  /** Descarga operativa diaria + índice de rutas tras login (no bloquea la UI). */
  function precargarMallaOperativaAlEntrar_() {
    if (window.TurnioMallasGtfs && typeof window.TurnioMallasGtfs.asegurarOperativaGtfs === 'function') {
      window.TurnioMallasGtfs.asegurarOperativaGtfs({ silencioso: true }).catch(function (err) {
        console.warn('[Mallas] precarga operativa al entrar', err);
      });
    }
    if (typeof asegurarRutasMallas === 'function') {
      asegurarRutasMallas().catch(function (err) {
        console.warn('[Mallas] precarga rutas al entrar', err);
      });
    }
  }

  // ========== MALLAS Y HORARIOS ==========
  var URL_RUTAS_OPERATIVA =
    'https://raw.githubusercontent.com/jrodfen/turnio-mallas-motor/phase2-mallas-pruebas/rutas_operativa.json';
  var MALLAS_CACHE = 'turnio-mallas-rutas-v1';
  var rutasOperativa = null;
  var rutasCargando = null;

  function setMallasStatus(text, isError) {
    var el = document.getElementById('mallas-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? 'var(--red)' : 'var(--muted)';
  }

  function hoyYyyymmddMadrid() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).replace(/-/g, '');
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    }
  }

  function formatHoraMalla(h) {
    var m = String(h || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return h || '--:--';
    return String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2];
  }

  function limpiarNumTrenMalla(v) {
    return String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  async function asegurarRutasMallas() {
    if (rutasOperativa) {
      setMallasStatus('Mallas listas · ' + (rutasOperativa.fecha || 'operativa cargada'));
      return rutasOperativa;
    }
    if (rutasCargando) return rutasCargando;
    rutasCargando = (async function () {
      setMallasStatus('Preparando mallas…');
      var data = null;
      try {
        if (window.caches) {
          var cache = await caches.open(MALLAS_CACHE);
          var cached = await cache.match(URL_RUTAS_OPERATIVA);
          if (cached) {
            setMallasStatus('Cargando mallas desde caché del dispositivo…');
            data = await cached.json();
          }
        }
      } catch (eCache) {}
      if (!data) {
        setMallasStatus('Descargando índice de mallas (primera vez puede tardar)…');
        var res = await fetch(URL_RUTAS_OPERATIVA + '?_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo descargar el índice de mallas.');
        data = await res.json();
        try {
          if (window.caches) {
            var c2 = await caches.open(MALLAS_CACHE);
            await c2.put(URL_RUTAS_OPERATIVA, new Response(JSON.stringify(data), {
              headers: { 'Content-Type': 'application/json' }
            }));
          }
        } catch (ePut) {}
      }
      if (!data || !data.r) throw new Error('Índice de mallas inválido.');
      rutasOperativa = data;
      var n = Object.keys(data.r).length;
      setMallasStatus('Mallas listas · ' + n.toLocaleString('es-ES') + ' trenes · ref. ' + (data.fecha || '—'));
      return data;
    })();
    try {
      return await rutasCargando;
    } finally {
      rutasCargando = null;
    }
  }

  function obtenerServiciosTren(num) {
    var key = limpiarNumTrenMalla(num);
    if (!key || !rutasOperativa || !rutasOperativa.r) return [];
    var list = rutasOperativa.r[key] || rutasOperativa.r[String(num)] || [];
    return Array.isArray(list) ? list.slice() : [];
  }

  function serviciosParaHoy(servicios) {
    var hoy = hoyYyyymmddMadrid();
    var deHoy = servicios.filter(function (s) {
      return Array.isArray(s.f) && s.f.indexOf(hoy) >= 0;
    });
    return deHoy.length ? deHoy : servicios.slice(0, 12);
  }

  function pintarDiasCirculacion(num, servicios) {
    var panel = document.getElementById('mallas-dias');
    if (!panel) return;
    if (!servicios.length) { panel.hidden = true; return; }
    var fechas = {};
    servicios.forEach(function (s) {
      (s.f || []).forEach(function (f) { fechas[f] = true; });
    });
    var nombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    var base = new Date();
    base.setHours(12, 0, 0, 0);
    var filas = [];
    for (var i = 0; i < 7; i++) {
      var fecha = new Date(base.getTime());
      fecha.setDate(base.getDate() + i);
      var y = fecha.getFullYear();
      var m = String(fecha.getMonth() + 1).padStart(2, '0');
      var d = String(fecha.getDate()).padStart(2, '0');
      var ymd = '' + y + m + d;
      var circula = !!fechas[ymd];
      filas.push(
        '<div class="mallas-dia ' + (circula ? 'si' : 'no') + '">' +
        '<span>' + (circula ? '✅' : '❌') + ' ' + nombres[fecha.getDay()] + ' ' + d + '/' + m + '</span>' +
        '<strong>' + (circula ? 'Circula' : 'No circula') + '</strong></div>'
      );
    }
    panel.innerHTML = '<strong>🚆 Tren ' + esc(limpiarNumTrenMalla(num)) + ' · próximos 7 días</strong>' + filas.join('');
    panel.hidden = false;
  }

  function renderResultadosMalla(num, servicios) {
    var box = document.getElementById('mallas-resultados');
    var lista = serviciosParaHoy(servicios).sort(function (a, b) {
      return String(a.so || '').localeCompare(String(b.so || ''));
    });
    pintarDiasCirculacion(num, servicios);
    if (!lista.length) {
      box.innerHTML = '<div class="empty">No hay servicios para este tren en la malla actual.</div>';
      return;
    }
    var hoy = hoyYyyymmddMadrid();
    var soloHoy = lista.filter(function (s) { return (s.f || []).indexOf(hoy) >= 0; });
    setMallasStatus(
      (soloHoy.length ? soloHoy.length + ' servicio' + (soloHoy.length === 1 ? '' : 's') + ' hoy' : lista.length + ' servicio(s) en malla') +
      ' · tren ' + limpiarNumTrenMalla(num)
    );
    box.innerHTML = lista.map(function (s, idx) {
      var esHoy = (s.f || []).indexOf(hoy) >= 0;
      return '<article class="malla-item" data-malla-idx="' + idx + '" data-trip="' + esc(s.t || '') + '" data-tren="' + esc(limpiarNumTrenMalla(num)) + '">' +
        '<div class="malla-item-head">' +
        '<div class="malla-hora">' + esc(formatHoraMalla(s.so)) + '</div>' +
        '<div class="malla-meta">' +
        '<div class="malla-prod">' + esc(s.p || s.a || 'Tren') +
        '<span class="malla-badge">Nº ' + esc(limpiarNumTrenMalla(num)) + '</span>' +
        (esHoy ? '' : '<span class="malla-badge">otros días</span>') +
        '</div>' +
        '<div class="malla-ruta">📍 ' + esc(s.o || 'Origen') + '<br>➔ ' + esc(s.d || 'Destino') +
        ' · llegada ' + esc(formatHoraMalla(s.sd)) +
        (s.l ? ' · ' + esc(s.l) : '') + '</div>' +
        '<div class="malla-hint">Toca para ver itinerario / marcha en vivo</div>' +
        '</div></div>' +
        '<div class="malla-item-body">' +
        '<div class="malla-detail"><span>Origen <b>' + esc(s.o || '—') + '</b></span><span>' + esc(formatHoraMalla(s.so)) + 'h</span></div>' +
        '<div class="malla-detail"><span>Destino <b>' + esc(s.d || '—') + '</b></span><span>' + esc(formatHoraMalla(s.sd)) + 'h</span></div>' +
        '<div class="marcha-panel">Consultando itinerario…</div>' +
        '</div></article>';
    }).join('');
  }

  async function buscarMallaTren() {
    var input = document.getElementById('mallas-input');
    var num = limpiarNumTrenMalla(input && input.value);
    var box = document.getElementById('mallas-resultados');
    if (!num) {
      toast('Introduce un número de tren', 'error');
      return;
    }
    box.innerHTML = '<div class="empty">Buscando…</div>';
    document.getElementById('mallas-dias').hidden = true;
    try {
      await asegurarRutasMallas();
      var servicios = obtenerServiciosTren(num);
      if (!servicios.length) {
        setMallasStatus('Tren ' + num + ' no encontrado en la malla.', true);
        box.innerHTML = '<div class="empty">❌ Tren no encontrado en la malla operativa.</div>';
        return;
      }
      renderResultadosMalla(num, servicios);
      marcarMallasCirculandoDesdeFlota_();
      precargarFlotaMapa();
    } catch (err) {
      setMallasStatus(String(err.message || err), true);
      box.innerHTML = '<div class="empty error-text">' + esc(err.message || err) + '</div>';
    }
  }

  function etiquetaChipCirculando_(pos, m) {
    var base = '🚆 CIRCULANDO';
    var r = NaN;
    if (m && typeof m.retrasoMin === 'number') r = Number(m.retrasoMin);
    else if (pos && pos.retrasoNum != null) r = Number(pos.retrasoNum);
    if (!(r > 0)) return base;
    return base + ' · +' + Math.round(r) + ' min';
  }

  async function consultarMarchaMalla_(tren, tripPreferido) {
    var region = regionMarchaActual_();
    var trip = String(tripPreferido || '').trim();
    var data = await call('marcha', {
      codTren: tren,
      tripId: trip,
      region: region
    });
    if (data && data.marcha && data.marcha.ok) return data.marcha;
    // Si el trip de malla no casa con GTFS-RT, reintenta solo por número.
    if (trip) {
      data = await call('marcha', { codTren: tren, tripId: '', region: region });
      if (data && data.marcha && data.marcha.ok) return data.marcha;
    }
    return (data && data.marcha) || null;
  }

  async function abrirDetalleMalla(item) {
    var abierto = item.classList.contains('open');
    document.querySelectorAll('.malla-item.open').forEach(function (el) {
      el.classList.remove('open');
    });
    if (abierto) return;
    item.classList.add('open');
    var panel = item.querySelector('.marcha-panel');
    if (!panel) return;
    var tren = item.getAttribute('data-tren') || '';
    var trip = item.getAttribute('data-trip') || '';
    var idx = indiceFlotaParaMallas_(flotaMapa);
    var pos = matchFlotaMalla_(trip, tren, idx);
    if (pos && pos.tripId) trip = String(pos.tripId);
    panel.innerHTML = '<div class="marcha-empty">Consultando marcha / itinerario en vivo…</div>';
    try {
      var m = await consultarMarchaMalla_(tren, trip);
      if (m && m.ok) {
        item.classList.add('live');
        asegurarChipCirculando_(item.querySelector('.malla-meta'), etiquetaChipCirculando_(pos, m));
        renderMarcha(panel, m);
      } else {
        panel.innerHTML =
          '<div class="marcha-empty">Sin posición en vivo ahora. Se muestra la ficha de malla (origen/destino/horas). El itinerario completo con paradas aparece cuando el tren circula en GTFS-RT.</div>';
      }
    } catch (err) {
      panel.innerHTML = '<div class="marcha-empty error-text">' + esc(err.message || err) + '</div>';
    }
  }

  async function cargarMarchaVivoEnTarjetaMalla_(card) {
    if (!card || card.getAttribute('data-marcha-live') === '1') return;
    var slot = card.querySelector('.marcha-panel-live');
    if (!slot) return;
    var tren = limpiarNumTrenMalla(card.getAttribute('data-num') || '');
    var trip = card.getAttribute('data-tid') || '';
    var idx = indiceFlotaParaMallas_(flotaMapa);
    var pos = matchFlotaMalla_(trip, tren, idx);
    if (pos && pos.tripId) trip = String(pos.tripId);
    if (!tren && !trip) return;
    card.setAttribute('data-marcha-live', 'loading');
    slot.hidden = false;
    slot.innerHTML = '<div class="marcha-empty">Consultando marcha en vivo…</div>';
    var labelEst = card.querySelector('.marcha-label--estatica');
    try {
      var m = await consultarMarchaMalla_(tren, trip);
      if (m && m.ok) {
        card.classList.add('live');
        card.setAttribute('data-marcha-live', '1');
        asegurarChipCirculando_(card.querySelector('.trip-info'), etiquetaChipCirculando_(pos, m));
        renderMarcha(slot, m);
        if (labelEst) labelEst.textContent = 'Marcha programada (malla)';
      } else {
        card.removeAttribute('data-marcha-live');
        slot.innerHTML = '<div class="marcha-empty">Sin marcha en vivo ahora. Se muestra la operativa diaria.</div>';
      }
    } catch (err) {
      card.removeAttribute('data-marcha-live');
      slot.innerHTML = '<div class="marcha-empty error-text">' + esc(err.message || err) + '</div>';
    }
  }

  var vigilanteActivo = false;
  var intervaloVigilante = null;
  var timerVigilanteAutoOn_ = null;
  var VIGILANTE_AUTO_ON_DELAY_MS_ = 60000;
  var trenesYaAlertados = {};
  var trenesPendientesConfirmacion = [];
  var trenesPendientesDetencion = [];
  var chequeoEnCurso = false;

  function cancelarVigilanteAutoOn_() {
    if (timerVigilanteAutoOn_) {
      clearTimeout(timerVigilanteAutoOn_);
      timerVigilanteAutoOn_ = null;
    }
  }

  function programarVigilanteAutoOn_() {
    cancelarVigilanteAutoOn_();
    if (!puedeEscribir || vigilanteActivo) return;
    timerVigilanteAutoOn_ = setTimeout(function () {
      timerVigilanteAutoOn_ = null;
      // Solo si el usuario no lo ha tocado a mano.
      if (!puedeEscribir || vigilanteActivo) return;
      setVigilanteState(true, true);
    }, VIGILANTE_AUTO_ON_DELAY_MS_);
  }

  function setVigilanteUI(on) {
    vigilanteActivo = !!on;
    var btn = document.getElementById('btn-vigilante');
    var txt = document.getElementById('txt-vigilante');
    var led = document.getElementById('led-vigilante');
    if (!btn || !txt) return;
    btn.classList.toggle('on', vigilanteActivo);
    btn.setAttribute('aria-pressed', vigilanteActivo ? 'true' : 'false');
    txt.textContent = vigilanteActivo ? 'VIGILANTE: ON' : 'VIGILANTE: OFF';
    if (led) {
      led.style.background = vigilanteActivo ? '#00ffcc' : '#ff3b30';
      led.style.boxShadow = vigilanteActivo ? '0 0 10px #00ffcc' : '0 0 10px #ff3b30';
    }
  }

  function setVigilanteState(activar, silentOff) {
    setVigilanteUI(activar);
    if (activar) {
      if (!intervaloVigilante) {
        intervaloVigilante = setInterval(ejecutarChequeoTrenes, 120000);
      }
      ejecutarChequeoTrenes();
    } else {
      if (intervaloVigilante) {
        clearInterval(intervaloVigilante);
        intervaloVigilante = null;
      }
      if (!silentOff) toast('Vigilante desactivado', 'error');
    }
  }

  function toggleVigilante() {
    if (!exigirEscritura_('El Vigilante')) return;
    cancelarVigilanteAutoOn_();
    setVigilanteState(!vigilanteActivo);
  }

  function parpadearLedVigilante() {
    var led = document.getElementById('led-vigilante');
    if (!led) return;
    var original = led.style.background || '#00ffcc';
    led.style.background = '#ffffff';
    led.style.boxShadow = '0 0 20px #ffffff';
    setTimeout(function () {
      if (!vigilanteActivo) return;
      led.style.background = original;
      led.style.boxShadow = '0 0 10px ' + original;
    }, 1000);
  }

  function claveCritico(c) {
    var cat = (c && c.categoria) ? String(c.categoria) : 'retraso';
    var id = String((c && (c.codTren || c.linea || c.mensaje)) || '');
    return cat + '|' + id;
  }

  /** Si el mapa está en fullscreen nativo, el modal debe vivir dentro de #screen-mapa. */
  function montarModalVigilante_(modal) {
    if (!modal) return;
    var scr = document.getElementById('screen-mapa');
    var fs = typeof mapaFullscreenEl_ === 'function' ? mapaFullscreenEl_() : (document.fullscreenElement || null);
    var host = document.getElementById('vig-modals-host') || document.body;
    if (scr && fs === scr) {
      if (modal.parentElement !== scr) scr.appendChild(modal);
      return;
    }
    if (modal.parentElement !== host) host.appendChild(modal);
  }

  function mostrarModalRetrasos(items) {
    var lista = document.getElementById('lista-retrasos-graves');
    var modal = document.getElementById('modal-retraso-grave');
    if (!lista || !modal) return;
    trenesPendientesConfirmacion = [];
    lista.innerHTML = items.map(function (c) {
      trenesPendientesConfirmacion.push(claveCritico(c));
      var etiqueta = c.etiquetaModal != null && c.etiquetaModal !== ''
        ? plainText(c.etiquetaModal)
        : ('+' + Number(c.retrasoNum || 0) + ' min');
      var lineaTxt = plainText(c.linea || c.codTren || 'Tren');
      return '<div class="vig-item vig-item--red">' +
        '<div class="vig-item-linea">' + esc(lineaTxt) + '</div>' +
        '<div class="vig-item-tag">' + esc(etiqueta) + '</div>' +
        '<div class="vig-item-msg">' + esc(plainText(c.mensaje)) + '</div>' +
        '</div>';
    }).join('');
    montarModalVigilante_(modal);
    modal.hidden = false;
  }

  // Modal ámbar «Tren detenido»: OFF hasta que el detector funcione al 100%.
  // El modal rojo de críticos (retraso grave) sigue activo.
  // Modal ámbar «Sin salida» (malla − vivo): activo.
  var VIGILANTE_UI_MOSTRAR_MODAL_DETENIDOS_ = false;

  function pintarModalAmbarVigilante_(items, titulo, lead) {
    var lista = document.getElementById('lista-detenciones');
    var modal = document.getElementById('modal-detencion-grave');
    if (!lista || !modal) return;
    var h2 = modal.querySelector('h2');
    var p = modal.querySelector('.vig-modal-card > p');
    if (h2) h2.textContent = titulo || 'Aviso';
    if (p) p.textContent = lead || '';
    trenesPendientesDetencion = [];
    lista.innerHTML = items.map(function (c) {
      trenesPendientesDetencion.push(claveCritico(c));
      var etiqueta = c.etiquetaModal != null && c.etiquetaModal !== ''
        ? plainText(c.etiquetaModal)
        : 'Aviso';
      var lineaTxt = plainText(c.linea || c.codTren || 'Tren');
      var lugar = c.lugar
        ? ('<div class="vig-item-lugar">📍 ' + esc(plainText(c.lugar)) +
          (c.horaDesde ? (' · salida teórica <b>' + esc(plainText(c.horaDesde)) + '</b>h') : '') +
          '</div>')
        : '';
      return '<div class="vig-item vig-item--amber">' +
        '<div class="vig-item-linea">' + esc(lineaTxt) + '</div>' +
        '<div class="vig-item-tag">' + esc(etiqueta) + '</div>' +
        lugar +
        '<div class="vig-item-msg">' + esc(plainText(c.mensaje)) + '</div>' +
        '</div>';
    }).join('');
    montarModalVigilante_(modal);
    modal.hidden = false;
  }

  function mostrarModalDetenciones(items) {
    if (!VIGILANTE_UI_MOSTRAR_MODAL_DETENIDOS_) return;
    pintarModalAmbarVigilante_(
      items,
      'Tren detenido',
      'Un tren lleva más de 10 minutos parado en vía o estación.'
    );
  }

  function mostrarModalSinSalida(items) {
    if (!items || !items.length) return;
    pintarModalAmbarVigilante_(
      items,
      'Tren sin salida',
      'Debería haber salido según malla y aún no hay señal viva (GTFS/flota).'
    );
  }

  function procesarCriticos(criticos) {
    if (!Array.isArray(criticos) || !criticos.length) return 0;
    var nuevos = criticos.filter(function (c) {
      return !trenesYaAlertados[claveCritico(c)];
    });
    if (!nuevos.length) return criticos.length;
    // Modal rojo: críticos por demora grave (≥25). Sin detenidos / sin_salida.
    var graves = nuevos.filter(function (c) {
      if (c && c.categoria === 'detencion') return false;
      if (c && c.categoria === 'sin_salida') return false;
      return Number(c.retrasoNum || 0) >= 25;
    });
    if (graves.length) mostrarModalRetrasos(graves);
    // Sin salida: solo Telegram pruebas (no modal / no lista Radar).
    // Modal ámbar «Tren detenido»: silenciado (flag arriba).
    if (VIGILANTE_UI_MOSTRAR_MODAL_DETENIDOS_) {
      var detenidos = nuevos.filter(function (c) {
        if (c && c.categoria === 'detencion') return true;
        if (c && c.categoria === 'sin_salida') return false;
        if (c && c.categoria === 'retraso') {
          return Number(c.retrasoNum || 0) < 25;
        }
        var et = String((c && c.etiquetaModal) || '');
        if (/^Parado\b/i.test(et) || /·\s*parado\b/i.test(et)) return true;
        return Number(c.retrasoNum || 0) < 25;
      });
      if (detenidos.length) mostrarModalDetenciones(detenidos);
    }
    return criticos.length;
  }

  function resumenUmbralRadar() {
    var altas = 0;
    var avisos = 0;
    radar.forEach(function (a) {
      if (!a || /LIMPIA|ERROR/i.test(String(a.tipo || ''))) return;
      // Sin salida no cuenta en Radar (Telegram pruebas).
      if (a.categoria === 'sin_salida' || /SIN SALIDA/i.test(String(a.tipo || ''))) return;
      var r = Number(a.retrasoNum || 0);
      var productoAlta = /^(AVE|AVE Int\.|Avlo|Alvia|Avant|Avant Exp\.|Intercity)$/i.test(String(a.producto || ''));
      var umbral = productoAlta ? 15 : 25;
      if (r >= umbral) altas++;
      else if (r > 0) avisos++;
    });
    return { altas: altas, avisos: avisos };
  }

  async function ejecutarChequeoTrenes() {
    if (!vigilanteActivo || chequeoEnCurso) return;
    chequeoEnCurso = true;
    parpadearLedVigilante();
    toast('Vigilante CGO escaneando red…', 'success');
    try {
      var regiones = obtenerRegionesRadar();
      var data = await call('vigilante_chequeo', {
        region: regiones.join('+'),
        regiones: regiones
      });
      if (!vigilanteActivo) return;
      var criticos = (data && data.criticos) || [];
      var n = procesarCriticos(criticos);
      var umbral = resumenUmbralRadar();
      var etiqueta = regiones.join('+');
      if (n > 0) {
        toast('Vigilante: ' + n + ' crítico' + (n === 1 ? '' : 's') + ' en ' + etiqueta, 'error');
      } else if (umbral.altas > 0) {
        toast('Conectado: 0 críticos nuevos (Radar ve ' + umbral.altas + ' ≥ umbral; pueden estar ya avisados o sin ruta GPS)', 'success');
      } else {
        toast('Conectado: sin críticos ahora (umbral AVE/Alvia ≥15 min, resto ≥25)', 'success');
      }
      console.info('[Vigilante]', {
        region: etiqueta,
        regiones: regiones,
        criticos: criticos.length,
        muestra: criticos.slice(0, 3),
        radarAltas: umbral.altas,
        radarAvisos: umbral.avisos
      });
    } catch (err) {
      if (vigilanteActivo) toast('Vigilante error: ' + String(err.message || err), 'error');
      console.warn('[Vigilante] fallo', err);
    } finally {
      chequeoEnCurso = false;
    }
  }

  async function arrancarVigilanteDesdeCuadrante() {
    try {
      var res = await call('vigilante_cuadrante');
      if (res && res.activar) {
        // Nunca encender al instante: mismos 60 s que al entrar en Radar.
        programarVigilanteAutoOn_();
      } else if (res && res.motivo) {
        console.warn('[Vigilante cuadrante] no auto-ON:', res.motivo, res.turno || '');
      }
    } catch (err) {
      console.warn('[Vigilante cuadrante]', err);
    }
  }

  function confirmarRetrasos() {
    trenesPendientesConfirmacion.forEach(function (k) { trenesYaAlertados[k] = true; });
    trenesPendientesConfirmacion = [];
    cerrarModalVigilante_('modal-retraso-grave');
  }
  function posponerRetrasos() {
    trenesPendientesConfirmacion = [];
    cerrarModalVigilante_('modal-retraso-grave');
  }
  function confirmarDetenciones() {
    trenesPendientesDetencion.forEach(function (k) { trenesYaAlertados[k] = true; });
    trenesPendientesDetencion = [];
    cerrarModalVigilante_('modal-detencion-grave');
  }
  function posponerDetenciones() {
    trenesPendientesDetencion = [];
    cerrarModalVigilante_('modal-detencion-grave');
  }

  function cerrarModalVigilante_(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    var host = document.getElementById('vig-modals-host') || document.body;
    if (modal.parentElement !== host) host.appendChild(modal);
  }

  // ========== GENERAR AVISO ==========
  function claveFirmaAviso() {
    return sessionEmail ? ('TURNIO_PREFIJO_AVISO_' + sessionEmail) : 'TURNIO_PREFIJO_AVISO_sin_email';
  }
  function obtenerFirmaAviso() {
    try {
      var v = localStorage.getItem(claveFirmaAviso());
      if (v && String(v).trim()) return String(v).trim();
    } catch (e) {}
    return PREFIJO_AVISO_DEFAULT;
  }
  function guardarFirmaAviso(texto) {
    var t = String(texto || '').trim();
    if (!t) return false;
    try { localStorage.setItem(claveFirmaAviso(), t); return true; } catch (e) { return false; }
  }
  function sincronizarFirmaModal() {
    var inp = document.getElementById('cg-prefijo');
    if (inp) inp.value = obtenerFirmaAviso();
  }
  function normalizarHHMMAviso(s) {
    var m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return String(s || '');
    var hh = parseInt(m[1], 10);
    return (hh < 10 ? '0' : '') + hh + ':' + m[2];
  }
  function extraerHorasRuta(texto) {
    var parts = String(texto || '').split(/\s*(?:➞|→|->|➔|➜)\s*/);
    if (parts.length < 2) return { hO: '', hD: '' };
    var m0 = parts[0].match(/\((\d{1,2}:\d{2})\)/);
    var m1 = parts[1].match(/\((\d{1,2}:\d{2})\)/);
    return { hO: m0 ? m0[1] : '', hD: m1 ? m1[1] : '' };
  }
  function tipoPorNumeroTren(trenNum) {
    var n = parseInt(trenNum, 10);
    if (isNaN(n)) return 'TREN';
    if (n >= 2000 && n <= 3999) return 'AVE';
    if (n >= 4000 && n <= 5999) return 'AVE';
    if (n >= 6000 && n <= 7999) return 'Alvia';
    if (n >= 8000 && n <= 9999) return 'Avant';
    if (n >= 100 && n <= 999) return 'IR';
    if (n >= 1000 && n <= 1999) return 'AC';
    if (n >= 12000 && n <= 18999) return 'MD';
    if (n >= 19500 && n <= 29999) return 'Cercanías';
    if (n >= 30500 && n <= 30999) return 'MD';
    if (n >= 31000 && n <= 32999) return 'Cercanías';
    if (n < 100 || (n >= 10000 && n < 12000) || (n >= 30000 && n < 30500)) return 'LD';
    return 'TREN';
  }
  /** Etiqueta de producto del aviso = la de la tarjeta Radar cuando exista. */
  function etiquetaProductoAviso_(productoOTipo) {
    var p = String(productoOTipo || '').trim();
    if (!p) return '';
    if (/^cerc(\.|an[ií]as)?\b/i.test(p) || /^cc$/i.test(p)) return 'Cercanías';
    if (/^alvia$/i.test(p)) return 'Alvia';
    if (/^avant(\s+exp\.?)?$/i.test(p)) return /^avant\s+exp/i.test(p) ? 'Avant Exp.' : 'Avant';
    if (/^avlo$/i.test(p)) return 'Avlo';
    if (/^intercity$/i.test(p)) return 'Intercity';
    if (/^ave(\s+tgv)?$/i.test(p)) return /^ave\s+tgv/i.test(p) ? 'AVE TGV' : 'AVE';
    if (/^ave\s*int/i.test(p)) return 'AVE Int.';
    if (/^euromed$/i.test(p)) return 'Euromed';
    if (/^av\s*city$/i.test(p)) return 'AV City';
    if (/^md$/i.test(p)) return 'MD';
    if (/^ld$/i.test(p)) return 'LD';
    if (/^ir$/i.test(p)) return 'IR';
    if (/^ac$/i.test(p)) return 'AC';
    if (/^trd$/i.test(p)) return 'TRD';
    if (/^talgo$/i.test(p)) return 'Talgo';
    if (/^altaria$/i.test(p)) return 'Altaria';
    if (/^diurno$/i.test(p)) return 'Diurno';
    if (/^estrella$/i.test(p)) return 'Estrella';
    if (/^tren\s*hotel$/i.test(p)) return 'Tren Hotel';
    if (/^regional(\s+exp\.?)?$/i.test(p)) {
      return /^regional\s+exp/i.test(p) ? 'Regional Exp.' : 'Regional';
    }
    if (/^andaluc/i.test(p)) return 'Andalucía Exp.';
    if (/^catalunya/i.test(p)) return 'Catalunya Exp.';
    return p;
  }
  function productoDesdeAlertaRadar_(alerta) {
    var desdeProducto = etiquetaProductoAviso_(alerta && alerta.producto);
    if (desdeProducto) return desdeProducto;
    var linea = plainText((alerta && alerta.linea) || '');
    var m = linea.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .]+?)\s+(\d{2,6})\b/);
    if (m && m[1] && !/^circ/i.test(m[1])) {
      var desdeLinea = etiquetaProductoAviso_(m[1].trim());
      if (desdeLinea) return desdeLinea;
    }
    return etiquetaProductoAviso_(tipoPorNumeroTren((alerta && alerta.codTren) || '')) || 'TREN';
  }
  function titularTexto(s) {
    // Misma regla que Worker: no usar \w (rompe tildes → MáLaga).
    return String(s || '').replace(/[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/g, function (w) {
      var lower = w.toLocaleLowerCase('es-ES');
      return lower.charAt(0).toLocaleUpperCase('es-ES') + lower.slice(1);
    });
  }
  function abrirModalAviso() {
    if (!exigirEscritura_('Generar avisos')) return;
    // Firma: oculta por ahora (se configurará desde Ajustes).
    document.getElementById('modal-aviso-cg').hidden = false;
    setTimeout(function () {
      var b = document.getElementById('cg-buscador');
      if (b) b.focus();
    }, 250);
  }
  function cerrarModalAviso() {
    document.getElementById('modal-aviso-cg').hidden = true;
    document.getElementById('cg-resultados').hidden = true;
  }
  function construirMensajeAviso(opts) {
    var tipo = opts.tipo || 'TREN';
    var tren = opts.tren || 'S/N';
    var origen = titularTexto(opts.origen || 'ORIGEN') || 'ORIGEN';
    var destino = titularTexto(opts.destino || 'DESTINO') || 'DESTINO';
    var hO = opts.hO || '[HH:MM]';
    var hD = opts.hD || '[HH:MM]';
    var matPart = opts.matPart || '';
    var situacion = opts.situacion || 'Circula con demora. [INCIDENCIA_AQUI].';
    var cuerpo = tipo + ' ' + tren + ' ' + origen + ' ' + hO + 'h - ' + destino + ' ' + hD + 'h' + matPart +
      ' (   v.) ' + situacion;
    if (cuerpo.indexOf('[INCIDENCIA_AQUI]') < 0) cuerpo += ' [INCIDENCIA_AQUI].';
    // Sin firma por defecto (futuro: Ajustes).
    return cuerpo;
  }
  function situacionDesdeAlerta(alerta) {
    var demora = Number(alerta.retrasoNum || 0);
    var mensajeRadar = String(alerta.mensaje || '');
    var matchTramo = mensajeRadar.match(/Circulando entre\s+(.+?)\s+y\s+(.+?)\.\s*Próxima parada prevista:\s+(.+?)(?:\s+a las\s+([^\.]+))?\./i);
    var matchEnRuta = mensajeRadar.match(/En ruta hacia\s+(.+?)\.\s*Próxima parada prevista:\s+(.+?)\s+a las\s+([^\.]+)h\./i);
    if (matchTramo) {
      return 'Circula con ' + demora + ' minutos de demora entre ' +
        titularTexto(matchTramo[1].trim()) + ' y ' + titularTexto(matchTramo[2].trim()) +
        '. Próxima parada prevista: ' + titularTexto(matchTramo[3].trim()) +
        (matchTramo[4] ? ' a las ' + matchTramo[4].trim() : '') + '. [INCIDENCIA_AQUI].';
    }
    if (matchEnRuta) {
      return 'Circula con ' + demora + ' minutos de demora. En ruta hacia ' +
        titularTexto(matchEnRuta[1].trim()) +
        '. Llegada prevista a ' + titularTexto(matchEnRuta[2].trim()) + ': ' +
        matchEnRuta[3].trim() + 'h. [INCIDENCIA_AQUI].';
    }
    return 'Circula con ' + demora + ' minutos de demora. Ubicación operativa pendiente de confirmar. [INCIDENCIA_AQUI].';
  }
  function parseIdentidadAlerta(alerta) {
    var textoLinea = plainText(alerta.linea || '');
    var hO = alerta.hOrig ? String(alerta.hOrig) : '';
    var hD = alerta.hDest ? String(alerta.hDest) : '';
    if (!hO || !hD) {
      var rx = extraerHorasRuta(textoLinea);
      if (!hO && rx.hO) hO = normalizarHHMMAviso(rx.hO);
      if (!hD && rx.hD) hD = normalizarHHMMAviso(rx.hD);
    }
    var trenNum = String(alerta.codTren || '').replace(/[^0-9]/g, '') || 'S/N';
    var matchTren = textoLinea.match(/Circ\.?\s*([a-zA-Z0-9]+)/i);
    if (matchTren) trenNum = matchTren[1];
    var origen = String(alerta.nombreOrig || '').trim() || 'ORIGEN';
    var destino = String(alerta.nombreDest || '').trim() || 'DESTINO';
    var trozoRuta = textoLinea;
    var partesPipe = textoLinea.split('|');
    if (partesPipe.length > 1) trozoRuta = partesPipe.slice(1).join('|');
    else {
      var mPunto = textoLinea.match(/·\s*(.+)$/);
      if (mPunto) trozoRuta = mPunto[1];
    }
    var ruta = String(trozoRuta || '').split(/\s*(?:➞|→|->|➔|➜)\s*/);
    if (ruta.length === 2) {
      var oR = ruta[0].replace(/\(.*?\)/g, '').trim();
      var dR = ruta[1].replace(/\(.*?\)/g, '').trim();
      if (oR && (origen === 'ORIGEN' || !origen)) origen = oR;
      if (dR && (destino === 'DESTINO' || !destino)) destino = dR;
    }
    var matTexto = (alerta.matLabel && alerta.matLabel !== '')
      ? alerta.matLabel
      : (alerta.mat && alerta.mat !== '' ? alerta.mat : '');
    return {
      tipo: productoDesdeAlertaRadar_(alerta),
      tren: trenNum,
      origen: origen,
      destino: destino,
      hO: hO || '[HH:MM]',
      hD: hD || '[HH:MM]',
      matPart: matTexto ? (' (' + matTexto + ')') : '',
      demora: Number(alerta.retrasoNum || 0),
      tripId: String(alerta.tripId || alerta.trip_id || ''),
      mensajeRadar: String(alerta.mensaje || '')
    };
  }
  function enriquecerAvisoConContexto(id) {
    call('contexto_aviso', {
      numTren: id.tren,
      origen: id.origen,
      destino: id.destino,
      horaOrigen: id.hO,
      horaDestino: id.hD,
      retrasoMin: id.demora,
      mensajeRadar: id.mensajeRadar,
      tripId: id.tripId
    }).then(function (contexto) {
      if (!contexto || contexto.ok === false) return;
      var demora = Number.isFinite(Number(contexto.demoraMin)) ? Number(contexto.demoraMin) : id.demora;
      var situacion = 'Circula con ' + demora + ' minutos de demora.';
      var ubicacion = titularTexto(String(contexto.ubicacion || '').trim());
      if (ubicacion) situacion += ' ' + ubicacion + '.';
      var proxima = contexto.proxima || null;
      if (proxima && proxima.nombre) {
        situacion += ' Próxima parada: ' + titularTexto(proxima.nombre) +
          (proxima.hora ? ' (' + proxima.hora + 'h).' : '.');
      }
      if (contexto.llegadaDestino) {
        var okLlegada = true;
        if (proxima && proxima.hora) {
          var mL = String(contexto.llegadaDestino).match(/^(\d{1,2}):(\d{2})$/);
          var mP = String(proxima.hora).match(/^(\d{1,2}):(\d{2})$/);
          if (mL && mP) {
            var minL = Number(mL[1]) * 60 + Number(mL[2]);
            var minP = Number(mP[1]) * 60 + Number(mP[2]);
            if (minL < minP && (minP - minL) < 12 * 60) okLlegada = false;
          }
        }
        if (okLlegada) {
          situacion += ' Llegada prevista a ' + titularTexto(id.destino) + ': ' + contexto.llegadaDestino + 'h.';
        }
      }
      situacion += ' [INCIDENCIA_AQUI].';
      document.getElementById('cg-mensaje').value = construirMensajeAviso({
        tipo: id.tipo, tren: id.tren, origen: id.origen, destino: id.destino,
        hO: id.hO, hD: id.hD, matPart: id.matPart, situacion: situacion
      });
    }).catch(function () {});
  }
  async function completarIdentidadAviso_(id) {
    var faltaHora = !id.hO || id.hO === '[HH:MM]' || !id.hD || id.hD === '[HH:MM]';
    var faltaOd = !id.origen || id.origen === 'ORIGEN' || !id.destino || id.destino === 'DESTINO';
    if (!faltaHora && !faltaOd) return id;
    try {
      var data = await call('tren_manual', { codTren: String(id.tren || '').replace(/^0+/, '') });
      if (data && data.encontrado && data.datos) {
        var d = data.datos;
        if ((!id.origen || id.origen === 'ORIGEN') && d.origen) id.origen = d.origen;
        if ((!id.destino || id.destino === 'DESTINO') && d.destino) id.destino = d.destino;
        if ((!id.hO || id.hO === '[HH:MM]') && d.hOrig && d.hOrig !== 'S/H') {
          id.hO = normalizarHHMMAviso(d.hOrig);
        }
        if ((!id.hD || id.hD === '[HH:MM]') && d.hDest && d.hDest !== 'S/H') {
          id.hD = normalizarHHMMAviso(d.hDest);
        }
        // No pisar el producto de la tarjeta Radar (p. ej. Intercity ≠ AVE por nº).
        if ((!id.tipo || id.tipo === 'TREN') && d.tipo) {
          id.tipo = etiquetaProductoAviso_(d.tipo) || d.tipo;
        }
      }
    } catch (_) { /* best-effort */ }
    return id;
  }
  async function abrirAvisoDesdeAlerta(alerta) {
    if (!exigirEscritura_('Generar avisos')) return;
    if (!alerta) { toast('No hay datos de la alerta.'); return; }
    if (!cacheClavero.length) cargarClavero();
    var id = parseIdentidadAlerta(alerta);
    document.getElementById('cg-mensaje').value = construirMensajeAviso({
      tipo: id.tipo, tren: id.tren, origen: id.origen, destino: id.destino,
      hO: id.hO, hD: id.hD, matPart: id.matPart, situacion: situacionDesdeAlerta(alerta)
    });
    document.getElementById('cg-buscador').value = '';
    document.getElementById('cg-resultados').hidden = true;
    abrirModalAviso();
    id = await completarIdentidadAviso_(id);
    document.getElementById('cg-mensaje').value = construirMensajeAviso({
      tipo: id.tipo, tren: id.tren, origen: id.origen, destino: id.destino,
      hO: id.hO, hD: id.hD, matPart: id.matPart, situacion: situacionDesdeAlerta(alerta)
    });
    enriquecerAvisoConContexto(id);
  }
  function encontrarAlertaAviso(tren, trip) {
    var t = String(tren || '').replace(/[^0-9]/g, '');
    var tp = String(trip || '');
    var lista = filtered();
    for (var i = 0; i < lista.length; i++) {
      var a = lista[i];
      var cod = String(a.codTren || '').replace(/[^0-9]/g, '');
      var tripA = String(a.tripId || a.trip_id || '');
      if (cod === t && (!tp || !tripA || tripA === tp)) return a;
    }
    for (var j = 0; j < radar.length; j++) {
      if (String(radar[j].codTren || '').replace(/[^0-9]/g, '') === t) return radar[j];
    }
    return null;
  }
  async function cargarClavero() {
    if (cargandoClavero) return;
    cargandoClavero = true;
    try {
      var data = await call('clavero');
      cacheClavero = Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      console.warn('[Clavero]', err);
      cacheClavero = [];
    } finally {
      cargandoClavero = false;
    }
  }
  function buscarIncidenciaRapida() {
    var input = document.getElementById('cg-buscador');
    var caja = document.getElementById('cg-resultados');
    if (!input || !caja) return;
    var q = input.value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (q.length < 2) { caja.hidden = true; return; }
    if (!cacheClavero.length) {
      caja.innerHTML = '<div class="empty" style="padding:12px;font-size:13px;font-weight:700;">Sincronizando diccionario…</div>';
      caja.hidden = false;
      cargarClavero().then(buscarIncidenciaRapida);
      return;
    }
    var encontrados = cacheClavero.filter(function (item) {
      var texto = [item.n1, item.n2, item.n3, item.def].join(' ').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return texto.indexOf(q) >= 0;
    }).slice(0, 15);
    if (!encontrados.length) {
      caja.innerHTML = '<div class="empty" style="padding:12px;font-size:13px;font-weight:700;color:var(--red);">Ninguna coincidencia.</div>';
      caja.hidden = false;
      return;
    }
    caja.innerHTML = encontrados.map(function (item) {
      var titulo = [item.n1, item.n2, item.n3].filter(Boolean).map(titularTexto).join(' · ');
      var def = item.def ? titularTexto(item.def) : '';
      return '<button type="button" class="aviso-hit" data-incidencia="' + esc(titulo) + '">' +
        '<b>' + esc(titulo) + '</b><span>' + esc(def) + '</span></button>';
    }).join('');
    caja.hidden = false;
  }
  function insertarIncidencia(titulo) {
    var ta = document.getElementById('cg-mensaje');
    if (!ta || !titulo) return;
    if (ta.value.indexOf('[INCIDENCIA_AQUI]') >= 0) {
      ta.value = ta.value.replace('[INCIDENCIA_AQUI]', titulo);
    } else {
      ta.value = ta.value.replace(/\.?\s*$/, '') + ' / ' + titulo + '.';
    }
    document.getElementById('cg-resultados').hidden = true;
    document.getElementById('cg-buscador').value = '';
    document.getElementById('cg-buscador').focus();
  }
  function copiarAviso() {
    if (!exigirEscritura_('Copiar avisos')) return;
    var texto = document.getElementById('cg-mensaje').value;
    if (!texto.trim()) { toast('No hay aviso que copiar.', 'error'); return; }
    function ok() {
      cerrarModalAviso();
      lanzarExitoAnimado('¡Aviso copiado!');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(ok).catch(function () {
        fallbackCopiar(texto); ok();
      });
    } else {
      fallbackCopiar(texto); ok();
    }
  }
  function fallbackCopiar(texto) {
    var ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  function abrirAvisoManual() {
    if (!exigirEscritura_('Generar avisos')) return;
    document.getElementById('input-tren-manual').value = '';
    document.getElementById('modal-aviso-manual').hidden = false;
    setTimeout(function () {
      document.getElementById('input-tren-manual').focus();
    }, 200);
  }
  function cerrarAvisoManual() {
    document.getElementById('modal-aviso-manual').hidden = true;
  }
  async function ejecutarBusquedaManual() {
    if (!exigirEscritura_('Generar avisos')) return;
    var input = document.getElementById('input-tren-manual');
    var btn = document.getElementById('btn-buscar-tren-manual');
    var num = String(input.value || '').trim().replace(/^0+/, '');
    if (!/^\d{1,12}$/.test(num)) { toast('Introduce un número de tren válido'); return; }
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    if (!cacheClavero.length) cargarClavero();
    try {
      var data = await call('tren_manual', { codTren: num });
      cerrarAvisoManual();
      if (!data.encontrado || !data.datos) {
        toast('El tren no existe en tus Excel');
        return;
      }
      var d = data.datos;
      document.getElementById('cg-mensaje').value = construirMensajeAviso({
        tipo: etiquetaProductoAviso_(d.tipo) || tipoPorNumeroTren(d.tren || num),
        tren: d.tren || num,
        origen: d.origen || 'ORIGEN',
        destino: d.destino || 'DESTINO',
        hO: d.hOrig || '[HH:MM]',
        hD: d.hDest || '[HH:MM]',
        situacion: 'Circula con XX minutos de demora a su paso por XX por [INCIDENCIA_AQUI].'
      });
      document.getElementById('cg-buscador').value = '';
      document.getElementById('cg-resultados').hidden = true;
      abrirModalAviso();
    } catch (err) {
      toast(String(err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar';
    }
  }
  function typeOf(a) {
    if (a && (a.categoria === 'sin_salida' || /SIN SALIDA/i.test(String(a.tipo || '')))) {
      return 'warning';
    }
    var x = String(a.tipo || '');
    return x.indexOf('ALERTA') >= 0 ? 'grave' : x.indexOf('AVISO') >= 0 ? 'warning' : '';
  }
  function filtered() {
    var q = String(document.getElementById('search').value || '').toLowerCase();
    return radar.filter(function (a) {
      return !q || JSON.stringify(a).toLowerCase().indexOf(q) >= 0;
    });
  }

  var pendingRadarFocusCod_ = '';

  function rutaCortaRadarHome_(a) {
    var t = plainText((a && (a.linea || a.mensaje)) || '').replace(/^[\s▪·•■▫]+/, '').trim();
    var m = t.match(/(.+?)\s*(?:→|->|➔|➜|➔)\s*(.+)/);
    if (m) {
      return (m[1].replace(/\s+/g, ' ').trim() + ' → ' + m[2].replace(/\s+/g, ' ').trim()).substring(0, 90);
    }
    return t.substring(0, 90);
  }

  function retrasos15Home_() {
    var out = [];
    (radar || []).forEach(function (a) {
      if (!a) return;
      var tipo = String(a.tipo || '');
      if (/LIMPIA|ERROR|ACTUALIZ/i.test(tipo)) return;
      // Sin salida también en Inicio si ya supera 15 min desde la teórica.
      var r = Number(a.retrasoNum || 0);
      if (!(r >= 15)) return;
      var tren = String(a.codTren || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
      if (!tren) return;
      out.push({
        tren: tren,
        retraso: r,
        ruta: rutaCortaRadarHome_(a),
        trip: String(a.tripId || a.trip_id || '')
      });
    });
    out.sort(function (a, b) { return b.retraso - a.retraso; });
    return out.slice(0, 10);
  }

  function pintarHomeRetrasos15_() {
    var home = document.getElementById('home-radar');
    var title = document.getElementById('home-radar-title');
    var ambito = etiquetaAmbitoRadarHome_();
    var total = radar[0] && Number(radar[0].totalActivos);
    var incid = radar[0] && Number(radar[0].totalIncidencias);
    var limpia = !radar.length || (radar.length === 1 && /LIMPIA/i.test(String(radar[0].tipo || '')));
    if (title) {
      title.innerHTML = '&#128225; Retrasos e incidencias &middot; ' + esc(ambito);
    }
    if (!home) return;

    var resumenHtml;
    if (limpia) {
      var msgLimpia = (radar[0] && radar[0].mensaje) || 'Red operando con normalidad.';
      resumenHtml = esc(msgLimpia) +
        ' <span class="home-radar-ambito">&middot; Datos de <strong>' + esc(ambito) + '</strong></span>';
    } else {
      var nTrenes = isFinite(total) ? total : radar.length;
      var nIncid = isFinite(incid) ? incid : radar.length;
      resumenHtml = '<b>' + esc(String(nTrenes)) + ' trenes analizados</b> &middot; ' +
        esc(String(nIncid)) + ' incidencia' + (Number(nIncid) === 1 ? '' : 's') +
        ' en <strong>' + esc(ambito) + '</strong>';
    }

    var lista = limpia ? [] : retrasos15Home_();
    var listaHtml;
    if (lista.length) {
      listaHtml = '<div class="home-retrasos-label">Retrasos &ge; 15 min</div>' +
        '<ul class="welcome-list home-retrasos-list">' + lista.map(function (x) {
          return '<li class="home-retraso-item" role="button" tabindex="0" data-radar-tren="' + esc(x.tren) + '"' +
            (x.trip ? ' data-radar-trip="' + esc(x.trip) + '"' : '') +
            ' title="Abrir en Radar">' +
            '<span><strong>' + esc(x.tren) + '</strong> +' + esc(String(x.retraso)) + ' min</span>' +
            '<span class="welcome-muted">' + esc(x.ruta || '') + '</span></li>';
        }).join('') + '</ul>';
    } else {
      listaHtml = '<div class="home-retrasos-label">Retrasos &ge; 15 min</div>' +
        '<span class="welcome-muted">Ningún tren con demora ≥ 15 min en el sondeo actual.</span>';
    }

    home.innerHTML = '<div class="home-radar-resumen">' + resumenHtml + '</div>' + listaHtml;
  }

  function enfocarTarjetaRadarPendiente_() {
    var cod = String(pendingRadarFocusCod_ || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!cod || !list) return;
    var card = null;
    list.querySelectorAll('.alert[data-cod]').forEach(function (el) {
      if (card) return;
      var c = String(el.getAttribute('data-cod') || '').replace(/^0+(?=\d)/, '');
      if (c === cod) card = el;
    });
    if (!card) return;
    pendingRadarFocusCod_ = '';
    try {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
      card.scrollIntoView(true);
    }
    card.classList.add('alert-flash');
    window.setTimeout(function () { card.classList.remove('alert-flash'); }, 2200);
  }

  function irATarjetaRadarDesdeHome_(cod) {
    var tren = String(cod || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (!tren) {
      go('radar');
      return;
    }
    pendingRadarFocusCod_ = tren;
    mode = 'TODOS';
    document.querySelectorAll('.filter').forEach(function (x) {
      x.classList.toggle('active', x.dataset.mode === 'TODOS');
    });
    var search = document.getElementById('search');
    if (search) search.value = '';
    go('radar');
    render();
    window.setTimeout(enfocarTarjetaRadarPendiente_, 80);
  }

  /** En Radar: botón Enlace solo si queda algún enlace no realizado (hora + 10 min). */
  function radarTrenTieneEnlaceVisible_(tren) {
    var api = window.TurnioConexiones;
    if (!api || !api.estado || !api.estado().cargado || !api.conexionesDeTren) return false;
    var list = api.conexionesDeTren(tren, true);
    if (!list || !list.length) return false;
    var realizados = typeof cxObtenerRealizadosManual_ === 'function'
      ? cxObtenerRealizadosManual_()
      : {};
    for (var i = 0; i < list.length; i++) {
      if (!cxEsRealizado_(list[i], realizados)) return true;
    }
    return false;
  }

  function render() {
    var a = filtered();
    var total = radar[0] && Number(radar[0].totalActivos);
    var incid = radar[0] && Number(radar[0].totalIncidencias);
    meta.textContent = 'Última carga: ' + new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    pintarHomeRetrasos15_();
    if (!radar.length || (radar.length === 1 && /LIMPIA/i.test(String(radar[0].tipo || '')))) {
      var msg = radar[0] && radar[0].mensaje || 'Red operando con normalidad.';
      list.innerHTML = '<div class="empty clean">' + esc(msg) + '</div>';
      return;
    }
    var head = isFinite(total)
      ? '<div class="summary-chips"><span>&#128642; ' + total + ' trenes</span><span class="incident">&#9888; ' +
        (isFinite(incid) ? incid : radar.length) + ' incidencias</span></div>'
      : '';
    list.innerHTML = head + a.map(function (x) {
      var delay = Number(x.retrasoNum || 0);
      var cls = typeOf(x);
      var tren = String(x.codTren || '').replace(/[^0-9]/g, '');
      var trip = String(x.tripId || x.trip_id || '');
      var linea = plainText(x.linea || ('Circ. ' + tren));
      // Si el Worker no metió horas en linea, completar desde hOrig/hDest.
      if (x.hOrig || x.hDest) {
        var tieneHorasLinea = /\(\d{1,2}:\d{2}\)/.test(linea);
        if (!tieneHorasLinea) {
          var oNom = String(x.nombreOrig || '').trim();
          var dNom = String(x.nombreDest || '').trim();
          if (oNom || dNom || x.hOrig || x.hDest) {
            var oTxt = oNom || '?';
            var dTxt = dNom || '?';
            if (x.hOrig) oTxt += ' (' + x.hOrig + ')';
            if (x.hDest) dTxt += ' (' + x.hDest + ')';
            var base = linea.replace(/\s*[·|]\s*.+$/, '').trim() ||
              ((x.producto ? x.producto + ' ' : '') + tren).trim();
            linea = base + ' · ' + oTxt + ' → ' + dTxt;
          }
        }
      }
      var tieneGps = x.lat && x.lon && Math.abs(x.lat) > 0.1 && Math.abs(x.lon) > 0.1;
      var matTxt = String(x.matLabel || x.mat || '').trim();
      var matHtml = matTxt
        ? '<div class="alert-mat">&#128667; Unidades: ' + esc(matTxt) + '</div>'
        : '';
      return '<article class="alert ' + cls + '" data-cod="' + esc(tren) + '" data-trip="' + esc(trip) + '">' +
        '<div class="alert-head"><span>&#128308; ' + esc(x.tipo || 'AVISO') + '</span><span>&#128338; ' + esc(x.hora || '') + '</span></div>' +
        '<div class="train">&#9642; ' + esc(linea) + '</div>' +
        matHtml +
        '<p class="message">' + esc(x.mensaje || ('Demora ' + (delay >= 0 ? '+' : '') + delay + ' min.')) + '</p>' +
        '<div class="alert-bottom"><span>&#8618; Pulsa para ver la marcha</span>' +
        '<div class="alert-actions">' +
        (tieneGps
          ? '<button class="map-btn" type="button" data-map-tren="' + esc(tren) + '">&#128506; Mapa</button>'
          : '<button class="map-btn disabled" type="button" disabled title="Sin coordenadas GPS">&#128506; Mapa</button>') +
        (radarTrenTieneEnlaceVisible_(tren)
          ? '<button class="cx-btn" type="button" data-cx-tren="' + esc(tren) + '" title="Ver servicios enlazados">&#128279; Enlace</button>'
          : '') +
        (puedeEscribir
          ? '<button class="generate" type="button" data-aviso-tren="' + esc(tren) + '" data-aviso-trip="' + esc(trip) + '">&#128172; Generar Aviso</button>'
          : '') +
        '</div></div>' +
        '<div class="marcha-panel" hidden></div></article>';
    }).join('');
    enfocarTarjetaRadarPendiente_();
  }
  function labelStatus(s) {
    return s === 'STOPPED_AT' ? '&#128205; Posición en estación'
      : s === 'INCOMING_AT' ? '&#128646; Llegando a estación'
      : s === 'IN_TRANSIT_TO' ? '&#128642; En circulación'
      : '&#128642; Activo';
  }
  function renderMarcha(panel, m) {
    if (!m || !m.ok) {
      panel.innerHTML = '<div class="marcha-empty">' + esc((m && m.mensaje) || 'Tren no localizado en los datos en vivo.') + '</div>';
      return;
    }
    var retraso = Number(m.retrasoMin || 0);
    var paradas = Array.isArray(m.paradas) ? m.paradas : [];
    var ruta = '';
    if (m.origen || m.destino) {
      ruta = '<div class="marcha-route">' + esc(m.origen || '—') +
        (m.hOrig ? ' (' + esc(m.hOrig) + ')' : '') + ' \u2794 ' + esc(m.destino || '—') +
        (m.hDest ? ' programada ' + esc(m.hDest) : '') +
        (m.hDestPrevista ? ' · prevista ' + esc(m.hDestPrevista) : '') + '</div>';
    }
    var retTxt = m.retrasoOperativoTexto || (retraso > 0
      ? ('+' + retraso + ' min' + (m.hDestPrevista && m.destino
        ? ' · Llegada prevista a ' + m.destino + ': ' + m.hDestPrevista + 'h' : ''))
      : 'Puntual');
    var rows = paradas.map(function (p) {
      var cl = p.esActual ? 'actual' : p.esPasada ? 'pasada' : '';
      var icon = p.esActual ? '&#128205;' : p.esPasada ? '&#10003;' : '&#9675;';
      var dMin = Number(p.delayMin || 0);
      var delayHtml = '';
      if (dMin > 0) {
        var etiqueta = p.retrasoLlegada || p.esPasada
          ? ('llegó +' + dMin + ' min')
          : ('+' + dMin + ' min');
        delayHtml = ' <em class="marcha-delay">' + etiqueta + '</em>';
      } else if (p.esPasada || p.retrasoLlegada) {
        delayHtml = ' <em class="marcha-ontime">puntual</em>';
      } else {
        delayHtml = ' <em class="marcha-ontime">en hora</em>';
      }
      var horaProg = String(p.horaProgramada || '').trim();
      var horaEst = String(p.horaEst || p.horaEstimada || '').trim();
      var horaTxt = horaEst || horaProg || '--:--';
      if (horaProg && horaEst && horaProg !== horaEst) {
        horaTxt = horaProg + '\u2192' + horaEst;
      }
      return '<div class="marcha-step ' + cl + '"><b>' + esc(horaTxt) +
        '</b><span>' + icon + ' ' + esc(p.nombre || 'Parada') + delayHtml + '</span></div>';
    }).join('');
    var viaLive = lookupViaAdif_(m.numTren);
    var viaBanner = viaLive && viaLive.via
      ? '<div class="marcha-via-adif">📡 EN VIVO – VÍA ' + esc(viaLive.via) +
        (viaLive.acceso ? ' · Acceso ' + esc(viaLive.acceso) : '') + '</div>'
      : '';
    panel.innerHTML = '<div class="marcha-head"><strong>&#128225; Marcha en vivo · Tren ' + esc(m.numTren || '') +
      '</strong><span>' + labelStatus(m.status) + '</span></div>' + viaBanner + ruta +
      '<div class="marcha-kpis"><span>' + (retraso > 0 ? '&#9201; ' + esc(retTxt) : '&#9989; Puntual') +
      '</span><span>' + esc(m.stopActualNombre || 'Posición disponible') + '</span></div>' +
      (rows ? '<div class="marcha-list">' + rows + '</div>' : '<div class="marcha-empty">Sin paradas disponibles en el feed.</div>') +
      '<div class="marcha-source">Fuente: Renfe GTFS-RT · llegadas registradas en TURNIO' +
      (viaLive && viaLive.via ? ' · vía ADIF InfoStation' : '') + '</div>';
  }
  async function abrirMarcha(card) {
    var panel = card.querySelector('.marcha-panel');
    if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    var tren = String(card.dataset.cod || '');
    if (!tren) { toast('No hay número de tren para consultar.'); return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="marcha-empty">Consultando marcha en vivo...</div>';
    try {
      var data = await call('marcha', {
        codTren: tren,
        tripId: String(card.dataset.trip || ''),
        region: regionMarchaActual_()
      });
      renderMarcha(panel, data.marcha);
    } catch (e) {
      panel.innerHTML = '<div class="marcha-empty error-text">' + esc(e.message) + '</div>';
    }
  }
  async function loadRadar(opts) {
    opts = opts || {};
    if (window._radarLoading && !opts.force) return window._radarLoading;
    // Si ya hay una carga en curso, encola la última petición (cambio de región).
    if (window._radarLoading && opts.force) {
      window._radarPendingOpts = opts;
      return window._radarLoading;
    }
    if (!opts.silent && !opts.keepOnBusy) {
      list.innerHTML = '<div class="empty">Actualizando Radar...</div>';
    } else if (!opts.silent && opts.keepOnBusy && meta) {
      meta.textContent = '⏳ Actualizando regiones…';
      meta.style.color = '#ff9800';
    } else if (meta) {
      meta.textContent = '⏳ Sincronizando...';
      meta.style.color = '#ff9800';
    }
    if (opts.silent && list) list.style.opacity = '0.55';
    window._radarLoading = (async function () {
      var intentos = 0;
      try {
        while (intentos < 5) {
          intentos++;
          var regiones = obtenerRegionesRadar();
          var data = await call('radar', {
            modo: mode,
            region: regiones.join('+'),
            regiones: regiones
          });
          radar = Array.isArray(data.alertas) ? data.alertas : [];
          // Defensa: sin_salida no se muestra en Radar (Telegram pruebas).
          radar = radar.filter(function (a) {
            if (!a) return false;
            if (a.categoria === 'sin_salida') return false;
            return !/SIN SALIDA/i.test(String(a.tipo || ''));
          });
          var busy = radar.length === 1 && (
            radar[0]._radarBusy ||
            /ACTUALIZ/i.test(String(radar[0].tipo || '')) ||
            /actualizando/i.test(String(radar[0].mensaje || ''))
          );
          if (busy && intentos < 5) {
            // Conserva la lista anterior; no sustituir por la tarjeta "ocupado".
            if (meta) {
              meta.textContent = '⏳ Radar ocupado, reintentando… (' + intentos + '/4)';
              meta.style.color = '#ff9800';
            }
            toast('Radar ocupado, reintentando…');
            await new Promise(function (r) { setTimeout(r, 2500); });
            continue;
          }
          if (busy) {
            if (meta) {
              meta.textContent = '⏳ Radar aún sincronizando. Pulsa de nuevo en unos segundos.';
              meta.style.color = '#ff9800';
            }
            // No pinta la tarjeta busy como única alerta.
            return;
          }
          if (window.TurnioCxRetrasos) {
            window.TurnioCxRetrasos.aplicarDesdeRadar(radar, 'turnio-radar');
          }
          render();
          if (meta) meta.style.color = '';
          return;
        }
      } catch (e) {
        if (!opts.silent) {
          list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
        } else if (meta) {
          meta.textContent = '⚠️ Error al sincronizar';
          meta.style.color = 'var(--red)';
        }
        if (/sesión|caducada/i.test(e.message)) {
          localStorage.removeItem(sessionKey);
          if (fabAbierto_) toggleFAB_(false);
          mostrarFab_(false);
          appShell.hidden = true;
          nav.hidden = true;
          loginShell.hidden = false;
          loginForm.hidden = false;
        }
      } finally {
        if (list) list.style.opacity = '1';
        window._radarLoading = null;
        var pending = window._radarPendingOpts;
        if (pending) {
          window._radarPendingOpts = null;
          loadRadar(pending);
        }
      }
    })();
    return window._radarLoading;
  }

  function radarVisibleParaAuto_() {
    var scr = document.getElementById('screen-radar');
    if (!scr || appShell.hidden) return false;
    return scr.classList.contains('active') || scr.classList.contains('screen--in-float');
  }

  /** Igual que GAS producción: refresco automático cada 2 min con el radar visible. */
  function gestionarAutoRadar() {
    var activa = radarVisibleParaAuto_();
    if (activa) {
      if (!intervaloAutoRadar) {
        intervaloAutoRadar = setInterval(function () {
          if (radarVisibleParaAuto_()) {
            loadRadar({ silent: true });
            refrescarAvisosRed();
          }
        }, 120000);
      }
    } else if (intervaloAutoRadar) {
      clearInterval(intervaloAutoRadar);
      intervaloAutoRadar = null;
    }
  }

  function fechaAvisoTxt(inicio) {
    var ts = Number(inicio || 0);
    if (!ts) return 'Sin fecha/hora oficial';
    // Renfe a veces manda segundos Unix; a veces ms.
    if (ts < 1e12) ts = ts * 1000;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'Sin fecha/hora oficial';
    return d.toLocaleDateString('es-ES', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Europe/Madrid'
    }) + ' · ' + d.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid'
    });
  }

  function ordenarAvisosRed_(avisos) {
    return (Array.isArray(avisos) ? avisos.slice() : []).sort(function (a, b) {
      var ia = Number((a && a.inicio) || 0);
      var ib = Number((b && b.inicio) || 0);
      if (ib !== ia) return ib - ia;
      return String((a && a.texto) || '').localeCompare(String((b && b.texto) || ''), 'es');
    });
  }

  async function fetchAvisosRed() {
    if (cargandoAvisosRed) return cargandoAvisosRed;
    cargandoAvisosRed = (async function () {
      try {
        var r = await fetch(api + '/api/avisos', { method: 'GET', cache: 'no-store' });
        if (r.ok) {
          var data = await r.json();
          if (data && Array.isArray(data.avisos)) return ordenarAvisosRed_(data.avisos);
        }
      } catch (_) {}
      try {
        var dataGas = await call('avisos_red', {});
        return ordenarAvisosRed_(Array.isArray(dataGas.avisos) ? dataGas.avisos : []);
      } catch (_) {
        return ordenarAvisosRed_(cacheAvisosRed.slice());
      }
    })();
    try {
      return await cargandoAvisosRed;
    } finally {
      cargandoAvisosRed = null;
    }
  }

  function pintarTeletipoAvisos(avisos) {
    var box = document.getElementById('texto-teletipo');
    var cont = document.getElementById('infra-contador');
    var btn = document.getElementById('btn-estado-red');
    var home = document.getElementById('home-avisos');
    avisos = ordenarAvisosRed_(avisos);
    var n = avisos.length;
    if (cont) cont.textContent = String(n);
    if (btn) btn.classList.toggle('is-alert', n > 0);
    if (home) {
      home.textContent = n
        ? (n + ' aviso' + (n === 1 ? '' : 's') + ' activo' + (n === 1 ? '' : 's') + ' en la red Renfe')
        : 'Red operando sin avisos oficiales ahora mismo';
    }
    if (!box) return;
    if (!n) {
      box.innerHTML = '<div class="infra-item">✅ Red nacional operando sin avisos.</div>';
      return;
    }
    var max = Math.min(n, 12);
    var html = '';
    for (var i = 0; i < max; i++) {
      var fecha = fechaAvisoTxt(avisos[i].inicio);
      html += '<div class="infra-item"><span class="infra-dot">🔴</span><span>' +
        '<span class="infra-fecha">🕐 ' + esc(fecha) + '</span> · ' +
        esc(avisos[i].texto || '') + '</span></div>';
    }
    if (n > max) {
      html += '<div class="infra-item"><span class="infra-dot">…</span><span>Y ' +
        (n - max) + ' más. Pulsa Ver todos.</span></div>';
    }
    box.innerHTML = html;
  }

  function pintarListaAvisos(avisos) {
    var lista = document.getElementById('avisos-lista');
    if (!lista) return;
    avisos = ordenarAvisosRed_(avisos);
    if (!avisos.length) {
      lista.innerHTML = '<div class="empty">✅ Red operando con normalidad. No hay avisos activos.</div>';
      return;
    }
    lista.innerHTML = avisos.map(function (av) {
      var fecha = fechaAvisoTxt(av.inicio);
      return '<div class="avisos-row">' +
        '<div class="avisos-fecha">🕐 ' + esc(fecha) + '</div>' +
        '<div class="avisos-texto">🔴 ' + esc(av.texto || '') + '</div></div>';
    }).join('');
  }

  async function refrescarAvisosRed() {
    try {
      var avisos = await fetchAvisosRed();
      cacheAvisosRed = avisos;
      pintarTeletipoAvisos(avisos);
      var scr = document.getElementById('screen-avisos');
      if (scr && scr.classList.contains('active')) pintarListaAvisos(avisos);
      return avisos;
    } catch (e) {
      pintarTeletipoAvisos(cacheAvisosRed);
      return cacheAvisosRed;
    }
  }

  async function cargarPantallaAvisos(force) {
    var lista = document.getElementById('avisos-lista');
    if (lista) lista.innerHTML = '<div class="empty">Cargando avisos…</div>';
    var avisos = force ? await fetchAvisosRed() : (cacheAvisosRed.length ? cacheAvisosRed : await fetchAvisosRed());
    cacheAvisosRed = avisos;
    pintarTeletipoAvisos(avisos);
    pintarListaAvisos(avisos);
  }

  function toggleTeletipoRed() {
    var box = document.getElementById('infra-main-box');
    if (!box) return;
    var abierto = !box.hidden;
    box.hidden = abierto;
    if (!abierto) refrescarAvisosRed();
  }

  /* ── Monitor de pared ───────────────────────────────────────── */
  function toggleMonitorMode(activar) {
    var docElm = document.documentElement;
    if (activar) {
      document.body.classList.add('monitor-mode');
      go('radar');
      try {
        if (docElm.requestFullscreen) docElm.requestFullscreen();
        else if (docElm.webkitRequestFullscreen) docElm.webkitRequestFullscreen();
        else if (docElm.mozRequestFullScreen) docElm.mozRequestFullScreen();
      } catch (_) {}
      toast('Modo Monitor activado');
    } else {
      document.body.classList.remove('monitor-mode');
      try {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch (_) {}
    }
  }
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) document.body.classList.remove('monitor-mode');
    syncMapaFullscreenUi_();
  });
  document.addEventListener('webkitfullscreenchange', syncMapaFullscreenUi_);

  function mapaFullscreenEl_() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncMapaFullscreenUi_() {
    var scr = document.getElementById('screen-mapa');
    var btn = document.getElementById('btn-fullscreen-mapa');
    var activo = !!(scr && mapaFullscreenEl_() === scr);
    if (btn) {
      btn.classList.toggle('mapa-fs-on', activo);
      btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
      btn.textContent = activo ? '✕' : '⛶';
      btn.title = activo ? 'Salir de pantalla completa' : 'Pantalla completa';
    }
    // Reubicar pop-outs del Vigilante abiertos (fullscreen nativo del mapa).
    ['modal-retraso-grave', 'modal-detencion-grave'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m && !m.hidden) montarModalVigilante_(m);
    });
    var toastEl = document.getElementById('toast');
    if (toastEl) montarToast_(toastEl);
    if (window._mapaLeaflet) {
      setTimeout(function () {
        try { window._mapaLeaflet.invalidateSize(); } catch (_) {}
      }, 180);
    }
  }

  function salirMapaFullscreen_() {
    var fs = mapaFullscreenEl_();
    var scr = document.getElementById('screen-mapa');
    if (!fs || fs !== scr) return;
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (_) {}
  }

  function toggleMapaFullscreen_() {
    var scr = document.getElementById('screen-mapa');
    if (!scr) return;
    var fs = mapaFullscreenEl_();
    try {
      if (fs === scr) {
        salirMapaFullscreen_();
        return;
      }
      var req = scr.requestFullscreen || scr.webkitRequestFullscreen || scr.mozRequestFullScreen || scr.msRequestFullscreen;
      if (!req) {
        toast('Este navegador no permite pantalla completa.', 'error');
        return;
      }
      Promise.resolve(req.call(scr)).then(function () {
        syncMapaFullscreenUi_();
        toast('Mapa a pantalla completa · Esc o ✕ para salir', 'success');
      }).catch(function () {
        toast('No se pudo activar pantalla completa.', 'error');
      });
    } catch (err) {
      toast('No se pudo activar pantalla completa.', 'error');
    }
  }

  /* ── Mapa Leaflet (flota Renfe ligera) ───────────────────────── */
  // Colores como en tiempo-real.largorecorrido.renfe.com
  function colorMarcador(a) {
    var r = Number(a.retrasoNum || 0);
    if (!isFinite(r) || r <= 0) return '#008000';
    if (r <= 15) return '#008000';
    if (r <= 60) return '#FFDE21';
    return '#FF0000';
  }
  function textoRetrasoFlota(r) {
    r = Number(r || 0);
    if (!isFinite(r) || r === 0) return '✓';
    if (r < 0) return r + 'm';
    if (r >= 60) {
      var h = Math.floor(r / 60);
      var m = r % 60;
      return '+' + h + 'h' + (m ? m : '');
    }
    return '+' + r;
  }
  function flotaFiltrada() {
    return flotaMapa.filter(function (t) {
      if (flotaModo === 'LD' && t.modo !== 'LD') return false;
      if (flotaModo === 'CERCANIAS' && t.modo !== 'CERCANIAS') return false;
      if (flotaSoloDemora && !(Number(t.retrasoNum) > 0)) return false;
      return t.lat && t.lon && Math.abs(t.lat) > 0.1 && Math.abs(t.lon) > 0.1;
    });
  }
  async function cargarFlotaMapa(opts) {
    opts = opts || {};
    if (flotaCargaPromise) return flotaCargaPromise;
    var cnt = document.getElementById('mapa-contador-trenes');
    var silencioso = !!opts.silent;
    if (cnt && !flotaMapa.length && !silencioso) cnt.textContent = 'Cargando flota Renfe…';
    flotaCargaPromise = (async function () {
      try {
        var d = null;
        // Preferente: Worker (sin cuota GAS). Fallback: acción GAS cacheada.
        try {
          var r = await fetch(api + '/api/flota', { method: 'GET', cache: 'no-store' });
          if (r.ok) {
            var j = await r.json();
            if (j && j.ok !== false && Array.isArray(j.trenes)) d = j;
          }
        } catch (_) {}
        if (!d) d = await call('flota_mapa', {});
        flotaMapa = Array.isArray(d.trenes) ? d.trenes : [];
        if (window.TurnioCxRetrasos) {
          window.TurnioCxRetrasos.aplicarDesdeFlota(flotaMapa, 'turnio-flota');
        }
        var regionLabel = document.getElementById('mapa-region-label');
        if (regionLabel) {
          regionLabel.textContent = 'Flota Renfe · LD ' + (d.ld || 0) + ' · Cerc. ' + (d.cercanias || 0);
        }
        if (window._mapaLeaflet) pintarMarcadores(!!opts.fit);
        else if (cnt && flotaMapa.length) {
          cnt.textContent = flotaMapa.length + ' trenes listos · abre el mapa';
        }
        marcarMallasCirculandoDesdeFlota_();
        return flotaMapa;
      } catch (e) {
        if (cnt && !silencioso) cnt.textContent = String(e.message || e);
        throw e;
      } finally {
        flotaCargaPromise = null;
      }
    })();
    return flotaCargaPromise;
  }

  /** Precarga al login: descarga flota sin montar Leaflet. */
  function precargarFlotaMapa() {
    if (flotaMapa.length || flotaCargaPromise) return flotaCargaPromise;
    return cargarFlotaMapa({ silent: true, fit: false }).catch(function () {
      // Silencioso: se reintenta al abrir el mapa.
    });
  }
  function normNumFlotaMalla_(s) {
    return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  }

  function indiceFlotaParaMallas_(lista) {
    var byTrip = Object.create(null);
    var byNum = Object.create(null);
    (lista || []).forEach(function (t) {
      if (!t) return;
      var trip = String(t.tripId || '').trim();
      var num = normNumFlotaMalla_(t.codTren || t.codComercial || t.tren || '');
      if (trip) byTrip[trip] = t;
      if (num && !byNum[num]) byNum[num] = t;
    });
    return { byTrip: byTrip, byNum: byNum };
  }

  function matchFlotaMalla_(tid, num, idx) {
    if (!idx) return null;
    var trip = String(tid || '').trim();
    if (trip && idx.byTrip[trip]) return idx.byTrip[trip];
    var n = normNumFlotaMalla_(num);
    if (n && idx.byNum[n]) return idx.byNum[n];
    if (trip.length > 11) {
      var pref = trip.substring(0, trip.length - 11).replace(/^0+/, '');
      if (pref && idx.byNum[pref]) return idx.byNum[pref];
    }
    return null;
  }

  function asegurarChipCirculando_(host, label) {
    if (!host) return;
    var chip = host.querySelector('.chip-circulando-front');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'chip-circulando-front';
      host.insertBefore(chip, host.firstChild);
    }
    chip.textContent = label || '🚆 CIRCULANDO';
  }

  function quitarChipCirculando_(host) {
    if (!host) return;
    var chip = host.querySelector('.chip-circulando-front');
    if (chip) chip.remove();
  }

  /** Marca tarjetas de Mallas (cuadro + localizador) con la flota ya cargada. */
  function marcarMallasCirculandoDesdeFlota_() {
    var idx = indiceFlotaParaMallas_(flotaMapa);
    document.querySelectorAll('#resultadosGTFS .flip-card').forEach(function (card) {
      var pos = matchFlotaMalla_(card.getAttribute('data-tid'), card.getAttribute('data-num'), idx);
      var tripInfo = card.querySelector('.trip-info');
      if (pos) {
        card.classList.add('live');
        asegurarChipCirculando_(tripInfo, etiquetaChipCirculando_(pos));
      } else {
        card.classList.remove('live');
        quitarChipCirculando_(tripInfo);
      }
    });
    document.querySelectorAll('#mallas-resultados .malla-item').forEach(function (item) {
      var pos = matchFlotaMalla_(item.getAttribute('data-trip'), item.getAttribute('data-tren'), idx);
      var meta = item.querySelector('.malla-meta');
      var legacy = meta && meta.querySelector('.malla-chip');
      if (legacy) legacy.remove();
      if (pos) {
        item.classList.add('live');
        asegurarChipCirculando_(meta, etiquetaChipCirculando_(pos));
      } else {
        item.classList.remove('live');
        quitarChipCirculando_(meta);
      }
    });
    inyectarViaAdifEnMallas_();
    asegurarInfoStationParaMallas_();
  }
  window.TurnioMarcarMallasCirculando = marcarMallasCirculandoDesdeFlota_;

  function mallasVisibleParaAutoFlota_() {
    var a = document.getElementById('screen-mallas');
    var b = document.getElementById('screen-mallas-localizador');
    var mapa = document.getElementById('screen-mapa');
    function vis(scr) {
      return !!(scr && (scr.classList.contains('active') || scr.classList.contains('screen--in-float')));
    }
    return vis(a) || vis(b) || vis(mapa);
  }

  function arrancarAutoFlota() {
    detenerAutoFlota();
    flotaTimer = setInterval(function () {
      if (!mallasVisibleParaAutoFlota_()) return;
      cargarFlotaMapa({ fit: false, silent: true }).catch(function () {});
    }, 30000);
  }
  function detenerAutoFlota() {
    if (flotaTimer) {
      clearInterval(flotaTimer);
      flotaTimer = null;
    }
  }
  function cargarLeaflet(cb) {
    if (window.L) { cb(); return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    var clusterCss = document.createElement('link');
    clusterCss.rel = 'stylesheet';
    clusterCss.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
    document.head.appendChild(clusterCss);
    function script(src, ok, fail) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    }
    function afterLeaflet() {
      if (window.L.markerClusterGroup) { cb(); return; }
      script('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js', cb, cb);
    }
    script('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', afterLeaflet, function () {
      script('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', afterLeaflet, function () {
        document.getElementById('mapa-contador-trenes').textContent = 'Error al cargar el mapa';
      });
    });
  }
  function crearMapa() {
    if (window._mapaLeaflet) {
      window._mapaLeaflet.invalidateSize();
      pintarMarcadores(false);
      return;
    }
    var map = L.map('mapa-container', { zoomControl: false }).setView([40.0, -3.7], 6);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap · Flota Renfe',
      maxZoom: 19
    }).addTo(map);
    var buscador = document.querySelector('.mapa-buscador');
    if (buscador && L.DomEvent) {
      L.DomEvent.disableClickPropagation(buscador);
      L.DomEvent.disableScrollPropagation(buscador);
    }
    var ormWrap = document.getElementById('orm-wrapper');
    if (ormWrap && L.DomEvent) {
      L.DomEvent.disableClickPropagation(ormWrap);
      L.DomEvent.disableScrollPropagation(ormWrap);
    }
    var filtros = document.getElementById('mapa-filtros');
    if (filtros && L.DomEvent) {
      L.DomEvent.disableClickPropagation(filtros);
    }

    // Capas OpenRailwayMap (como en TURNIO GAS) — independientes de ADIF.
    window._capasORM = {
      standard: L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { attribution: '', opacity: 0.75, maxZoom: 19 }),
      maxspeed: L.tileLayer('https://{s}.tiles.openrailwaymap.org/maxspeed/{z}/{x}/{y}.png', { attribution: '', opacity: 0.80, maxZoom: 19 }),
      signals: L.tileLayer('https://{s}.tiles.openrailwaymap.org/signals/{z}/{x}/{y}.png', { attribution: '', opacity: 0.80, maxZoom: 19 })
    };
    window._ormEstado = 'standard';
    aplicarCapaORM(map, 'standard');
    map.on('zoomend', actualizarBtnORM);

    // Capa oficial ADIF (IDEADIF WMS). Toggle aparte; no sustituye ORM.
    window._capaAdif = L.tileLayer.wms('https://ideadif.adif.es/services/wms', {
      layers: 'TN.RailTransportNetwork.RailwayLink',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.65,
      attribution: 'ADIF IDEADIF',
      maxZoom: 19
    });
    window._adifActivo = false;
    actualizarBtnAdif_();

    var leyenda = L.control({ position: 'bottomleft' });
    leyenda.onAdd = function () {
      var div = L.DomUtil.create('div', 'mapa-leyenda');
      div.innerHTML =
        '<strong style="display:block;margin-bottom:6px;">Retraso (Renfe)</strong>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#008000;"></div> ≤ 15 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#FFDE21;"></div> 16 – 60 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#FF0000;"></div> &gt; 60 min</div>' +
        '<strong style="display:block;margin:8px 0 6px;">LTV Adif</strong>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#dc2626;"></div> ≤ 30 km/h</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#ea580c;"></div> ≤ 60 km/h</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#ca8a04;"></div> ≤ 100 km/h</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#2563eb;"></div> &gt; 100 km/h</div>';
      return div;
    };
    leyenda.addTo(map);
    window._mapaLeaflet = map;
    mapReady = true;
    pintarMarcadores(!mapaFitHecho);
  }

  var ORM_ZOOM_MIN = 9;
  var ORM_LABELS = {
    off: '🛤️ Vías',
    standard: '🛤️ Vías',
    maxspeed: '⚡ Velocidades',
    signals: '🚦 Señalización'
  };
  function aplicarCapaORM(map, estado) {
    var capas = window._capasORM;
    var btn = document.getElementById('btn-toggle-vias');
    if (!capas || !map) return;
    Object.keys(capas).forEach(function (k) {
      if (map.hasLayer(capas[k])) map.removeLayer(capas[k]);
    });
    document.querySelectorAll('.orm-option').forEach(function (el) {
      el.classList.toggle('selected', el.getAttribute('data-orm') === estado);
    });
    window._ormEstado = estado;
    if (estado !== 'off' && capas[estado]) {
      capas[estado].addTo(map);
      if (btn) {
        btn.textContent = ORM_LABELS[estado];
        btn.classList.add('activo');
      }
      if (map.getZoom() < ORM_ZOOM_MIN) {
        toast('Haz zoom (≥' + ORM_ZOOM_MIN + ') para ver las vías ferroviarias');
      }
    } else if (btn) {
      btn.textContent = ORM_LABELS.off;
      btn.classList.remove('activo');
    }
  }
  function actualizarBtnORM() {
    var btn = document.getElementById('btn-toggle-vias');
    var map = window._mapaLeaflet;
    if (!btn || !map || !window._ormEstado || window._ormEstado === 'off') return;
    var zoom = map.getZoom();
    btn.textContent = zoom < ORM_ZOOM_MIN
      ? ORM_LABELS[window._ormEstado] + ' (' + zoom + ')'
      : ORM_LABELS[window._ormEstado];
  }
  function toggleOrmDropdown(e) {
    if (e) e.stopPropagation();
    var dd = document.getElementById('orm-dropdown');
    if (dd) dd.classList.toggle('open');
  }
  function seleccionarORM(estado) {
    var dd = document.getElementById('orm-dropdown');
    if (dd) dd.classList.remove('open');
    var map = window._mapaLeaflet;
    if (!map) return;
    aplicarCapaORM(map, estado);
  }

  function actualizarBtnAdif_() {
    var btn = document.getElementById('btn-toggle-adif');
    if (!btn) return;
    var on = !!window._adifActivo;
    btn.classList.toggle('activo', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on
      ? 'Ocultar capa oficial ADIF (IDEADIF). ORM no se ve afectado.'
      : 'Mostrar capa oficial ADIF (IDEADIF). Independiente de ORM.';
  }

  function toggleCapaAdif_() {
    var map = window._mapaLeaflet;
    var capa = window._capaAdif;
    if (!map || !capa) {
      toast('Abre el mapa primero.', 'error');
      return;
    }
    if (window._adifActivo) {
      if (map.hasLayer(capa)) map.removeLayer(capa);
      window._adifActivo = false;
      actualizarBtnAdif_();
      return;
    }
    try {
      capa.addTo(map);
      // Mantener marcadores de trenes por encima de la WMS.
      mapMarkers.forEach(function (m) {
        if (m && m.bringToFront) m.bringToFront();
      });
      window._adifActivo = true;
      actualizarBtnAdif_();
    } catch (err) {
      window._adifActivo = false;
      actualizarBtnAdif_();
      toast('No se pudo cargar la capa ADIF.', 'error');
    }
  }

  /** LTV Adif (Experience ArcGIS): puntos de limitación temporal de velocidad. */
  var LTV_FS_URL_ = 'https://services7.arcgis.com/XTupIrLX53AjaJqO/arcgis/rest/services/LTV_2/FeatureServer/0/query';
  var LTV_REFRESH_MS_ = 10 * 60 * 1000;
  window._ltvActivo = false;
  window._ltvLayer = null;
  window._ltvTimer = null;
  window._ltvCargando = false;

  function colorLtvVel_(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '#64748b';
    if (n <= 30) return '#dc2626';
    if (n <= 60) return '#ea580c';
    if (n <= 100) return '#ca8a04';
    return '#2563eb';
  }

  function formatearFechaLtv_(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return new Date(n).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) { return ''; }
  }

  function popupLtvHtml_(props) {
    var p = props || {};
    var vel = p.RESTRICCIONVELOCIDAD != null ? (String(p.RESTRICCIONVELOCIDAD) + ' km/h') : '—';
    var linea = String(p.DESCLINEA || p.CODLINEA || '—');
    var tramo = [p.DESCPSINI, p.DESCPSFIN].filter(Boolean).join(' → ') || '—';
    var pk = '';
    if (p.PKINI != null || p.PKFIN != null) {
      pk = 'PK ' + (p.PKINI != null ? p.PKINI : '?') + ' – ' + (p.PKFIN != null ? p.PKFIN : '?');
    }
    var motivo = String(p.MOTIVO || p.OBSERVACIONES || '').trim();
    var vigor = formatearFechaLtv_(p.FECHAVIGORLTV);
    var fin = formatearFechaLtv_(p.FECHAFINPREV);
    return '<div class="mapa-ltv-popup">' +
      '<div class="mapa-popup-linea">LTV · ' + esc(vel) + '</div>' +
      '<div class="mapa-popup-msg"><b>' + esc(linea) + '</b><br>' +
      esc(tramo) +
      (pk ? ('<br>' + esc(pk)) : '') +
      (motivo ? ('<br>' + esc(motivo)) : '') +
      (vigor ? ('<br>Vigor: ' + esc(vigor)) : '') +
      (fin ? ('<br>Fin prev.: ' + esc(fin)) : '') +
      '</div></div>';
  }

  function actualizarBtnLtv_() {
    var btn = document.getElementById('btn-toggle-ltv');
    if (!btn) return;
    var on = !!window._ltvActivo;
    btn.classList.toggle('activo', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on
      ? 'Ocultar LTV Adif (se detiene la autoactualización).'
      : 'Mostrar limitaciones temporales de velocidad (Adif). Se actualiza sola cada 10 min.';
  }

  function pararAutoLtv_() {
    if (window._ltvTimer) {
      clearInterval(window._ltvTimer);
      window._ltvTimer = null;
    }
  }

  function arrancarAutoLtv_() {
    pararAutoLtv_();
    window._ltvTimer = setInterval(function () {
      if (!window._ltvActivo) return;
      cargarCapaLtv_({ silent: true }).catch(function () {});
    }, LTV_REFRESH_MS_);
  }

  function quitarCapaLtv_() {
    var map = window._mapaLeaflet;
    pararAutoLtv_();
    if (map && window._ltvLayer && map.hasLayer(window._ltvLayer)) {
      map.removeLayer(window._ltvLayer);
    }
    window._ltvLayer = null;
    window._ltvActivo = false;
    actualizarBtnLtv_();
  }

  async function cargarCapaLtv_(opts) {
    var silent = !!(opts && opts.silent);
    var map = window._mapaLeaflet;
    if (!map || !window.L) throw new Error('Mapa no listo');
    if (window._ltvCargando) return window._ltvLayer;
    window._ltvCargando = true;
    try {
      var url = LTV_FS_URL_ +
        '?where=1%3D1' +
        '&outFields=RESTRICCIONVELOCIDAD,DESCLINEA,CODLINEA,DESCPSINI,DESCPSFIN,PKINI,PKFIN,MOTIVO,OBSERVACIONES,FECHAVIGORLTV,FECHAFINPREV,VIAS,TIPOTREN' +
        '&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=2000';
      var res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var geo = await res.json();
      if (!geo || geo.type !== 'FeatureCollection') throw new Error('GeoJSON inválido');
      var layer = L.geoJSON(geo, {
        pointToLayer: function (feature, latlng) {
          var vel = feature && feature.properties && feature.properties.RESTRICCIONVELOCIDAD;
          var color = colorLtvVel_(vel);
          var nVel = Number(vel);
          var texto = Number.isFinite(nVel) && nVel > 0 ? String(Math.round(nVel)) : 'LTV';
          var ink = (nVel > 0 && nVel <= 100) ? '#fff' : '#fff';
          if (color === '#ca8a04') ink = '#111';
          return L.marker(latlng, {
            icon: L.divIcon({
              className: 'mapa-ltv-div-icon',
              html: '<div class="mapa-ltv-marker" style="background:' + color + ';color:' + ink + ';">' +
                texto + '</div>',
              iconSize: [34, 34],
              iconAnchor: [17, 17],
              popupAnchor: [0, -16]
            }),
            keyboard: false
          });
        },
        onEachFeature: function (feature, layer) {
          layer.bindPopup(popupLtvHtml_(feature && feature.properties), {
            maxWidth: 280,
            className: 'mapa-popup-wrap'
          });
        }
      });
      if (window._ltvLayer && map.hasLayer(window._ltvLayer)) {
        map.removeLayer(window._ltvLayer);
      }
      window._ltvLayer = layer;
      layer.addTo(map);
      // Trenes por encima de LTV.
      mapMarkers.forEach(function (m) {
        if (m && m.bringToFront) m.bringToFront();
      });
      var n = Array.isArray(geo.features) ? geo.features.length : 0;
      if (!silent) toast('LTV Adif: ' + n + ' limitaciones');
      return layer;
    } finally {
      window._ltvCargando = false;
    }
  }

  async function toggleCapaLtv_() {
    var map = window._mapaLeaflet;
    if (!map) {
      toast('Abre el mapa primero.', 'error');
      return;
    }
    if (window._ltvActivo) {
      quitarCapaLtv_();
      return;
    }
    try {
      await cargarCapaLtv_({ silent: false });
      window._ltvActivo = true;
      actualizarBtnLtv_();
      arrancarAutoLtv_();
    } catch (err) {
      quitarCapaLtv_();
      toast('No se pudo cargar LTV Adif: ' + String(err && err.message ? err.message : err), 'error');
    }
  }

  function pintarMarcadores(hacerFit) {
    var map = window._mapaLeaflet;
    if (!map) return;
    mapMarkers.forEach(function (m) { map.removeLayer(m); });
    mapMarkers = [];
    mapIndex = {};
    var noData = document.getElementById('mapa-no-datos');
    var cnt = document.getElementById('mapa-contador-trenes');
    var upd = document.getElementById('mapa-last-update');
    var alertas = flotaFiltrada();
    if (!alertas.length) {
      noData.hidden = false;
      noData.querySelector('b').textContent = flotaMapa.length
        ? 'Sin trenes con este filtro'
        : 'Cargando flota Renfe…';
      noData.querySelectorAll('p')[1].textContent = flotaMapa.length
        ? 'Prueba Otro filtro o Solo demoras.'
        : 'Posiciones en vivo de Cercanías y Larga Distancia.';
      cnt.textContent = flotaMapa.length ? '0 trenes con este filtro' : 'Cargando flota…';
      return;
    }
    noData.hidden = true;
    var demoras = alertas.filter(function (a) { return Number(a.retrasoNum) > 0; }).length;
    cnt.textContent = alertas.length + ' trenes' +
      (flotaModo !== 'TODOS' ? ' · ' + flotaModo : '') +
      (demoras ? ' · ' + demoras + ' con demora' : '');
    upd.textContent = 'Act. ' + new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var usarCluster = !!(window.L && window.L.markerClusterGroup);
    var cluster = usarCluster ? L.markerClusterGroup({
      maxClusterRadius: 55,
      disableClusteringAtZoom: 12,
      iconCreateFunction: function (c) {
        var color = '#008000';
        c.getAllChildMarkers().forEach(function (m) {
          var col = m.options._alertaColor || '#008000';
          if (col === '#FF0000') color = '#FF0000';
          else if (col === '#FFDE21' && color !== '#FF0000') color = '#FFDE21';
        });
        return L.divIcon({
          className: '',
          html: '<div class="mapa-cluster" style="background:' + color + ';color:' +
            (color === '#FFDE21' ? '#111' : '#fff') + ';">' + c.getChildCount() + '</div>',
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        });
      }
    }) : null;
    window._mapaClusterGroup = cluster;
    var bounds = [];
    alertas.forEach(function (a) {
      var lat = parseFloat(a.lat);
      var lon = parseFloat(a.lon);
      var color = colorMarcador(a);
      var texto = textoRetrasoFlota(a.retrasoNum);
      var ink = color === '#FFDE21' ? '#111' : '#fff';
      var bearing = Number(a.bearing);
      var tieneRumbo = Number.isFinite(bearing);
      // Flecha por encima del borde de la bola; caja 56px para que Leaflet no la recorte.
      var arrowHtml = tieneRumbo
        ? '<span class="mapa-marker-arrow" style="border-bottom-color:' + color +
          ';transform:translate(-50%,-50%) rotate(' + Math.round(bearing) + 'deg) translateY(-23px);"></span>'
        : '';
      var icon = L.divIcon({
        className: 'mapa-div-icon',
        html: '<div class="mapa-marker-shell">' +
          '<div class="mapa-marker" style="width:30px;height:30px;background:' + color + ';color:' + ink + ';">' +
          texto + '</div>' + arrowHtml + '</div>',
        iconSize: [56, 56],
        iconAnchor: [28, 28],
        popupAnchor: [0, -18]
      });
      var retrasoHtml = Number(a.retrasoNum) > 0
        ? '<span style="color:#ef4444;font-weight:900;">+' + a.retrasoNum + ' min</span>'
        : '<span style="color:#008000;font-weight:900;">En hora</span>';
      var enrich = enriquecerTrenMapaDesdeRadar_(a);
      var popup = construirPopupMapaHtml_(enrich);
      var marker = L.marker([lat, lon], {
        icon: icon,
        _alertaColor: color,
        _codTren: String(a.codTren || ''),
        _flotaTren: enrich
      }).bindPopup(popup, { maxWidth: 300, className: 'mapa-popup-wrap' });
      marker.on('popupopen', function () {
        enriquecerPopupMapaAsync_(marker);
      });
      var key = String(a.codTren || '').replace(/^0+/, '');
      if (key) mapIndex[key] = marker;
      if (cluster) cluster.addLayer(marker);
      else { marker.addTo(map); mapMarkers.push(marker); }
      bounds.push([lat, lon]);
    });
    if (cluster) {
      map.addLayer(cluster);
      mapMarkers.push(cluster);
    }
    var regionesMapa = obtenerRegionesRadar();
    var encuadreRegion = regionesMapa.length === 1 && REGION_MAP_BOUNDS[regionesMapa[0]];
    if (hacerFit && encuadreRegion) {
      map.fitBounds(REGION_MAP_BOUNDS[regionesMapa[0]], { padding: [24, 24], maxZoom: 9 });
      mapaFitHecho = true;
    } else if (hacerFit && bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
      mapaFitHecho = true;
    } else if (hacerFit && bounds.length === 1) {
      map.setView(bounds[0], 9);
      mapaFitHecho = true;
    }
  }
  function openMapa() {
    arrancarAutoFlota();
    cargarLeaflet(function () {
      crearMapa();
      // Si la precarga ya terminó, pinta al momento; si no, espera la misma promesa.
      if (flotaMapa.length && window._mapaLeaflet) {
        pintarMarcadores(!mapaFitHecho);
      }
      cargarFlotaMapa({ fit: !mapaFitHecho }).catch(function (e) {
        toast(String(e.message || e), 'error');
      });
    });
  }
  function buscarTrenEnMapa(numForzado) {
    var input = document.getElementById('mapa-buscar-input');
    var msg = document.getElementById('mapa-busqueda-msg');
    // El listener de click pasa un Event; no es un número de tren.
    if (numForzado && typeof numForzado === 'object') numForzado = '';
    var num = String(numForzado || (input && input.value) || '').replace(/\D/g, '').replace(/^0+/, '');
    if (numForzado && input) input.value = num;
    if (!num) {
      if (msg) {
        msg.textContent = 'Introduce un número de tren.';
        msg.className = 'err';
      }
      return false;
    }
    ocultarSugerenciasMapa_();
    var marker = mapIndex[num];
    if (!marker) {
      // Si el tren está en flota pero fuera del filtro actual, avisar con claridad.
      var enFlota = flotaMapa.some(function (t) {
        return String(t.codTren || '').replace(/^0+/, '') === num;
      });
      if (msg) {
        msg.textContent = enFlota
          ? ('Tren ' + num + ' está en flota pero oculto por el filtro actual.')
          : ('Tren ' + num + ' no está en la flota ahora mismo.');
        msg.className = 'err';
      }
      return false;
    }
    var map = window._mapaLeaflet;
    if (!map) return false;

    function abrirPopup() {
      try { marker.openPopup(); } catch (_) {}
      if (msg) {
        msg.textContent = 'Tren ' + num + ' ubicado.';
        msg.className = '';
      }
    }

    var clusterGroup = window._mapaClusterGroup;
    // Con MarkerCluster hasLayer a veces falla si el punto está agrupado:
    // zoomToShowLayer es la vía fiable.
    if (clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function') {
      try {
        clusterGroup.zoomToShowLayer(marker, abrirPopup);
        return true;
      } catch (_) {}
    }

    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12));
    setTimeout(abrirPopup, 80);
    return true;
  }

  var ORM_FACILITY_URL_ = 'https://api.openrailwaymap.org/v2/facility';
  var mapaEnclaveMarker_ = null;
  var mapaSugTimer_ = null;
  var mapaSugReq_ = 0;
  var mapaSugCache_ = [];

  function ocultarSugerenciasMapa_() {
    var box = document.getElementById('mapa-busqueda-sugerencias');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    mapaSugCache_ = [];
  }

  function etiquetaTipoEnclave_(railway) {
    var t = String(railway || '').toLowerCase();
    if (t === 'station') return 'Estación';
    if (t === 'halt') return 'Apeadero';
    if (t === 'service_station') return 'Estación de servicio';
    if (t === 'yard') return 'Playa / apartadero';
    if (t === 'junction') return 'Bifurcación';
    if (t === 'crossover') return 'Cruce';
    if (t === 'tram_stop') return 'Parada tranvía';
    if (t === 'subway_entrance') return 'Acceso metro';
    return t ? t.replace(/_/g, ' ') : 'Enclave';
  }

  function enEspanaMapa_(lat, lon) {
    return lat >= 35.9 && lat <= 43.9 && lon >= -9.6 && lon <= 4.6;
  }

  function ordenarEnclavesEspana_(list) {
    return (list || []).filter(function (a) {
      return enEspanaMapa_(Number(a.latitude), Number(a.longitude));
    }).sort(function (a, b) {
      var aAdif = /adif/i.test(String(a.operator || a.owner || '')) ? 1 : 0;
      var bAdif = /adif/i.test(String(b.operator || b.owner || '')) ? 1 : 0;
      if (bAdif !== aAdif) return bAdif - aAdif;
      return Number(b.rank || 0) - Number(a.rank || 0);
    });
  }

  async function buscarEnclavesOrm_(q, limit) {
    var term = String(q || '').trim();
    if (term.length < 2) return [];
    // Pedimos más y filtramos a España (la API ORM no tiene país).
    var url = ORM_FACILITY_URL_ + '?q=' + encodeURIComponent(term) +
      '&limit=' + encodeURIComponent(String(Math.max(40, (limit || 12) * 4)));
    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('orm_http_' + r.status);
    var data = await r.json();
    if (!Array.isArray(data)) return [];
    return ordenarEnclavesEspana_(data).filter(function (x) {
      return isFinite(Number(x.latitude)) && isFinite(Number(x.longitude)) && x.name;
    }).slice(0, limit || 12);
  }

  function pintarSugerenciasEnclaves_(items) {
    var box = document.getElementById('mapa-busqueda-sugerencias');
    if (!box) return;
    mapaSugCache_ = items || [];
    if (!mapaSugCache_.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.innerHTML = mapaSugCache_.map(function (it, idx) {
      var op = String(it.operator || it.owner || '').trim() || '—';
      var tipo = etiquetaTipoEnclave_(it.railway);
      var ref = String(it.ref || it['railway:ref'] || it.uic_ref || '').trim();
      var meta = tipo + ' · ' + op + (ref ? (' · ' + ref) : '');
      return '<button type="button" class="mapa-sug-item" role="option" data-sug-idx="' + idx + '">' +
        '<b>' + esc(it.name) + '</b><span>' + esc(meta) + '</span></button>';
    }).join('');
    box.hidden = false;
  }

  function ubicarEnclaveEnMapa_(item) {
    var map = window._mapaLeaflet;
    var msg = document.getElementById('mapa-busqueda-msg');
    if (!map || !item) return false;
    var lat = Number(item.latitude);
    var lon = Number(item.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return false;
    ocultarSugerenciasMapa_();
    // Sin marcador: solo centrar el mapa en el enclave.
    if (mapaEnclaveMarker_) {
      try { map.removeLayer(mapaEnclaveMarker_); } catch (_) {}
      mapaEnclaveMarker_ = null;
    }
    map.setView([lat, lon], Math.max(map.getZoom(), 15));
    var input = document.getElementById('mapa-buscar-input');
    if (input) input.value = item.name;
    if (msg) {
      var tipo = etiquetaTipoEnclave_(item.railway);
      var op = String(item.operator || item.owner || '').trim();
      msg.textContent = item.name + (tipo || op ? (' · ' + tipo + (op ? (' · ' + op) : '')) : '');
      msg.className = '';
    }
    return true;
  }

  async function buscarEnclaveEnMapa_(qForzado) {
    var input = document.getElementById('mapa-buscar-input');
    var msg = document.getElementById('mapa-busqueda-msg');
    var q = String(qForzado != null ? qForzado : (input && input.value) || '').trim();
    if (q.length < 2) {
      if (msg) {
        msg.textContent = 'Escribe al menos 2 caracteres de la estación o enclave.';
        msg.className = 'err';
      }
      return false;
    }
    if (msg) {
      msg.textContent = 'Buscando en OpenRailwayMap…';
      msg.className = '';
    }
    try {
      var items = await buscarEnclavesOrm_(q, 12);
      if (!items.length) {
        ocultarSugerenciasMapa_();
        if (msg) {
          msg.textContent = 'Sin enclaves en España para «' + q + '».';
          msg.className = 'err';
        }
        return false;
      }
      // Si hay una coincidencia clara en España/Adif, ubicarla; si no, mostrar lista.
      var top = items[0];
      var qNorm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var topNorm = String(top.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (items.length === 1 || topNorm.indexOf(qNorm) === 0 || qNorm.indexOf(topNorm) === 0) {
        return ubicarEnclaveEnMapa_(top);
      }
      pintarSugerenciasEnclaves_(items);
      if (msg) {
        msg.textContent = items.length + ' enclaves · elige uno.';
        msg.className = '';
      }
      return true;
    } catch (e) {
      if (msg) {
        msg.textContent = 'No se pudo consultar OpenRailwayMap.';
        msg.className = 'err';
      }
      return false;
    }
  }

  function buscarEnMapa_() {
    var input = document.getElementById('mapa-buscar-input');
    var raw = String((input && input.value) || '').trim();
    if (!raw) {
      var msg = document.getElementById('mapa-busqueda-msg');
      if (msg) {
        msg.textContent = 'Introduce un número de tren o el nombre de una estación.';
        msg.className = 'err';
      }
      return;
    }
    // Solo dígitos (y espacios) → tren; texto → enclave ORM.
    if (/^[\d\s]+$/.test(raw)) {
      buscarTrenEnMapa(raw);
      return;
    }
    buscarEnclaveEnMapa_(raw);
  }

  function programarSugerenciasMapa_() {
    var input = document.getElementById('mapa-buscar-input');
    var raw = String((input && input.value) || '').trim();
    if (mapaSugTimer_) clearTimeout(mapaSugTimer_);
    if (!raw || /^[\d\s]+$/.test(raw) || raw.length < 2) {
      ocultarSugerenciasMapa_();
      return;
    }
    var req = ++mapaSugReq_;
    mapaSugTimer_ = setTimeout(async function () {
      try {
        var items = await buscarEnclavesOrm_(raw, 10);
        if (req !== mapaSugReq_) return;
        pintarSugerenciasEnclaves_(items);
      } catch (_) {
        if (req !== mapaSugReq_) return;
        ocultarSugerenciasMapa_();
      }
    }, 320);
  }

  function abrirMapaTren(tren) {
    var num = String(tren || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!num) { toast('No hay número de tren.'); return; }
    go('mapa');
    var intentos = 0;
    (function esperarMapa() {
      intentos++;
      if (window._mapaLeaflet && mapIndex[num]) {
        buscarTrenEnMapa(num);
        return;
      }
      if (intentos === 1 || intentos === 8) {
        cargarFlotaMapa({ fit: false }).catch(function () {});
      }
      if (intentos < 30) setTimeout(esperarMapa, 150);
      else toast('No se pudo ubicar el tren en la flota.');
    })();
  }
  function renderFichaMarchaInstantanea_(body, ft, tren) {
    if (!body) return;
    ft = ft || {};
    var demora = Number(ft.retrasoNum || 0);
    body.innerHTML =
      '<div class="marcha-head"><strong>📡 Marcha en vivo</strong><span>Cargando…</span></div>' +
      '<div class="marcha-kpis"><span>' +
      (demora > 0 ? ('⏱ +' + demora + ' min') : '✅ En hora') +
      '</span><span>' + esc(ft.estSig ? ('Próxima: ' + ft.estSig +
        (ft.horaEstSig ? ' · ' + ft.horaEstSig + 'h' : '')) : 'Consultando paradas…') +
      '</span></div>' +
      '<div class="marcha-empty marcha-loading">Consultando paradas GTFS en vivo…</div>';
  }

  function pintarCabeceraFichaMapa_(ft, tren) {
    var titulo = document.getElementById('mapa-ficha-titulo');
    var sub = document.getElementById('mapa-ficha-subtitulo');
    var info = document.getElementById('mapa-ficha-info');
    ft = ft || {};
    var cod = String(ft.codTren || tren || '');
    var producto = String(ft.producto || ft.modo || 'Tren');
    if (titulo) titulo.textContent = producto + ' · ' + cod;
    if (sub) {
      sub.textContent = (ft.origen || '—') + ' → ' + (ft.destino || '—');
    }
    if (!info) return;
    var retrasoHtml = Number(ft.retrasoNum) > 0
      ? '<span style="color:#ef4444;font-weight:900;">+' + ft.retrasoNum + ' min</span>'
      : '<span style="color:var(--green);font-weight:900;">En hora</span>';
    var hO = ft.hOrig ? ' (' + ft.hOrig + 'h)' : '';
    var hD = ft.hDest ? ' (' + ft.hDest + 'h)' : '';
    if (ft.hDestPrevista) hD += ' · prev. ' + ft.hDestPrevista + 'h';
    var ruta = (ft.origen || '—') + hO + ' → ' + (ft.destino || '—') + hD;
    var prox = ft.estSig
      ? '<div class="mapa-popup-prox">Próxima: ' + esc(ft.estSig) +
        (ft.horaEstSig ? ' · ' + esc(ft.horaEstSig) + 'h' : '') + '</div>'
      : '';
    info.innerHTML =
      '<div class="mapa-popup-msg">' + esc(ruta) +
      (ft.mat ? '<br><span class="mapa-popup-mat">Mat. ' + esc(ft.mat) + '</span>' : '') +
      '</div>' + prox +
      '<div class="mapa-popup-delay">⏱ ' + retrasoHtml + '</div>' +
      '<div class="mapa-popup-actions">' +
      (puedeEscribir
        ? '<button class="mapa-popup-btn mapa-popup-btn--aviso" type="button" data-aviso-mapa-tren="' +
          esc(cod) + '" data-aviso-mapa-trip="' + esc(String(ft.tripId || '')) +
          '">💬 Generar aviso</button>'
        : '') + '</div>';
  }

  async function marchaDesdePopup(tren, trip) {
    var sheet = document.getElementById('mapa-marcha-sheet');
    var body = document.getElementById('mapa-marcha-body');
    if (!sheet || !body) return;
    // Un solo panel: cierra el popup Leaflet para no tapar la ficha.
    try {
      if (window._mapaLeaflet) window._mapaLeaflet.closePopup();
    } catch (_) {}
    sheet.hidden = false;
    var ft = encontrarTrenFlota_(tren) || {};
    if (!ft.codTren) ft.codTren = String(tren || '');
    if (trip && !ft.tripId) ft.tripId = String(trip);
    pintarCabeceraFichaMapa_(ft, tren);
    renderFichaMarchaInstantanea_(body, ft, tren);
    try {
      var data = await call('marcha', {
        codTren: String(tren || ''),
        tripId: String(trip || ft.tripId || ''),
        modo: String(ft.modo || ''),
        region: regionMarchaActual_()
      });
      var m = data.marcha || {};
      // Actualiza cabecera con datos de marcha si llegan O/D/horas.
      if (m.hOrig) ft.hOrig = m.hOrig;
      if (m.hDest) ft.hDest = m.hDest;
      if (m.origen) ft.origen = m.origen;
      if (m.destino) ft.destino = m.destino;
      if (m.hDestPrevista) ft.hDestPrevista = m.hDestPrevista;
      if (m.stopActualNombre) ft.estSig = m.stopActualNombre;
      if (typeof m.retrasoMin === 'number') ft.retrasoNum = m.retrasoMin;
      pintarCabeceraFichaMapa_(ft, tren);
      renderMarcha(body, m);
      if (body.querySelector('.marcha-source')) {
        body.querySelector('.marcha-source').textContent =
          'Fuente: Renfe GTFS-RT (rápida · mapa)';
      }
      var marker = mapIndex[String(tren || '').replace(/^0+/, '')];
      if (marker && marker.options && marker.options._flotaTren) {
        var fto = marker.options._flotaTren;
        if (m.hOrig) fto.hOrig = m.hOrig;
        if (m.hDest) fto.hDest = m.hDest;
        if (m.origen) fto.origen = m.origen;
        if (m.destino) fto.destino = m.destino;
        if (m.hDestPrevista) fto.hDestPrevista = m.hDestPrevista;
        if (m.stopActualNombre && !fto.estSig) fto.estSig = m.stopActualNombre;
        if (marker.getPopup()) marker.getPopup().setContent(construirPopupMapaHtml_(fto));
      }
    } catch (e) {
      var err = document.createElement('div');
      err.className = 'marcha-empty error-text';
      err.textContent = String(e.message || e);
      var loading = body.querySelector('.marcha-loading');
      if (loading) loading.replaceWith(err);
      else body.appendChild(err);
    }
  }

  function cerrarMarchaMapa() {
    var sheet = document.getElementById('mapa-marcha-sheet');
    if (sheet) sheet.hidden = true;
  }

  function enriquecerTrenMapaDesdeRadar_(tren) {
    var out = Object.assign({}, tren || {});
    var cod = String(out.codTren || '').replace(/^0+/, '');
    for (var i = 0; i < radar.length; i++) {
      var a = radar[i];
      if (String(a.codTren || '').replace(/^0+/, '') !== cod) continue;
      if (a.hOrig && !out.hOrig) out.hOrig = String(a.hOrig);
      if (a.hDest && !out.hDest) out.hDest = String(a.hDest);
      if (a.nombreOrig && (!out.origen || out.origen === out.codOrigen)) out.origen = a.nombreOrig;
      if (a.nombreDest && (!out.destino || out.destino === out.codDestino)) out.destino = a.nombreDest;
      if (a.mat && !out.mat) out.mat = a.mat;
      if (a.matLabel) out.matLabel = a.matLabel;
      if (a.mensaje) out.mensaje = a.mensaje;
      break;
    }
    return out;
  }

  function construirPopupMapaHtml_(a) {
    var retrasoHtml = Number(a.retrasoNum) > 0
      ? '<span style="color:#ef4444;font-weight:900;">+' + a.retrasoNum + ' min</span>'
      : '<span style="color:#008000;font-weight:900;">En hora</span>';
    var hO = a.hOrig ? ' (' + a.hOrig + 'h)' : '';
    var hD = a.hDest ? ' (' + a.hDest + 'h)' : '';
    if (a.hDestPrevista) hD += ' · prev. ' + a.hDestPrevista + 'h';
    var ruta = (a.origen || '—') + hO + ' → ' + (a.destino || '—') + hD;
    var prox = '';
    if (a.estSig) {
      prox = '<div class="mapa-popup-prox">Próxima: ' + esc(a.estSig) +
        (a.horaEstSig ? ' · ' + esc(a.horaEstSig) + 'h' : '') + '</div>';
    }
    var horasHint = (!a.hOrig && !a.hDest)
      ? '<div class="mapa-popup-hint">Horas programadas: toca el tren o abre marcha para completarlas</div>'
      : '';
    return '<div class="mapa-popup">' +
      '<div class="mapa-popup-linea">' + esc(String(a.producto || a.modo || '') + ' · ' + a.codTren) + '</div>' +
      '<div class="mapa-popup-msg">' + esc(ruta) +
      (a.mat ? '<br><span class="mapa-popup-mat">Mat. ' + esc(a.mat) + '</span>' : '') +
      '</div>' + prox +
      '<div class="mapa-popup-delay">⏱ ' + retrasoHtml + '</div>' + horasHint +
      '<div class="mapa-popup-actions">' +
      '<button class="mapa-popup-btn" type="button" data-marcha-tren="' + esc(String(a.codTren)) +
        '" data-marcha-trip="' + esc(String(a.tripId || '')) + '">📡 Marcha</button>' +
      (puedeEscribir
        ? '<button class="mapa-popup-btn mapa-popup-btn--aviso" type="button" data-aviso-mapa-tren="' +
          esc(String(a.codTren)) + '" data-aviso-mapa-trip="' + esc(String(a.tripId || '')) +
          '">💬 Generar aviso</button>'
        : '') +
      '</div></div>';
  }

  async function enriquecerPopupMapaAsync_(marker) {
    if (!marker || !marker.options || !marker.options._flotaTren) return;
    var ft = marker.options._flotaTren;
    if (ft.hOrig && ft.hDest) return;
    var tren = String(ft.codTren || '').replace(/^0+/, '');
    if (!tren || ft._horasFetching) return;
    ft._horasFetching = true;
    try {
      var data = await call('tren_manual', { codTren: tren });
      if (data && data.encontrado && data.datos) {
        var d = data.datos;
        if (d.hOrig) ft.hOrig = d.hOrig;
        if (d.hDest) ft.hDest = d.hDest;
        if (d.origen) ft.origen = d.origen;
        if (d.destino) ft.destino = d.destino;
        if (d.tipo) ft.tipoAviso = d.tipo;
        if (marker.getPopup() && marker.isPopupOpen && marker.isPopupOpen()) {
          marker.getPopup().setContent(construirPopupMapaHtml_(ft));
        }
      }
    } catch (_) {
      // Silencioso: el aviso/marcha pueden completar después.
    } finally {
      ft._horasFetching = false;
    }
  }

  function encontrarTrenFlota_(tren) {
    var t = String(tren || '').replace(/^0+/, '');
    var marker = mapIndex[t];
    if (marker && marker.options && marker.options._flotaTren) return marker.options._flotaTren;
    for (var i = 0; i < flotaMapa.length; i++) {
      if (String(flotaMapa[i].codTren || '').replace(/^0+/, '') === t) {
        return enriquecerTrenMapaDesdeRadar_(flotaMapa[i]);
      }
    }
    return null;
  }

  async function avisoDesdeMapa(tren, trip) {
    if (!exigirEscritura_('Generar avisos')) return;
    var ft = encontrarTrenFlota_(tren) || {};
    var alertaRadar = encontrarAlertaAviso(tren, trip);
    if (alertaRadar) {
      abrirAvisoDesdeAlerta(alertaRadar);
      return;
    }
    // Completar horas/O-D si faltan (Excel / biblia vía tren_manual).
    if ((!ft.hOrig || !ft.hDest || !ft.origen || !ft.destino) && tren) {
      try {
        var data = await call('tren_manual', { codTren: String(tren).replace(/^0+/, '') });
        if (data && data.encontrado && data.datos) {
          var d = data.datos;
          ft = Object.assign({}, ft, {
            codTren: d.tren || tren,
            origen: d.origen || ft.origen,
            destino: d.destino || ft.destino,
            hOrig: d.hOrig || ft.hOrig,
            hDest: d.hDest || ft.hDest,
            tipoAviso: d.tipo || ft.tipoAviso
          });
        }
      } catch (_) {}
    }
    var pseudo = {
      codTren: ft.codTren || tren,
      tripId: trip || ft.tripId || '',
      nombreOrig: ft.origen || 'ORIGEN',
      nombreDest: ft.destino || 'DESTINO',
      hOrig: ft.hOrig || '',
      hDest: ft.hDest || '',
      retrasoNum: Number(ft.retrasoNum || 0),
      mat: ft.mat || '',
      matLabel: ft.matLabel || '',
      linea: (ft.producto || '') + ' | ' + (ft.origen || 'ORIGEN') + ' ➞ ' + (ft.destino || 'DESTINO'),
      mensaje: Number(ft.retrasoNum) > 0
        ? ('Circula con ' + ft.retrasoNum + ' minutos de demora.' +
          (ft.estSig ? (' En ruta hacia ' + ft.estSig +
            (ft.horaEstSig ? (' (' + ft.horaEstSig + 'h)') : '') + '.') : ''))
        : 'Circula sin demora reseñable.'
    };
    abrirAvisoDesdeAlerta(pseudo);
  }

  function mostrarVersionApp_() {
    document.querySelectorAll('[data-turnio-version]').forEach(function (el) {
      el.textContent = APP_VERSION;
    });
  }

  async function init() {
    if (!api) {
      setStatus('error', 'Falta TURNIO_EXTERNAL_API (turnio-config.js). Build ' + FRONT_BUILD + '.');
      return;
    }
    if (!supabase) {
      setStatus('error',
        'Supabase no cargó (¿caché antigua o CDN bloqueada?). Build ' + FRONT_BUILD +
        '. En Ajustes → Obtener nueva actualización.');
      return;
    }

    var healthUrl = api + '/api/health';
    try {
      var r = await fetch(healthUrl, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
      var raw = await r.text();
      var d = null;
      try { d = JSON.parse(raw); } catch (_) {
        setStatus('error',
          'Health HTTP ' + r.status + ' · respuesta no JSON · ' + truncDiag_(raw) +
          ' · ' + healthUrl + ' · build ' + FRONT_BUILD);
        return;
      }
      if (!r.ok || !d || !d.ok || !d.configured) {
        setStatus('error',
          'Health HTTP ' + r.status +
          ' · ok=' + String(d && d.ok) +
          ' · configured=' + String(d && d.configured) +
          ' · ' + truncDiag_(raw) +
          ' · ' + healthUrl + ' · build ' + FRONT_BUILD);
        return;
      }
      pintarLoginMantenimiento_(d && d.mantenimiento);
    } catch (err) {
      setStatus('error',
        'Health falló: ' + String((err && err.message) || err) +
        ' · ' + healthUrl + ' · build ' + FRONT_BUILD);
      return;
    }

    setStatus('ready', '');
    try {
      var auth = await supabase.auth.getUser();
      if (auth && auth.data && auth.data.user) {
        sessionEmail = String(auth.data.user.email || '').trim().toLowerCase();
        // Sesión TURNIO = JWT Supabase + perfil activo (sin token GAS / PERSONAS).
        var x = await call('sesion');
        if (!x || !x.persona) throw new Error('No se pudo cargar el perfil TURNIO.');
        localStorage.setItem(sessionKey, 'supabase');
        showApp(x.persona);
        return;
      }
      loginForm.hidden = false;
    } catch (err) {
      loginForm.hidden = false;
      var msg = String((err && err.message) || err);
      if (/mantenimiento/i.test(msg)) {
        pintarLoginMantenimiento_({ on: true, mensaje: msg });
        setStatus('error', msg);
      } else {
        setStatus('error',
          'API lista, pero la sesión falló: ' + msg +
          ' · build ' + FRONT_BUILD);
      }
    }
  }

  function truncDiag_(texto) {
    var t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!t) return '(vacío)';
    // Nunca volcar tokens/secretos aunque el backend se equivoque.
    t = t.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
      .replace(/sb_publishable_[A-Za-z0-9_]+/gi, 'sb_publishable_***')
      .replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, 'jwt***');
    return t.length > 140 ? (t.slice(0, 140) + '…') : t;
  }

  async function entrarTrasAuth_(email) {
    var d = await call('iniciar_pruebas', { email: email });
    if (!d || !d.persona) throw new Error('No se ha creado la sesión.');
    localStorage.setItem(sessionKey, d.token || 'supabase');
    setStatus('ready', 'Sesión iniciada.');
    showApp(d.persona);
  }

  document.getElementById('btn-entrar-clave').addEventListener('click', async function () {
    var email = String(document.getElementById('email').value || '').trim().toLowerCase();
    var pass = String(document.getElementById('password').value || '');
    if (!email) { setStatus('error', 'Introduce tu correo autorizado.'); return; }
    if (!pass) { setStatus('error', 'Introduce tu clave de acceso.'); return; }
    if (pass.length < 8) { setStatus('error', 'La clave debe tener al menos 8 caracteres.'); return; }
    setStatus('pending', 'Validando clave...');
    try {
      var login = await supabase.auth.signInWithPassword({ email: email, password: pass });
      if (login.error) throw login.error;
      await entrarTrasAuth_(email);
    } catch (err) {
      setStatus('error', normalizarErrorClave_(err));
    }
  });

  document.getElementById('btn-recibir-otp').addEventListener('click', async function () {
    var email = String(document.getElementById('email').value || '').trim().toLowerCase();
    if (!email) { setStatus('error', 'Introduce tu correo autorizado.'); return; }
    setStatus('pending', 'Enviando código...');
    try {
      var envio = await supabase.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
      if (envio.error) throw envio.error;
      document.getElementById('otp-wrap').hidden = false;
      document.getElementById('otp').focus();
      setStatus('ready', 'Código enviado. Caduca en 15 minutos.');
    } catch (err) {
      setStatus('error', normalizarErrorOtp_(err));
    }
  });

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = String(document.getElementById('email').value || '').trim().toLowerCase();
    var pass = String(document.getElementById('password').value || '');
    var otpWrap = document.getElementById('otp-wrap');
    var codigo = String(document.getElementById('otp').value || '').replace(/\D/g, '');
    // Enter en clave: preferir password si hay clave y aún no hay OTP visible/completo.
    if (pass && (!otpWrap || otpWrap.hidden || !codigo)) {
      document.getElementById('btn-entrar-clave').click();
      return;
    }
    setStatus('pending', 'Validando acceso...');
    try {
      var verificado = await supabase.auth.verifyOtp({
        email: email,
        token: codigo,
        type: 'email'
      });
      if (verificado.error) throw verificado.error;
      await entrarTrasAuth_(email);
    } catch (err) {
      setStatus('error', err.message);
    }
  });

  document.getElementById('btn-cambiar-email').addEventListener('click', function () {
    document.getElementById('otp-wrap').hidden = true;
    document.getElementById('otp').value = '';
    var pass = document.getElementById('password');
    if (pass) pass.value = '';
    setStatus('ready', 'Introduce el correo autorizado.');
    document.getElementById('email').focus();
  });

  var solicitudForm = document.getElementById('solicitud-form');
  function mostrarFormSolicitud_(on) {
    loginForm.hidden = !!on;
    if (solicitudForm) solicitudForm.hidden = !on;
  }
  var btnAbrirSol = document.getElementById('btn-abrir-solicitud');
  if (btnAbrirSol) {
    btnAbrirSol.addEventListener('click', function () {
      var em = document.getElementById('solicitud-email');
      var loginEm = document.getElementById('email');
      if (em && loginEm && loginEm.value && !em.value) em.value = loginEm.value;
      mostrarFormSolicitud_(true);
      setStatus('ready', 'Completa la solicitud de acceso.');
      if (em) em.focus();
    });
  }
  var btnCancelSol = document.getElementById('btn-cancelar-solicitud');
  if (btnCancelSol) {
    btnCancelSol.addEventListener('click', function () {
      mostrarFormSolicitud_(false);
      setStatus('ready', 'Introduce el correo autorizado.');
    });
  }
  if (solicitudForm) {
    solicitudForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var email = String(document.getElementById('solicitud-email').value || '').trim().toLowerCase();
      var nombre = String(document.getElementById('solicitud-nombre').value || '').trim();
      var centro = String(document.getElementById('solicitud-centro').value || '').trim();
      var motivo = String(document.getElementById('solicitud-motivo').value || '').trim();
      var website = String(document.getElementById('solicitud-website').value || '');
      var btn = document.getElementById('btn-enviar-solicitud');
      if (!email || !nombre || !centro || motivo.length < 20) {
        setStatus('error', motivo.length < 20
          ? 'El motivo debe tener al menos 20 caracteres.'
          : 'Completa correo, nombre, centro y motivo.');
        return;
      }
      if (btn) btn.disabled = true;
      setStatus('pending', 'Enviando solicitud…');
      try {
        var r = await fetch(api + '/api/turnio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            accion: 'solicitud_acceso',
            email: email,
            nombre: nombre,
            centro: centro,
            motivo: motivo,
            website: website,
            clientId: clientId()
          })
        });
        var d;
        try { d = await r.json(); } catch (_) { throw new Error('Respuesta no válida del servicio.'); }
        if (!r.ok || d.ok === false) {
          throw new Error(mensajeErrorApi_(d) || 'No se pudo enviar la solicitud.');
        }
        solicitudForm.reset();
        mostrarFormSolicitud_(false);
        setStatus('ready',
          'Solicitud enviada. Te avisaremos por correo cuando se revise. Mientras, puedes volver a intentar entrar si ya tenías acceso.');
      } catch (err) {
        setStatus('error', String(err.message || err));
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function normalizarErrorOtp_(err) {
    var texto = String((err && err.message) || err || 'No se pudo completar el acceso.');
    if (/rate limit|60 seconds|too many/i.test(texto)) return 'Espera un minuto antes de solicitar otro código.';
    if (/expired|invalid|token/i.test(texto)) return 'El código no es válido o ha caducado. Solicita uno nuevo.';
    return texto;
  }

  function normalizarErrorClave_(err) {
    var texto = String((err && err.message) || err || 'No se pudo completar el acceso.');
    if (/invalid login|invalid credentials|email not confirmed|invalid_grant/i.test(texto)) {
      return 'Correo o clave incorrectos. Si aún no tienes clave, entra con OTP y defínela en Administración.';
    }
    if (/rate limit|too many/i.test(texto)) return 'Demasiados intentos. Espera un minuto.';
    return texto;
  }

  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go); });
  });
  ['btn-refrescar-clima', 'btn-refrescar-clima-prev'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        cargarClimaBienvenida_(true);
      });
    }
  });
  (function wireHomeRetrasosRadar_() {
    var home = document.getElementById('home-radar');
    if (!home) return;
    function activar(el) {
      if (!el) return;
      irATarjetaRadarDesdeHome_(el.getAttribute('data-radar-tren'));
    }
    home.addEventListener('click', function (e) {
      var item = e.target.closest('.home-retraso-item');
      if (!item || !home.contains(item)) return;
      e.preventDefault();
      e.stopPropagation();
      activar(item);
    });
    home.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var item = e.target.closest('.home-retraso-item');
      if (!item || !home.contains(item)) return;
      e.preventDefault();
      activar(item);
    });
  })();
  var btnRed = document.getElementById('btn-estado-red');
  if (btnRed) btnRed.addEventListener('click', toggleTeletipoRed);
  var btnRefAvisos = document.getElementById('btn-refrescar-avisos');
  if (btnRefAvisos) btnRefAvisos.addEventListener('click', function () { cargarPantallaAvisos(true); });
  document.querySelectorAll('[data-coming]').forEach(function (b) {
    b.addEventListener('click', function () {
      toast(b.dataset.coming + ' se incorporará en el siguiente bloque.');
    });
  });
  wirePantallasUi_();
  wireKmsUi_();
  document.querySelectorAll('.filter').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.mode;
      document.querySelectorAll('.filter').forEach(function (x) {
        x.classList.toggle('active', x === b);
      });
      loadRadar();
    });
  });
  document.getElementById('btn-regiones').addEventListener('click', abrirModalRegiones);
  document.getElementById('btn-cerrar-regiones').addEventListener('click', cerrarModalRegiones);
  document.getElementById('btn-cancelar-regiones').addEventListener('click', cerrarModalRegiones);
  document.getElementById('btn-aplicar-regiones').addEventListener('click', aplicarModalRegiones);
  document.getElementById('modal-regiones').addEventListener('click', function (ev) {
    if (ev.target === document.getElementById('modal-regiones')) cerrarModalRegiones();
  });
  document.getElementById('region-modal-list').addEventListener('change', function (ev) {
    var inp = ev.target;
    if (!inp || inp.type !== 'checkbox') return;
    onToggleRegionModalCheck_(inp);
  });
  // Compat: si algo cambia el select oculto, respeta el valor.
  document.getElementById('region').addEventListener('change', function () {
    var v = document.getElementById('region').value || 'andalucia';
    setRegionesRadar(String(v).split(/[+ ,]+/));
  });
  regionesSeleccionadas = leerRegionesGuardadas_();
  pintarResumenRegiones_();
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('logout').addEventListener('click', function () {
    cerrarSesionPruebas_();
  });

  // --- Menú flotante FAB (⚡), mismo patrón que GAS producción ---
  var fabAbierto_ = false;

  function mostrarFab_(on) {
    var box = document.getElementById('fab-container');
    if (!box) return;
    if (!on) {
      if (fabAbierto_) toggleFAB_(false);
      box.hidden = true;
      return;
    }
    box.hidden = false;
  }

  function fabSnakeItemVisible_(el) {
    if (!el || el.hidden) return false;
    var st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return el.offsetParent !== null || st.position === 'fixed';
  }

  function layoutFabRail_(menu) {
    if (!menu) return;
    var items = Array.prototype.slice.call(menu.querySelectorAll('.fab-snake-item')).filter(fabSnakeItemVisible_);
    items.forEach(function (el, i) {
      el.style.setProperty('--fab-delay', (i * 0.05) + 's');
    });
  }

  function limpiarFabRail_(menu) {
    if (!menu) return;
    menu.querySelectorAll('.fab-snake-item').forEach(function (el) {
      el.style.removeProperty('--fab-delay');
    });
  }

  function toggleFAB_(force) {
    var menu = document.getElementById('fab-menu');
    var main = document.getElementById('fab-main');
    var icon = document.getElementById('fab-icon');
    var overlay = document.getElementById('fab-overlay');
    if (!menu || !main || !icon || !overlay) return;
    fabAbierto_ = typeof force === 'boolean' ? !!force : !fabAbierto_;
    if (fabAbierto_) {
      menu.hidden = false;
      menu.style.display = 'flex';
      limpiarFabRail_(menu);
      menu.classList.remove('fab-rail-open');
      void menu.offsetWidth;
      layoutFabRail_(menu);
      menu.classList.add('fab-rail-open');
      overlay.hidden = false;
      main.style.background = 'linear-gradient(145deg, #1e3a5f, #4338ca)';
      main.classList.remove('fab-main-bump');
      void main.offsetWidth;
      main.classList.add('fab-main-bump');
      main.setAttribute('aria-expanded', 'true');
      icon.textContent = '✕';
    } else {
      menu.classList.remove('fab-rail-open');
      limpiarFabRail_(menu);
      menu.hidden = true;
      menu.style.display = 'none';
      overlay.hidden = true;
      main.classList.remove('fab-main-bump');
      main.style.background = 'linear-gradient(145deg, #3b82f6, #6366f1)';
      main.setAttribute('aria-expanded', 'false');
      icon.textContent = '⚡';
    }
  }

  function accionFAB_(tipo) {
    toggleFAB_(false);
    if (tipo === 'radar') go('radar');
    else if (tipo === 'mapa') go('mapa');
    else if (tipo === 'mallas') go('mallas');
    else if (tipo === 'trafico') go('trafico');
    else if (tipo === 'aviso') abrirAvisoManual();
    else if (tipo === 'ayuda') abrirAyudaApp_();
    else if (tipo === 'logout') cerrarSesionPruebas_();
  }

  function abrirAyudaApp_() {
    var ov = document.getElementById('app-help-overlay');
    if (ov) ov.hidden = false;
  }
  function cerrarAyudaApp_() {
    var ov = document.getElementById('app-help-overlay');
    if (ov) ov.hidden = true;
  }

  function cerrarSesionPruebas_() {
    setVigilanteState(false, true);
    if (intervaloAutoRadar) {
      clearInterval(intervaloAutoRadar);
      intervaloAutoRadar = null;
    }
    if (fabAbierto_) toggleFAB_(false);
    mostrarFab_(false);
    localStorage.removeItem(sessionKey);
    if (supabase) supabase.auth.signOut();
    appShell.hidden = true;
    nav.hidden = true;
    loginShell.hidden = false;
    loginForm.hidden = false;
    toast('Sesión de pruebas cerrada.');
  }

  var fabMain = document.getElementById('fab-main');
  if (fabMain) fabMain.addEventListener('click', function () { toggleFAB_(); });
  var fabOverlay = document.getElementById('fab-overlay');
  if (fabOverlay) fabOverlay.addEventListener('click', function () { toggleFAB_(false); });
  var fabMenu = document.getElementById('fab-menu');
  if (fabMenu) {
    fabMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-fab]');
      if (!btn || !fabMenu.contains(btn)) return;
      accionFAB_(btn.getAttribute('data-fab'));
    });
  }
  var btnAyudaApp = document.getElementById('btn-ayuda-app');
  if (btnAyudaApp) btnAyudaApp.addEventListener('click', abrirAyudaApp_);
  var btnAyudaHome = document.getElementById('btn-ayuda-home');
  if (btnAyudaHome) btnAyudaHome.addEventListener('click', abrirAyudaApp_);
  var btnAyudaAppCerrar = document.getElementById('btn-ayuda-app-cerrar');
  if (btnAyudaAppCerrar) btnAyudaAppCerrar.addEventListener('click', cerrarAyudaApp_);
  var appAyudaOv = document.getElementById('app-help-overlay');
  if (appAyudaOv) {
    appAyudaOv.addEventListener('click', function (e) {
      if (e.target === appAyudaOv) cerrarAyudaApp_();
    });
  }
  var btnAdminRef = document.getElementById('btn-admin-refrescar');
  if (btnAdminRef) btnAdminRef.addEventListener('click', function () {
    cargarAdminPerfiles_();
    cargarAdminAviso_();
    cargarAdminSugerencias_();
    cargarAdminMantenimiento_();
    cargarAdminAccesos_();
  });
  var btnAdminMant = document.getElementById('btn-admin-mant-toggle');
  if (btnAdminMant) btnAdminMant.addEventListener('click', toggleAdminMantenimiento_);
  var btnAccesosRef = document.getElementById('btn-admin-accesos-refrescar');
  if (btnAccesosRef) btnAccesosRef.addEventListener('click', cargarAdminAccesos_);
  ['admin-accesos-periodo', 'admin-accesos-resultado'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', cargarAdminAccesos_);
  });
  ['admin-accesos-email', 'admin-accesos-ciudad'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', programarCargaAdminAccesos_);
  });
  var accesosResumen = document.getElementById('admin-accesos-resumen');
  if (accesosResumen) {
    accesosResumen.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-acceso-ciudad]');
      if (!chip) return;
      var inp = document.getElementById('admin-accesos-ciudad');
      if (inp) {
        inp.value = chip.getAttribute('data-acceso-ciudad') || '';
        cargarAdminAccesos_();
      }
    });
  }
  var accesosAlertas = document.getElementById('admin-accesos-alertas');
  if (accesosAlertas) {
    accesosAlertas.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-acceso-email]');
      if (!btn) return;
      var inp = document.getElementById('admin-accesos-email');
      var periodo = document.getElementById('admin-accesos-periodo');
      var resultado = document.getElementById('admin-accesos-resultado');
      if (inp) inp.value = btn.getAttribute('data-acceso-email') || '';
      if (periodo) periodo.value = '7d';
      if (resultado) resultado.value = 'ok';
      cargarAdminAccesos_();
    });
  }
  var adminBuscar = document.getElementById('admin-buscar');
  if (adminBuscar) {
    adminBuscar.addEventListener('input', function () { pintarAdminLista_(); });
  }
  var adminFormNuevo = document.getElementById('admin-form-nuevo');
  if (adminFormNuevo) adminFormNuevo.addEventListener('submit', crearAdminPerfil_);
  var adminFormClave = document.getElementById('admin-form-clave');
  if (adminFormClave) adminFormClave.addEventListener('submit', definirAdminClave_);
  var adminNuevoRol = document.getElementById('admin-nuevo-rol');
  if (adminNuevoRol) {
    adminNuevoRol.addEventListener('change', syncAdminNuevoCaduca_);
    syncAdminNuevoCaduca_();
  }
  var btnAvPub = document.getElementById('btn-admin-aviso-publicar');
  if (btnAvPub) btnAvPub.addEventListener('click', publicarAdminAviso_);
  var btnAvOff = document.getElementById('btn-admin-aviso-desactivar');
  if (btnAvOff) btnAvOff.addEventListener('click', desactivarAdminAviso_);
  var btnAvOpenForm = document.getElementById('btn-admin-aviso-abrir-form');
  if (btnAvOpenForm) {
    btnAvOpenForm.addEventListener('click', function () { setAdminAvisoFormVisible_(true); });
  }
  var btnAvCancelForm = document.getElementById('btn-admin-aviso-cancelar-form');
  if (btnAvCancelForm) {
    btnAvCancelForm.addEventListener('click', function () { setAdminAvisoFormVisible_(false); });
  }
  var adminAvLista = document.getElementById('admin-aviso-lista');
  if (adminAvLista) {
    adminAvLista.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btnDel = t.closest('[data-aviso-borrar]');
      if (btnDel) {
        borrarAdminAviso_(btnDel.getAttribute('data-aviso-borrar'));
        return;
      }
      var btnToggle = t.closest('[data-aviso-toggle]');
      if (btnToggle) toggleAvisoItem_(btnToggle);
    });
  }
  var avisosAppLista = document.getElementById('avisos-app-lista');
  if (avisosAppLista) {
    avisosAppLista.addEventListener('click', function (ev) {
      var btnToggle = ev.target && ev.target.closest && ev.target.closest('[data-aviso-toggle]');
      if (btnToggle) toggleAvisoItem_(btnToggle);
    });
  }
  var btnAvAppRef = document.getElementById('btn-refrescar-avisos-app');
  if (btnAvAppRef) btnAvAppRef.addEventListener('click', function () { cargarAvisosApp_(true); });
  var btnAvOk = document.getElementById('btn-aviso-app-aceptar');
  if (btnAvOk) btnAvOk.addEventListener('click', aceptarModalAvisoApp_);
  var btnAvX = document.getElementById('btn-aviso-app-cerrar');
  if (btnAvX) btnAvX.addEventListener('click', function () { cerrarModalAvisoApp_(true); });
  var modalAv = document.getElementById('modal-aviso-app');
  if (modalAv) {
    modalAv.addEventListener('click', function (e) {
      if (e.target === modalAv) cerrarModalAvisoApp_(true);
    });
  }
  var formSug = document.getElementById('form-sugerencia');
  if (formSug) formSug.addEventListener('submit', enviarSugerencia_);
  var adminSugLista = document.getElementById('admin-sugerencia-lista');
  if (adminSugLista) {
    adminSugLista.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btnDel = t.closest('[data-sugerencia-borrar]');
      if (btnDel) {
        borrarAdminSugerencia_(btnDel.getAttribute('data-sugerencia-borrar'));
        return;
      }
      var btnToggle = t.closest('[data-sugerencia-toggle]');
      if (btnToggle) toggleAvisoItem_(btnToggle);
    });
  }
  var btnSugOk = document.getElementById('btn-sugerencia-aceptar');
  if (btnSugOk) btnSugOk.addEventListener('click', aceptarModalSugerencia_);
  var btnSugX = document.getElementById('btn-sugerencia-cerrar');
  if (btnSugX) btnSugX.addEventListener('click', function () { cerrarModalSugerencia_(true); });
  var modalSug = document.getElementById('modal-sugerencia');
  if (modalSug) {
    modalSug.addEventListener('click', function (e) {
      if (e.target === modalSug) cerrarModalSugerencia_(true);
    });
  }
  var btnSolRef = document.getElementById('btn-admin-solicitud-refrescar');
  if (btnSolRef) btnSolRef.addEventListener('click', cargarAdminSolicitudes_);
  var adminSolLista = document.getElementById('admin-solicitud-lista');
  if (adminSolLista) {
    adminSolLista.addEventListener('click', async function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btnToggle = t.closest('[data-solicitud-toggle]');
      if (btnToggle) {
        toggleAvisoItem_(btnToggle);
        return;
      }
      var btnOk = t.closest('[data-solicitud-aprobar]');
      if (btnOk) {
        var idOk = btnOk.getAttribute('data-solicitud-aprobar');
        var sel = adminSolLista.querySelector('[data-solicitud-rol="' + idOk + '"]');
        var role = String(sel && sel.value || 'LECTURA').toUpperCase();
        if (!confirm('¿Aprobar esta solicitud con rol ' + role + '?')) return;
        btnOk.disabled = true;
        try {
          await call('solicitud_acceso_aprobar', { id: idOk, role_code: role });
          toast('Solicitud aprobada. Perfil creado.', 'success');
          cargarAdminSolicitudes_();
          cargarAdminPerfiles_();
        } catch (err) {
          toast(String(err.message || err), 'error');
        } finally {
          btnOk.disabled = false;
        }
        return;
      }
      var btnNo = t.closest('[data-solicitud-rechazar]');
      if (btnNo) {
        var idNo = btnNo.getAttribute('data-solicitud-rechazar');
        if (!confirm('¿Rechazar esta solicitud?')) return;
        btnNo.disabled = true;
        try {
          await call('solicitud_acceso_rechazar', { id: idNo });
          toast('Solicitud rechazada.', 'success');
          cargarAdminSolicitudes_();
        } catch (err) {
          toast(String(err.message || err), 'error');
        } finally {
          btnNo.disabled = false;
        }
      }
    });
  }
  var btnSolModalOk = document.getElementById('btn-solicitud-modal-ok');
  if (btnSolModalOk) btnSolModalOk.addEventListener('click', cerrarModalSolicitudAcceso_);
  var btnSolModalX = document.getElementById('btn-solicitud-modal-cerrar');
  if (btnSolModalX) btnSolModalX.addEventListener('click', cerrarModalSolicitudAcceso_);
  var btnSolModalIr = document.getElementById('btn-solicitud-modal-ir');
  if (btnSolModalIr) {
    btnSolModalIr.addEventListener('click', function () {
      cerrarModalSolicitudAcceso_();
      go('admin');
    });
  }
  var modalSol = document.getElementById('modal-solicitud-acceso');
  if (modalSol) {
    modalSol.addEventListener('click', function (e) {
      if (e.target === modalSol) cerrarModalSolicitudAcceso_();
    });
  }
  var adminListaEl = document.getElementById('admin-lista');
  if (adminListaEl) {
    adminListaEl.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.classList.contains('admin-role')) return;
      var card = t.closest('.admin-row');
      if (!card) return;
      var exp = card.querySelector('.admin-expires');
      if (exp) exp.disabled = String(t.value).toUpperCase() !== 'INVITADO';
    });
    adminListaEl.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var saveBtn = t.closest('[data-admin-save]');
      if (saveBtn) {
        var cardSave = saveBtn.closest('.admin-row');
        if (cardSave) guardarAdminPerfil_(cardSave);
        return;
      }
      var toggle = t.closest('[data-admin-toggle]');
      if (!toggle) return;
      var id = toggle.getAttribute('data-admin-toggle') || '';
      adminExpandidoId_ = adminExpandidoId_ === id ? '' : id;
      pintarAdminLista_();
    });
  }
  document.getElementById('btn-obtener-actualizacion').addEventListener('click', function () {
    if (!confirm('¿Descargar la última versión y reiniciar la app?\n\nTu sesión se mantiene; no hace falta volver a entrar.')) return;
    toast('Obteniendo nueva versión…', 'success');
    document.body.style.opacity = '0.55';
    Promise.resolve()
      .then(function () {
        if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;
        return navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
        });
      })
      .then(function () {
        if (!window.caches || !caches.keys) return;
        return caches.keys().then(function (keys) {
          // Conserva caches de mallas/GTFS; borra el resto (posible SW/PWA antigua).
          return Promise.all(keys.map(function (k) {
            if (/mallas|gtfs|operativa/i.test(k)) return null;
            return caches.delete(k);
          }));
        });
      })
      .catch(function () { /* seguir con reload igual */ })
      .then(function () {
        try {
          var url = new URL(window.location.href);
          url.searchParams.set('_v', String(Date.now()));
          url.searchParams.set('build', FRONT_BUILD);
          url.searchParams.delete('t');
          window.location.replace(url.toString());
        } catch (err) {
          window.location.reload(true);
        }
      });
  });

  /* Atajos Copérnico (mismo patrón que Anthony; solo red Renfe) */
  function fechaCoperPartes_() {
    var n = new Date();
    var dd = String(n.getDate()).padStart(2, '0');
    var mm = String(n.getMonth() + 1).padStart(2, '0');
    var yyyy = n.getFullYear();
    return { dd: dd, mm: mm, yyyy: yyyy, slash: dd + '/' + mm + '/' + yyyy };
  }
  function abrirCopernico_(url) {
    try {
      var w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) toast('Permite ventanas emergentes o ábrelo en red Renfe.', 'error');
      else toast('Abriendo Copérnico…', 'success');
    } catch (err) {
      toast('No se pudo abrir Copérnico en este dispositivo.', 'error');
    }
  }
  function abrirEnlaceExterno_(url, label) {
    try {
      var w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) toast('Permite ventanas emergentes para abrir ' + (label || 'el enlace') + '.', 'error');
      else toast('Abriendo ' + (label || 'enlace') + '…', 'success');
    } catch (err) {
      toast('No se pudo abrir el enlace en este dispositivo.', 'error');
    }
  }
  /* Accesos rápidos Circulación (URLs del portal Anthony) */
  function urlAccesoRapido_(key) {
    switch (String(key || '').toLowerCase()) {
      case 'copernico':
        return 'http://copernico.sir.renfe.es';
      case 'vmt':
      case 'mt':
        return 'http://vmt.sir.renfe.es/vmtGestionTrenesWeb/login.do';
      case 'mol':
        return 'http://mol.sir.renfe.es/MOLWeb/';
      case 'sitra':
        return 'http://ager.circulacion.sso.adif.es/agw/hjagwr15.jsp';
      case 'siges':
        return 'https://portal-empresas.operaciones.adif.es/tsw/SvTswat0?Opcion=C';
      case 'gtrenes':
        return 'http://gtrenes.operaciones.sso.adif.es/gtw/SvGtw000?opcion=0';
      case 'gifo':
        return 'https://portal-empresas.operaciones.adif.es/inc/';
      case 'mon-r':
      case 'monr':
        return 'http://monr.operaciones.sso.adif.es/';
      case 'interesa':
        return 'https://interesa.renfe.es/group/intranet/directorio';
      case 'h24':
        // H24 Power Apps (Anthony)
        return 'https://apps.powerapps.com/play/e/default-7ad7404b-12f9-416e-afc5-c548c328a90b/a/deb6633f-196a-48c7-b3c8-1d263442cacb?tenantId=7ad7404b-12f9-416e-afc5-c548c328a90b';
      case 'sim':
        return 'https://mitweb.sir.renfe.es/CIMA/index.aspx';
      case 'orbita':
      case 'pos-orbita':
      case 'posorbita':
        return 'https://pos-orbita.sir.renfe.es/';
      default:
        return '';
    }
  }
  var homeApps = document.getElementById('home-apps');
  if (homeApps) {
    homeApps.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ext]');
      if (!btn || !homeApps.contains(btn)) return;
      var key = btn.getAttribute('data-ext');
      var url = urlAccesoRapido_(key);
      if (!url) return;
      var label = (btn.querySelector('b') && btn.querySelector('b').textContent) || key;
      abrirEnlaceExterno_(url, label);
    });
  }
  var MERCADOS_SIN_JUSTIFICAR_ = [
    { code: '31', name: 'SP Andalucía', def: true },
    { code: '10', name: 'SP Centro' },
    { code: '30', name: 'SP Este' },
    { code: '38', name: 'SP Galicia' },
    { code: '50', name: 'Rodalies Catalunya' },
    { code: '35', name: 'SP País Vasco' },
    { code: '34', name: 'SP Ámbito Extremadura' },
    // Antiguo listado + los SP/Rodalies del selector (solo etiqueta "Todos los mercados").
    {
      code: '90,0,60,62,61,64,65,68,80,10,31,30,38,50,35,34',
      name: 'Todos los mercados',
      todos: true,
      codeLabel: ''
    }
  ];
  var MERCADO_SIN_JUSTIFICAR_DEFAULT_ = '31';

  function urlSinJustificarMercado_(mercado) {
    var f = fechaCoperPartes_();
    var m = String(mercado || MERCADO_SIN_JUSTIFICAR_DEFAULT_).trim() || MERCADO_SIN_JUSTIFICAR_DEFAULT_;
    return 'http://copernico.sir.renfe.es/copernico/SrvRenfeIncidencias?todo=retsinjustificar' +
      '&fincidencia=01/' + f.mm + '/' + f.yyyy +
      '&fechafin=' + f.slash +
      '&horaIni=0000&horaFin=2359&mercado=' + encodeURIComponent(m).replace(/%2C/g, ',');
  }

  function cerrarModalSinJustificar_() {
    var modal = document.getElementById('modal-sin-justificar');
    if (modal) modal.hidden = true;
  }

  function abrirModalSinJustificar_() {
    var modal = document.getElementById('modal-sin-justificar');
    var list = document.getElementById('sj-mercado-list');
    if (!modal || !list) {
      abrirCopernico_(urlSinJustificarMercado_(MERCADO_SIN_JUSTIFICAR_DEFAULT_));
      return;
    }
    list.innerHTML = '';
    MERCADOS_SIN_JUSTIFICAR_.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sj-mercado-btn' +
        (item.def ? ' sj-mercado-btn--default' : '') +
        (item.todos ? ' sj-mercado-btn--todos' : '');
      btn.setAttribute('data-mercado', item.code);
      btn.setAttribute('role', 'listitem');
      var left = document.createElement('span');
      left.className = 'sj-mercado-name';
      left.textContent = item.todos ? 'TODOS LOS MERCADOS' : item.name;
      if (item.def) {
        var badge = document.createElement('span');
        badge.className = 'sj-mercado-badge';
        badge.textContent = 'Predeterminado';
        left.appendChild(document.createTextNode(' '));
        left.appendChild(badge);
      }
      btn.appendChild(left);
      if (!item.todos) {
        var right = document.createElement('span');
        right.className = 'sj-mercado-code';
        right.textContent = item.code;
        btn.appendChild(right);
      }
      list.appendChild(btn);
    });
    modal.hidden = false;
  }

  function urlCopernicoAtajo_(key) {
    var f = fechaCoperPartes_();
    var base = 'http://copernico.sir.renfe.es/copernico/';
    switch (key) {
      case 'sitra':
        return base + 'SrvRenfeSituacion?todo=cambiositra&fechaSitra=' + f.slash;
      case 'anadir-dt':
        return base + 'SrvRenfeAsignar_recursos?todo=documento_tren_mensaje';
      case 'sin-justificar':
        return urlSinJustificarMercado_(MERCADO_SIN_JUSTIFICAR_DEFAULT_);
      case 'transbordados':
        return base + 'SrvRenfeSituacion?todo=informetrasbordados&fechaDesde=' + f.slash + '&fechaHasta=' + f.slash;
      case 'matricula-real':
        return base + 'SrvRenfeAsignarMaterialM?todo=informegannmatriculas&matricula=&fecha=' + f.slash +
          '&tipo=&origen=&mercado=&serie=&real=1';
      case 'ficha-vehiculo':
        return base + 'SrvController/operaciones/fichaVehiculo/';
      case 'v-vehiculo':
        return base + 'SrvRenfeAsignarMaterialM?todo=buscarmaterialmatri&desde=MOTOR&fechaOrigen=' + f.slash +
          '&mercado=&tipo=&serie=&matbusca=';
      case 'historico-kms':
        // Mismo atajo que Anthony: informe histórico de kms en Copérnico.
        return base + 'SrvRenfeTablas?todo=buscarinformekms&inicio=S';
      case 'combinados':
        return (window.TurnioConexiones && window.TurnioConexiones.urlCombinadosHoy)
          ? window.TurnioConexiones.urlCombinadosHoy()
          : (base + 'SrvRenfeSeguimiento?todo=combinados&excel=E&codusuario=&hoy=' + encodeURIComponent(f.slash)
            + '&perfil=3&inicio=false&servicio1=&estacion=&orden=4&fechaInicio=' + encodeURIComponent(f.slash)
            + '&fechaFin=' + encodeURIComponent(f.slash));
      default:
        return '';
    }
  }
  /**
   * Pegar en la barra funciona; window.open desde TURNIO a menudo no
   * (Referer cruzado / cookies). Solución: <a> con referrerpolicy=no-referrer
   * para que la petición se parezca a escribir la URL a mano.
   */
  function urlExcelCombinadosHoy_() {
    return urlCopernicoAtajo_('combinados') || '';
  }
  function pintarUrlCombinadosUi_(url) {
    var inp = document.getElementById('cx-coper-url');
    if (inp) inp.value = url || '';
    var a = document.getElementById('cx-coper-link');
    if (a) {
      a.hidden = true;
      a.removeAttribute('href');
    }
    var wrap = document.getElementById('cx-coper-url-wrap');
    if (wrap) wrap.hidden = !url;
  }
  function copiarTextoClipboard_(texto) {
    if (!texto) return Promise.reject(new Error('vacío'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (!document.execCommand('copy')) reject(new Error('copy'));
        else resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }
  function abrirCopernicoCombinadosHoy_() {
    var url = urlExcelCombinadosHoy_();
    if (!url) {
      toast('No se pudo montar la URL de Combinados.', 'error');
      return;
    }
    pintarUrlCombinadosUi_(url);
    copiarTextoClipboard_(url).then(function () {
      toast('Enlace copiado. Pégalo en la barra del navegador (Ctrl+V) y Enter.', 'success');
    }).catch(function () {
      toast('Copia el enlace del cuadro y pégalo en la barra del navegador.', 'error');
    });
  }
  var circCoper = document.getElementById('circ-coper-links');
  if (circCoper) {
    circCoper.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-coper]');
      if (!btn) return;
      var key = btn.getAttribute('data-coper');
      if (key === 'combinados') {
        abrirCopernicoCombinadosHoy_();
        return;
      }
      if (key === 'sin-justificar') {
        abrirModalSinJustificar_();
        return;
      }
      var url = urlCopernicoAtajo_(key);
      if (url) abrirCopernico_(url);
    });
  }
  (function cablearModalSinJustificar_() {
    var modal = document.getElementById('modal-sin-justificar');
    var list = document.getElementById('sj-mercado-list');
    var btnCerrar = document.getElementById('btn-cerrar-sin-justificar');
    var btnCancel = document.getElementById('btn-cancelar-sin-justificar');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarModalSinJustificar_);
    if (btnCancel) btnCancel.addEventListener('click', cerrarModalSinJustificar_);
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) cerrarModalSinJustificar_();
      });
    }
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-mercado]');
        if (!btn || !list.contains(btn)) return;
        var mercado = btn.getAttribute('data-mercado');
        cerrarModalSinJustificar_();
        abrirCopernico_(urlSinJustificarMercado_(mercado));
      });
    }
  })();
  document.getElementById('btn-mallas-buscar').addEventListener('click', buscarMallaTren);
  document.getElementById('mallas-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); buscarMallaTren(); }
  });
  document.getElementById('mallas-resultados').addEventListener('click', function (e) {
    var head = e.target.closest('.malla-item-head');
    if (!head) return;
    var item = head.closest('.malla-item');
    if (item) abrirDetalleMalla(item);
  });

  // Buscador GTFS (cuadro oficial)
  var gtfs = window.TurnioMallasGtfs;
  if (gtfs) {
    var inpEst = document.getElementById('inputEstacionBuscar');
    if (inpEst) {
      inpEst.addEventListener('focus', gtfs.mostrarListaEstaciones);
      inpEst.addEventListener('input', gtfs.filtrarListaEstaciones);
    }
    document.getElementById('listaEstacionesCustom').addEventListener('click', function (e) {
      var opt = e.target.closest('[data-estacion]');
      if (!opt) return;
      gtfs.seleccionarEstacion(opt.getAttribute('data-estacion'));
    });
    document.getElementById('btn-generar-cuadro').addEventListener('click', function () {
      gtfs.mostrarHorarios();
    });
    document.getElementById('filtroFechaServicio').addEventListener('change', function () {
      if ((document.getElementById('inputEstacionBuscar') || {}).value) gtfs.mostrarHorarios();
    });
    document.getElementById('btn-dias-circulacion').addEventListener('click', gtfs.mostrarDiasCirculacionCuadro);
    document.getElementById('resultadosGTFS').addEventListener('click', function (e) {
      var card = e.target.closest('.flip-card');
      if (!card) return;
      var wasFlipped = card.classList.contains('is-flipped');
      gtfs.flipCard(card);
      if (!wasFlipped && card.classList.contains('is-flipped') && card.classList.contains('live')) {
        cargarMarchaVivoEnTarjetaMalla_(card);
      }
    });
    document.addEventListener('click', function (e) {
      var lista = document.getElementById('listaEstacionesCustom');
      var wrap = document.querySelector('.searchable-select-container');
      if (!lista || !wrap) return;
      if (!wrap.contains(e.target)) lista.hidden = true;
    });
  }
  document.getElementById('btn-monitor').addEventListener('click', function () {
    toggleMonitorMode(true);
  });
  document.getElementById('btn-exit-monitor').addEventListener('click', function () {
    toggleMonitorMode(false);
  });
  document.getElementById('btn-mapa').addEventListener('click', function () { go('mapa'); });
  document.getElementById('btn-vigilante').addEventListener('click', toggleVigilante);
  document.getElementById('btn-confirmar-retrasos').addEventListener('click', confirmarRetrasos);
  document.getElementById('btn-posponer-retrasos').addEventListener('click', posponerRetrasos);
  document.getElementById('btn-confirmar-detenciones').addEventListener('click', confirmarDetenciones);
  document.getElementById('btn-posponer-detenciones').addEventListener('click', posponerDetenciones);
  document.getElementById('radar-manual').addEventListener('click', abrirAvisoManual);
  document.getElementById('btn-cerrar-aviso-cg').addEventListener('click', cerrarModalAviso);
  document.getElementById('btn-cancelar-aviso').addEventListener('click', cerrarModalAviso);
  document.getElementById('btn-copiar-aviso').addEventListener('click', copiarAviso);
  document.getElementById('btn-guardar-firma').addEventListener('click', function () {
    var inp = document.getElementById('cg-prefijo');
    var t = inp ? inp.value.trim() : '';
    if (!t) { toast('Escribe una firma o unidad emisora'); return; }
    if (guardarFirmaAviso(t)) {
      toast('Firma guardada');
      var ta = document.getElementById('cg-mensaje');
      if (ta && ta.value) {
        var m = ta.value.match(/^([^:\n]+:)([\s\S]*)$/);
        if (m) ta.value = t + ':' + m[2];
        else ta.value = t + ': ' + ta.value;
      }
    }
  });
  document.getElementById('cg-buscador').addEventListener('input', buscarIncidenciaRapida);
  document.getElementById('cg-resultados').addEventListener('click', function (e) {
    var hit = e.target.closest('[data-incidencia]');
    if (!hit) return;
    insertarIncidencia(hit.getAttribute('data-incidencia'));
  });
  document.getElementById('btn-cerrar-aviso-manual').addEventListener('click', cerrarAvisoManual);
  document.getElementById('btn-cancelar-manual').addEventListener('click', cerrarAvisoManual);
  document.getElementById('btn-buscar-tren-manual').addEventListener('click', ejecutarBusquedaManual);
  document.getElementById('input-tren-manual').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); ejecutarBusquedaManual(); }
  });
  document.getElementById('btn-toggle-vias').addEventListener('click', toggleOrmDropdown);
  var btnAdif = document.getElementById('btn-toggle-adif');
  if (btnAdif) btnAdif.addEventListener('click', toggleCapaAdif_);
  var btnLtv = document.getElementById('btn-toggle-ltv');
  if (btnLtv) btnLtv.addEventListener('click', function () {
    toggleCapaLtv_().catch(function () {});
  });
  document.querySelectorAll('.orm-option').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      seleccionarORM(el.getAttribute('data-orm'));
    });
  });
  document.addEventListener('click', function () {
    var dd = document.getElementById('orm-dropdown');
    if (dd) dd.classList.remove('open');
  });
  document.getElementById('btn-refrescar-mapa').addEventListener('click', function () {
    cargarFlotaMapa({ fit: false }).then(function (lista) {
      toast((lista && lista.length ? lista.length : 0) + ' trenes en flota');
      if (window._mapaLeaflet) window._mapaLeaflet.invalidateSize();
    }).catch(function (e) {
      toast(String(e.message || e), 'error');
    });
  });
  var btnFsMapa = document.getElementById('btn-fullscreen-mapa');
  if (btnFsMapa) {
    btnFsMapa.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleMapaFullscreen_();
    });
  }
  document.getElementById('mapa-filtros').addEventListener('click', function (e) {
    var btn = e.target.closest('.mapa-filtro');
    if (!btn) return;
    if (btn.hasAttribute('data-flota-filtro')) {
      flotaSoloDemora = !flotaSoloDemora;
      btn.classList.toggle('active', flotaSoloDemora);
    } else {
      flotaModo = btn.getAttribute('data-flota-modo') || 'TODOS';
      document.querySelectorAll('.mapa-filtro[data-flota-modo]').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-flota-modo') === flotaModo);
      });
    }
    if (window._mapaLeaflet) pintarMarcadores(false);
  });
  document.getElementById('btn-ubicar-mapa').addEventListener('click', function (e) {
    e.preventDefault();
    buscarEnMapa_();
  });
  document.getElementById('mapa-buscar-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarEnMapa_();
    } else if (e.key === 'Escape') {
      ocultarSugerenciasMapa_();
    }
  });
  document.getElementById('mapa-buscar-input').addEventListener('input', function () {
    programarSugerenciasMapa_();
  });
  var sugBox = document.getElementById('mapa-busqueda-sugerencias');
  if (sugBox) {
    sugBox.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sug-idx]');
      if (!btn || !sugBox.contains(btn)) return;
      var idx = Number(btn.getAttribute('data-sug-idx'));
      var item = mapaSugCache_[idx];
      if (item) ubicarEnclaveEnMapa_(item);
    });
  }
  list.addEventListener('click', function (e) {
    var mapBtn = e.target.closest('.map-btn');
    if (mapBtn) {
      e.stopPropagation();
      if (mapBtn.disabled) {
        toast('Este tren no tiene posición GPS ahora mismo.');
        return;
      }
      abrirMapaTren(mapBtn.getAttribute('data-map-tren'));
      return;
    }
    var cxBtn = e.target.closest('.cx-btn');
    if (cxBtn) {
      e.stopPropagation();
      abrirModalConexiones_(cxBtn.getAttribute('data-cx-tren'));
      return;
    }
    var generate = e.target.closest('.generate');
    if (generate) {
      e.stopPropagation();
      abrirAvisoDesdeAlerta(encontrarAlertaAviso(
        generate.getAttribute('data-aviso-tren'),
        generate.getAttribute('data-aviso-trip')
      ));
      return;
    }
    var card = e.target.closest('.alert');
    if (card) abrirMarcha(card);
  });

  /* Servicios enlazados (Excel diario → panel estilo SE + botón en Radar) */
  var cxFiltroEstacion_ = '';
  var cxSoloPreferidas_ = true;
  var cxFiltroTren_ = '';
  var cxFiltroQ_ = '';
  var cxFiltroTurno_ = 'todos';
  var cxFiltroRol_ = 'enlace';
  var cxFiltroSort_ = 'hora';
  var cxSoloCirculando_ = false;
  var cxSoloRetraso_ = false;
  var cxTrenModal_ = '';
  var CX_REALIZADOS_KEY_ = 'turnio-cx-realizados-v1';

  function cxTrenEnCirculacion_(cod) {
    var api = window.TurnioCxRetrasos;
    if (!api || !cod) return false;
    var info = api.detalle(cod);
    return !!(info && info.encontrado);
  }

  function cxFilaEnCirculacion_(f) {
    return cxTrenEnCirculacion_(f && f.servicio) || cxTrenEnCirculacion_(f && f.servicioEnlazado);
  }

  /** Mayor demora positiva de los trenes de la conexión (0 si no hay dato / puntual). */
  function cxMaxRetrasoFila_(f) {
    var api = window.TurnioCxRetrasos;
    if (!api || !f) return 0;
    var max = 0;
    [f.servicio, f.servicioEnlazado].forEach(function (cod) {
      var r = api.minutos(cod);
      if (r != null && r > max) max = r;
    });
    return max;
  }

  function syncCirculandoBtnCx_() {
    var btn = document.getElementById('btn-cx-circulando');
    if (!btn) return;
    btn.classList.toggle('active', !!cxSoloCirculando_);
    btn.setAttribute('aria-pressed', cxSoloCirculando_ ? 'true' : 'false');
  }

  function syncRetrasoBtnCx_() {
    var btn = document.getElementById('btn-cx-retraso');
    if (!btn) return;
    btn.classList.toggle('active', !!cxSoloRetraso_);
    btn.setAttribute('aria-pressed', cxSoloRetraso_ ? 'true' : 'false');
  }

  function cxHoyIso_() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  function cxCardKey_(f) {
    return String(f.servicio || '') + '|' + String(f.horaSalidaEnlace || '') + '|' + String(f.estacionEnlace || '');
  }
  function cxObtenerRealizadosManual_() {
    try {
      var raw = localStorage.getItem(CX_REALIZADOS_KEY_);
      if (!raw) return {};
      var data = JSON.parse(raw);
      if (!data || data.fecha !== cxHoyIso_()) {
        localStorage.removeItem(CX_REALIZADOS_KEY_);
        return {};
      }
      var map = {};
      (data.keys || []).forEach(function (k) { map[k] = true; });
      return map;
    } catch (e) {
      return {};
    }
  }
  function cxGuardarRealizadosManual_(map) {
    try {
      localStorage.setItem(CX_REALIZADOS_KEY_, JSON.stringify({
        fecha: cxHoyIso_(),
        keys: Object.keys(map)
      }));
    } catch (e) { /* ignore */ }
  }
  function cxToggleRealizadoManual_(cardKey, checked) {
    var map = cxObtenerRealizadosManual_();
    if (checked) map[cardKey] = true;
    else delete map[cardKey];
    cxGuardarRealizadosManual_(map);
  }

  function cxHoraAMinutos_(hStr) {
    var m = String(hStr || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /** Hora efectiva del enlace = salida programada + retraso del tren que sale (o del que llega). */
  function cxMinutosEfectivosEnlace_(f) {
    var m = cxHoraAMinutos_(f.horaSalidaEnlace);
    if (m < 0) return -1;
    var ret = 0;
    var api = window.TurnioCxRetrasos;
    if (api) {
      var rSale = api.minutos(f.servicioEnlazado);
      var rLlega = api.minutos(f.servicio);
      if (rSale !== undefined) ret = Math.max(0, Number(rSale) || 0);
      else if (rLlega !== undefined) ret = Math.max(0, Number(rLlega) || 0);
    }
    return m + ret;
  }

  function cxEsRealizado_(f, realizadosMap) {
    var key = cxCardKey_(f);
    if (realizadosMap && realizadosMap[key]) return true;
    var eff = cxMinutosEfectivosEnlace_(f);
    var ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();
    return eff >= 0 && (eff + 10) < ahoraMin;
  }

  function htmlTarjetaConexion_(f, opts) {
    opts = opts || {};
    var highlight = String(opts.estacion || opts.highlight || '');
    var retApi = window.TurnioCxRetrasos;
    var realizadosMap = opts.realizadosMap || cxObtenerRealizadosManual_();
    var ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();
    var espera = Number(f.tiempoConexion) || 0;
    if (!espera) {
      var hL = cxHoraAMinutos_(f.horaLlegadaEnlace);
      var hS = cxHoraAMinutos_(f.horaSalidaEnlace);
      if (hL >= 0 && hS >= 0) {
        espera = hS - hL;
        if (espera < 0) espera += 24 * 60;
      }
    }
    var v = Number(f.viajeros) || 0;
    var vIcon = v >= 10 ? '👥' : v >= 5 ? '👤' : v > 0 ? '·' : '—';
    var cardKey = cxCardKey_(f);
    var marcadoManual = !!realizadosMap[cardKey];
    var horaEff = cxMinutosEfectivosEnlace_(f);
    var esRealizado = marcadoManual || (horaEff >= 0 && (horaEff + 10) < ahoraMin);
    var proxClass = '';
    var proxBadge = '';
    if (!esRealizado && horaEff >= 0) {
      var minRest = horaEff - ahoraMin;
      if (minRest < 15) {
        proxClass = ' cx-prox-rojo';
        proxBadge = '<span class="cx-prox-badge cx-prox-badge-rojo">' + (minRest > 0 ? minRest + ' min' : '¡Ahora!') + '</span>';
      } else if (minRest < 30) {
        proxClass = ' cx-prox-ambar';
        proxBadge = '<span class="cx-prox-badge cx-prox-badge-ambar">' + minRest + ' min</span>';
      } else {
        proxClass = ' cx-prox-verde';
        proxBadge = '<span class="cx-prox-badge cx-prox-badge-verde">' + minRest + ' min</span>';
      }
    }
    var esDestaca = !esRealizado && ((espera > 0 && espera < 30) || v > 15);
    var destacaBadge = esDestaca
      ? '<span class="cx-destaca-badge">' +
        ((espera > 0 && espera < 30) ? 'Ajustada' : '') +
        ((espera > 0 && espera < 30 && v > 15) ? ' · ' : '') +
        (v > 15 ? 'Alta ocup.' : '') +
        '</span>'
      : '';
    var riesgoBadge = (!esRealizado && retApi) ? retApi.riesgoHtml(f, esc) : '';
    var encApi = window.TurnioCxEncaminar;
    var encAnalisis = (!esRealizado && encApi) ? encApi.analizarEnlace(f) : null;
    var encBtn = '';
    if (encAnalisis && (encAnalisis.nivel === 'riesgo' || encAnalisis.nivel === 'perdido')) {
      var encLabel = encAnalisis.nivel === 'perdido' ? 'Encaminar' : 'Sugerir encaminamiento';
      encBtn = '<button type="button" class="cx-enc-btn' +
        (encAnalisis.nivel === 'perdido' ? ' cx-enc-btn--lost' : '') +
        '" data-cx-enc="' + esc(cxCardKey_(f)) + '">' + encLabel + '</button>';
    }
    var rolesHtml = (f._roles || []).map(function (r) {
      var label = r === 'origen' ? 'Origen' : r === 'destino' ? 'Destino' : 'Enlace';
      return '<span class="cx-role-badge cx-role-' + r + '">' + label + '</span>';
    }).join('');
    function hi(nombre) {
      var a = String(highlight || '').toLowerCase();
      var b = String(nombre || '').toLowerCase();
      if (a && b && b.indexOf(a) >= 0) return '<span class="cx-est-highlight">' + esc(nombre) + '</span>';
      return esc(nombre || '—');
    }
    var badgeOrig = retApi ? retApi.badgeHtml(f.servicio, esc) : '';
    var badgeEnl = retApi ? retApi.badgeHtml(f.servicioEnlazado, esc) : '';
    var esperaHtml = retApi
      ? retApi.esperaBubbleHtml(espera, f.servicio)
      : '<div class="cxn-espera cx-t-ok"><span class="cxn-espera-ico" aria-hidden="true">&#9201;</span><b>' +
        esc(String(espera)) + '</b><small>min</small></div>';
    return '<article class="cx-card' + (esRealizado ? ' cx-card-realizado' : '') +
      (esDestaca ? ' cx-card-destaca' : '') + proxClass + '" data-cx-key="' + esc(cardKey) + '"' +
      ' data-cx-serv="' + esc(f.servicio || '') + '"' +
      ' data-cx-serv-enl="' + esc(f.servicioEnlazado || '') + '"' +
      ' data-cx-est="' + esc(f.estacionEnlace || '') + '"' +
      ' data-cx-dest="' + esc(f.destino || '') + '"' +
      ' data-cx-hlleg="' + esc(f.horaLlegadaEnlace || '') + '"' +
      ' data-cx-hsal="' + esc(f.horaSalidaEnlace || '') + '"' +
      ' data-cx-hlleg-dest="' + esc(f.horaLlegada || '') + '">' +
      (esRealizado ? '<span class="cx-realizado-badge">Realizado</span>' : '') +
      '<div class="cxn-top">' +
      '<div class="cxn-hora">' + esc(f.horaSalidaEnlace || '—') + '</div>' +
      '<div class="cxn-top-mid">' +
      '<div class="cxn-estacion">' + esc(f.estacionEnlace || 'Enlace') + '</div>' +
      '<div class="cxn-badges">' + proxBadge + destacaBadge + riesgoBadge + rolesHtml + encBtn + '</div>' +
      '</div>' +
      '<div class="cxn-top-right">' +
      '<span class="cxn-viajeros">' + vIcon + ' ' + v + ' viaj.</span>' +
      '<label class="cxn-check-lbl"><input type="checkbox" class="cx-realizado-check" data-cx-key="' +
      esc(cardKey) + '"' + (marcadoManual || esRealizado ? ' checked' : '') +
      (esRealizado && !marcadoManual ? ' data-auto="1"' : '') + '> Realizado</label>' +
      '</div></div>' +
      '<div class="cxn-trenes">' +
      '<div class="cxn-tren-blk">' +
      '<div class="cxn-tren-id cxn-llega"><span class="cxn-tren-num">&#128642; ' + esc(f.servicio || '—') +
      '</span>' + badgeOrig + '</div>' +
      '<div class="cxn-tren-detail">' +
      '<span class="cxn-station-nm">' + hi(f.origen) + '</span>' +
      '<div class="cxn-times-row">' +
      '<span class="cxn-t">' + esc(f.horaSalidaOrig || '—') + '</span><span class="cxn-t-lbl">sale</span>' +
      '<span class="cxn-arr">&#8594;</span>' +
      '<span class="cxn-t cxn-t-hl">' + esc(f.horaLlegadaEnlace || '—') + '</span><span class="cxn-t-lbl">llega</span>' +
      '</div></div></div>' +
      esperaHtml +
      '<div class="cxn-tren-blk cxn-tren-blk-r">' +
      '<div class="cxn-tren-id cxn-sale"><span class="cxn-tren-num">&#128646; ' + esc(f.servicioEnlazado || '—') +
      '</span>' + badgeEnl + '</div>' +
      '<div class="cxn-tren-detail cxn-tren-detail-r">' +
      '<span class="cxn-station-nm cxn-station-nm-r">' + hi(f.destino) + '</span>' +
      '<div class="cxn-times-row cxn-times-row-r">' +
      '<span class="cxn-t cxn-t-hl">' + esc(f.horaSalidaEnlace || '—') + '</span><span class="cxn-t-lbl">sale</span>' +
      '<span class="cxn-arr">&#8594;</span>' +
      '<span class="cxn-t">' + esc(f.horaLlegada || '—') + '</span><span class="cxn-t-lbl">llega</span>' +
      '</div></div></div></div></article>';
  }

  function refrescarLiveIndCx_() {
    var ind = document.getElementById('cx-live-ind');
    var api = window.TurnioCxRetrasos;
    if (!ind || !api) return;
    var st = api.estado();
    ind.textContent = st.label;
    ind.classList.remove('ok', 'err', 'loading');
    if (st.cargado) ind.classList.add('ok');
    else if (st.error) ind.classList.add('err');
    else ind.classList.add('loading');
  }

  var combinadosHayRemoto_ = false;

  function refrescarUiConexiones_() {
    var cx = window.TurnioConexiones;
    var st = cx ? cx.estado() : { cargado: false, total: 0, meta: {} };
    var puedePublicar = !!(sessionProfile && sessionProfile.can_write);
    if (st.cargado && st.meta && st.meta.compartido) combinadosHayRemoto_ = true;
    ['cx-status-chip', 'cx-panel-chip'].forEach(function (id) {
      var chip = document.getElementById(id);
      if (!chip) return;
      chip.textContent = st.cargado ? (st.total + ' filas') : 'Sin cargar';
      chip.classList.toggle('circ-chip--green', !!st.cargado);
    });
    var txt;
    if (st.cargado) {
      txt = (st.meta && st.meta.compartido ? 'Compartido hoy' : 'Cargado hoy') +
        ' · ' + ((st.meta && st.meta.nombre) || 'fichero') + ' · ' + st.total + ' conexiones';
      if (st.meta && st.meta.publicado_por) txt += ' · ' + st.meta.publicado_por;
    } else if (puedePublicar && combinadosHayRemoto_) {
      txt = 'Hay una publicación en el servidor. Puedes borrarla o cargar otro Excel y republicar.';
    } else {
      txt = puedePublicar
        ? 'Ningún fichero hoy. Carga el Excel y pulsa Publicar para todos.'
        : 'Sin datos compartidos hoy. Cuando un CGO publique, aparecerán aquí.';
    }
    ['cx-upload-meta', 'cx-panel-meta'].forEach(function (id) {
      var meta = document.getElementById(id);
      if (meta) meta.textContent = txt;
    });
    [
      ['cx-upload-circ', 'btn-cx-cargar', 'btn-cx-limpiar', 'btn-cx-publicar', 'btn-cx-borrar-pub'],
      ['cx-upload-panel', 'btn-cx-cargar-panel', 'btn-cx-limpiar-panel', 'btn-cx-publicar-panel', 'btn-cx-borrar-pub-panel']
    ].forEach(function (ids) {
      var row = document.getElementById(ids[0]);
      var loadBtn = document.getElementById(ids[1]);
      var clearBtn = document.getElementById(ids[2]);
      var pubBtn = document.getElementById(ids[3]);
      var delBtn = document.getElementById(ids[4]);
      if (row) row.classList.toggle('cx-upload-row--ready', !!st.cargado);
      if (clearBtn) clearBtn.hidden = !st.cargado;
      if (loadBtn) {
        loadBtn.hidden = !puedePublicar;
        var idle = loadBtn.getAttribute('data-cx-label-idle') || 'Cargar Excel';
        var ready = loadBtn.getAttribute('data-cx-label-ready') || 'Recargar';
        loadBtn.textContent = st.cargado ? ready : idle;
      }
      if (pubBtn) pubBtn.hidden = !(puedePublicar && st.cargado);
      if (delBtn) delBtn.hidden = !(puedePublicar && combinadosHayRemoto_);
    });
    refrescarLiveIndCx_();
  }

  var combinadosFetchPromise_ = null;

  async function asegurarCombinadosCompartidos_(opts) {
    opts = opts || {};
    var cx = window.TurnioConexiones;
    if (!cx) return false;
    if (cx.estado().cargado && !opts.force) return true;
    if (combinadosFetchPromise_) return combinadosFetchPromise_;
    combinadosFetchPromise_ = (async function () {
      try {
        var data = await call('combinados_obtener', {});
        if (!data || data.ok === false) return false;
        if (data.empty || !Array.isArray(data.filas) || !data.filas.length) {
          combinadosHayRemoto_ = false;
          return false;
        }
        combinadosHayRemoto_ = true;
        var ok = cx.aplicarSnapshotCompartido(data);
        if (ok) {
          refrescarUiConexiones_();
          if (typeof render === 'function') render();
          if (typeof pintarPanelConexiones_ === 'function') pintarPanelConexiones_();
        }
        return ok;
      } catch (_) {
        return false;
      } finally {
        combinadosFetchPromise_ = null;
      }
    })();
    return combinadosFetchPromise_;
  }

  async function publicarConexionesUi_() {
    var cx = window.TurnioConexiones;
    if (!cx) return;
    if (!exigirEscritura_('Publicar combinados')) return;
    var snap = cx.snapshotParaPublicar();
    if (!snap || !snap.filas || !snap.filas.length) {
      toast('Carga primero el Excel del día.', 'error');
      return;
    }
    var msg = combinadosHayRemoto_
      ? ('¿Sustituir la publicación de hoy por estas ' + snap.filas.length + ' conexiones?')
      : ('¿Publicar ' + snap.filas.length + ' conexiones para todos los usuarios de hoy?');
    if (!confirm(msg)) return;
    try {
      var data = await call('combinados_publicar', {
        filas: snap.filas,
        meta: snap.meta
      });
      if (!data || data.ok === false) {
        throw new Error((data && (data.detail || data.error)) || 'No se pudo publicar');
      }
      combinadosHayRemoto_ = true;
      cx.aplicarSnapshotCompartido({
        fecha: data.fecha || snap.fecha,
        filas: snap.filas,
        meta: data.meta || snap.meta
      });
      refrescarUiConexiones_();
      pintarPanelConexiones_();
      toast('Publicado para todos · ' + (data.total || snap.filas.length) + ' filas', 'success');
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  async function borrarPublicacionConexionesUi_() {
    if (!exigirEscritura_('Borrar publicación de combinados')) return;
    if (!confirm('¿Borrar la publicación compartida de hoy para TODOS los usuarios?\n\nLuego puedes cargar el Excel correcto y volver a publicar.')) return;
    try {
      var data = await call('combinados_borrar', {});
      if (!data || data.ok === false) {
        throw new Error((data && (data.detail || data.error)) || 'No se pudo borrar');
      }
      combinadosHayRemoto_ = false;
      var cx = window.TurnioConexiones;
      if (cx) cx.limpiar();
      refrescarUiConexiones_();
      if (typeof render === 'function') render();
      pintarPanelConexiones_();
      toast('Publicación borrada. Ya no hay combinados compartidos hoy.', 'success');
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  function syncRolBtnsCx_() {
    document.querySelectorAll('.cx-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', (btn.getAttribute('data-cx-rol') || '') === cxFiltroRol_);
    });
  }

  function aplicarPreferenciasEstaciones_(ids) {
    var cx = window.TurnioConexiones;
    if (!cx || !cx.setEstacionesPreferidas) return;
    if (Array.isArray(ids) && ids.length) {
      cx.setEstacionesPreferidas(ids);
    } else {
      // null / vacío → default Andalucía del catálogo
      cx.setEstacionesPreferidas(null);
    }
    sessionProfile.estaciones_preferidas = cx.getEstacionesPreferidas();
    pintarChecksPreferenciasCx_();
    if (document.getElementById('screen-conexiones') &&
        document.getElementById('screen-conexiones').classList.contains('active')) {
      pintarPanelConexiones_();
    }
  }

  function pintarChecksPreferenciasCx_() {
    var box = document.getElementById('cx-prefs-checks');
    var cx = window.TurnioConexiones;
    if (!box || !cx || !cx.catalogoPreferidas) return;
    var selected = {};
    (cx.getEstacionesPreferidas() || []).forEach(function (id) { selected[id] = 1; });
    box.innerHTML = cx.catalogoPreferidas().map(function (c) {
      return '<label class="cx-pref-check">' +
        '<input type="checkbox" data-cx-pref-id="' + esc(c.id) + '"' +
        (selected[c.id] ? ' checked' : '') + '> ' + esc(c.label) +
        '</label>';
    }).join('');
  }

  function togglePanelPreferenciasCx_() {
    var panel = document.getElementById('cx-prefs-panel');
    var btn = document.getElementById('btn-cx-prefs');
    if (!panel) return;
    var open = panel.hidden;
    panel.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) pintarChecksPreferenciasCx_();
  }

  async function guardarPreferenciasEstacionesCx_() {
    var cx = window.TurnioConexiones;
    var box = document.getElementById('cx-prefs-checks');
    if (!cx || !box) return;
    var ids = [];
    box.querySelectorAll('input[data-cx-pref-id]:checked').forEach(function (el) {
      ids.push(el.getAttribute('data-cx-pref-id'));
    });
    if (!ids.length) {
      toast('Marca al menos una estación preferida.', 'error');
      return;
    }
    try {
      var data = await call('preferencias_estaciones_guardar', {
        estaciones_preferidas: ids
      });
      if (!data || data.ok === false) {
        throw new Error((data && (data.detail || data.error)) || 'No se pudieron guardar');
      }
      var saved = data.estaciones_preferidas;
      if (data.persona && Array.isArray(data.persona.estaciones_preferidas)) {
        saved = data.persona.estaciones_preferidas;
      }
      aplicarPreferenciasEstaciones_(saved && saved.length ? saved : ids);
      toast('Preferencias de estaciones guardadas', 'success');
      var panel = document.getElementById('cx-prefs-panel');
      if (panel) panel.hidden = true;
    } catch (err) {
      toast(String(err.message || err), 'error');
    }
  }

  function estacionFiltroActivaCx_() {
    var libre = document.getElementById('cx-est-libre');
    var typed = libre ? String(libre.value || '').trim() : '';
    if (typed) return typed;
    return cxFiltroEstacion_ || '';
  }

  function pintarBotonesEstacionCx_() {
    var wrap = document.getElementById('cx-est-btns');
    var cx = window.TurnioConexiones;
    var libre = document.getElementById('cx-est-libre');
    var typed = libre ? String(libre.value || '').trim() : '';
    if (!wrap || !cx) return;
    wrap.innerHTML = cx.estacionesPreferidasUi().map(function (e) {
      var active = false;
      if (typed) active = false;
      else if (e.todas) active = !cxSoloPreferidas_ && !cxFiltroEstacion_;
      else if (e.all) active = !!cxSoloPreferidas_ && !cxFiltroEstacion_;
      else active = cxFiltroEstacion_ === (e.id || '');
      return '<button type="button" class="cx-est-btn' +
        (e.all ? ' preferidas-all' : '') +
        (e.todas ? ' cx-est-todas' : '') +
        (active ? ' active' : '') +
        '" data-cx-est="' + esc(e.id) + '"' +
        (e.todas ? ' data-cx-todas="1"' : '') +
        (e.all ? ' data-cx-pref="1"' : '') +
        '>' + esc(e.label) + '</button>';
    }).join('');
  }

  function pintarPanelConexiones_() {
    var cx = window.TurnioConexiones;
    var box = document.getElementById('cx-resultados');
    var cnt = document.getElementById('cx-contador');
    var totalLabel = document.getElementById('cx-total-label');
    var input = document.getElementById('cx-buscar-tren');
    var stats = document.getElementById('cx-stats');
    var rolRow = document.getElementById('cx-rol-row');
    refrescarUiConexiones_();
    pintarBotonesEstacionCx_();
    syncRolBtnsCx_();
    var estActiva = estacionFiltroActivaCx_();
    if (rolRow) rolRow.hidden = !estActiva;
    if (!cx || !box) return;
    var st = cx.estado();
    if (!st.cargado) {
      if (cnt) cnt.textContent = '';
      if (totalLabel) totalLabel.textContent = '0 conexiones';
      if (stats) stats.hidden = true;
      box.innerHTML = '<div class="empty">' +
        (sessionProfile && sessionProfile.can_write
          ? 'Carga el Excel/HTML de Trenes Combinados y pulsa Publicar para todos.'
          : 'Aún no hay combinados compartidos hoy. Un CGO debe publicarlos.') +
        '</div>';
      return;
    }
    var qRaw = (input && input.value) || '';
    var tren = cx.limpiarNumTren(qRaw);
    cxFiltroTren_ = tren;
    cxFiltroQ_ = tren ? '' : String(qRaw || '').trim();
    var sortEfectivo = cxFiltroSort_;
    if (cxSoloRetraso_ && sortEfectivo === 'hora') sortEfectivo = 'retraso';
    var filas = cx.listar({
      soloPreferidas: !estActiva && !!cxSoloPreferidas_,
      estacion: estActiva,
      tren: tren,
      q: cxFiltroQ_,
      turno: cxFiltroTurno_,
      rol: estActiva ? cxFiltroRol_ : 'todos',
      sort: sortEfectivo === 'retraso' ? 'hora' : sortEfectivo,
      limit: (cxSoloCirculando_ || cxSoloRetraso_) ? 800 : (estActiva || !cxSoloPreferidas_ ? 400 : 250)
    });
    if (cxSoloCirculando_) {
      filas = filas.filter(cxFilaEnCirculacion_);
    }
    if (cxSoloRetraso_) {
      filas = filas.filter(function (f) { return cxMaxRetrasoFila_(f) > 0; });
    }
    if (sortEfectivo === 'retraso') {
      filas = filas.slice().sort(function (a, b) {
        var d = cxMaxRetrasoFila_(b) - cxMaxRetrasoFila_(a);
        if (d) return d;
        return String(a.horaSalidaEnlace || '').localeCompare(String(b.horaSalidaEnlace || ''));
      });
    }
    syncCirculandoBtnCx_();
    syncRetrasoBtnCx_();
    var realizadosMap = cxObtenerRealizadosManual_();
    var pendientes = [];
    var realizados = [];
    filas.forEach(function (f) {
      if (cxEsRealizado_(f, realizadosMap)) realizados.push(f);
      else pendientes.push(f);
    });
    var viajeros = filas.reduce(function (s, f) { return s + (Number(f.viajeros) || 0); }, 0);
    var media = filas.length
      ? Math.round(filas.reduce(function (s, f) { return s + (Number(f.tiempoConexion) || 0); }, 0) / filas.length)
      : 0;
    if (stats) {
      stats.hidden = false;
      var sn = document.getElementById('cx-stat-n');
      var sv = document.getElementById('cx-stat-v');
      var se = document.getElementById('cx-stat-e');
      var sp = document.getElementById('cx-stat-p');
      if (sn) sn.textContent = String(filas.length);
      if (sv) sv.textContent = String(viajeros);
      if (se) se.textContent = String(media) + "'";
      if (sp) sp.textContent = String(pendientes.length);
    }
    if (totalLabel) {
      var extras = [];
      if (cxSoloCirculando_) extras.push('en circulación');
      if (cxSoloRetraso_) extras.push('con retraso');
      totalLabel.textContent = filas.length + ' conexiones' +
        (extras.length ? ' · ' + extras.join(' · ') : '');
    }
    if (cnt) cnt.textContent = pendientes.length + ' pend. · ' + realizados.length + ' hechas';
    if (!filas.length) {
      var emptyMsg = 'No hay conexiones con estos filtros.';
      if (cxSoloRetraso_ && cxSoloCirculando_) {
        emptyMsg = 'Ninguna conexión en circulación tiene demora ahora.';
      } else if (cxSoloRetraso_) {
        emptyMsg = 'Ninguna conexión de este filtro tiene demora en tiempo real.';
      } else if (cxSoloCirculando_) {
        emptyMsg = 'Ninguna conexión de este filtro tiene trenes en circulación ahora.';
      }
      box.innerHTML = '<div class="empty">' + emptyMsg + '</div>';
      return;
    }
    var cardOpts = { estacion: estActiva, realizadosMap: realizadosMap };
    var html = pendientes.map(function (f) {
      return htmlTarjetaConexion_(f, cardOpts);
    }).join('');
    if (pendientes.length && realizados.length) {
      html += '<div class="cx-sep-realizados">— ' + realizados.length + ' enlaces ya realizados —</div>';
    }
    html += realizados.map(function (f) {
      return htmlTarjetaConexion_(f, cardOpts);
    }).join('');
    box.innerHTML = html;
  }

  function abrirModalEncaminar_(fila) {
    var enc = window.TurnioCxEncaminar;
    var modal = document.getElementById('modal-cx-encaminar');
    var sub = document.getElementById('cx-enc-sub');
    var aviso = document.getElementById('cx-enc-aviso');
    var lista = document.getElementById('cx-enc-lista');
    var btnMallas = document.getElementById('btn-cx-enc-mallas');
    if (!enc || !modal || !lista) return;
    var res = enc.sugerir(fila);
    var a = res.analisis || {};
    var nivelTxt = a.nivel === 'perdido' ? 'Enlace perdido' : 'Enlace en riesgo';
    if (sub) {
      sub.textContent = nivelTxt + ' · Tren ' + (a.trenLlega || '—') + ' (+' + (a.retraso || 0) +
        ' min) llega ~' + enc.fmtHora(a.llegadaEfectiva) + ' a ' + (a.estacionEnlace || 'enlace') +
        ' · destino ' + (a.destino || '—') +
        ' · margen ' + (a.margen != null ? a.margen + ' min' : '—');
    }
    if (aviso) {
      if (res.avisoMalla) {
        aviso.hidden = false;
        aviso.textContent = res.avisoMalla;
      } else {
        aviso.hidden = true;
        aviso.textContent = '';
      }
    }
    if (btnMallas) {
      btnMallas.hidden = !res.avisoMalla || !/Malla GTFS no cargada/i.test(res.avisoMalla || '');
    }
    if (!res.alternativas.length) {
      lista.innerHTML = '<div class="cx-enc-empty">No hay alternativas claras el resto del día desde esta estación hacia ese destino' +
        (res.avisoMalla ? ' con los datos disponibles.' : '.') +
        ' Prueba abrir Mallas o ampliar el filtro de estaciones.</div>';
    } else {
      lista.innerHTML = res.alternativas.map(function (alt) {
        var badge = alt.match === 'paso'
          ? '<span class="help-badge hb-purple">Pasa por destino</span>'
          : '<span class="help-badge hb-green">Mismo destino</span>';
        var fuente = alt.fuente === 'gtfs'
          ? '<span class="help-badge hb-blue">Malla</span>'
          : '<span class="help-badge hb-amber">Excel</span>';
        return '<article class="cx-enc-alt' + (alt.match === 'paso' ? ' paso' : '') + '">' +
          '<div class="cx-enc-alt-top"><b>&#128646; ' + esc(String(alt.tren || '—')) +
          '</b><span class="cx-enc-alt-meta">' + esc(alt.horaSalida || '—') + ' · +' +
          esc(String(alt.esperaDesdeLlegada != null ? alt.esperaDesdeLlegada : '—')) + ' min</span></div>' +
          '<p>' + badge + ' ' + fuente +
          (alt.producto ? ' · ' + esc(alt.producto) : '') + '</p>' +
          '<p>Sale de enlace ' + esc(alt.horaSalida || '—') +
          ' · llega destino ' + esc(alt.horaLlegadaDestino || '—') +
          (alt.destinoFinalNombre ? ' (' + esc(alt.destinoFinalNombre) + ')' : '') + '</p>' +
          '</article>';
      }).join('');
    }
    modal.hidden = false;
  }
  function cerrarModalEncaminar_() {
    var modal = document.getElementById('modal-cx-encaminar');
    if (modal) modal.hidden = true;
  }
  function filaDesdeCardEnc_(card) {
    if (!card) return null;
    return {
      servicio: card.getAttribute('data-cx-serv') || '',
      servicioEnlazado: card.getAttribute('data-cx-serv-enl') || '',
      estacionEnlace: card.getAttribute('data-cx-est') || '',
      destino: card.getAttribute('data-cx-dest') || '',
      horaLlegadaEnlace: card.getAttribute('data-cx-hlleg') || '',
      horaSalidaEnlace: card.getAttribute('data-cx-hsal') || '',
      horaLlegada: card.getAttribute('data-cx-hlleg-dest') || ''
    };
  }

  function htmlTarjetaConexionRadarModal_(f, trenActual) {
    var cx = window.TurnioConexiones;
    var rol = cx && cx.rolTrenEnFila ? cx.rolTrenEnFila(f, trenActual) : '';
    var rolLbl = rol === 'llega' ? 'Llega a enlace' : rol === 'sale' ? 'Sale del enlace' : rol === 'ambos' ? 'Ambos trenes' : 'Enlace';
    var otro = '';
    if (rol === 'llega') otro = f.servicioEnlazado || '—';
    else if (rol === 'sale') otro = f.servicio || '—';
    else otro = (f.servicio || '—') + ' ↔ ' + (f.servicioEnlazado || '—');
    var margen = f.tiempoConexion != null ? String(f.tiempoConexion) : '—';
    var viaj = f.viajeros != null ? String(f.viajeros) : '—';
    return (
      '<article class="cx-radar-card">' +
        '<div class="cx-radar-card-head">' +
          '<b>' + esc(f.estacionEnlace || 'Estación enlace') + '</b>' +
          '<span class="cx-radar-rol">' + esc(rolLbl) + '</span>' +
        '</div>' +
        '<p class="cx-radar-line"><span class="muted">Tren enlace</span> <b>' + esc(String(otro)) + '</b></p>' +
        '<p class="cx-radar-line">' +
          '<span>' + esc(f.servicio || '—') + ' llega ' + esc(f.horaLlegadaEnlace || '—') + '</span>' +
          '<span class="cx-radar-arrow">→</span>' +
          '<span>' + esc(f.servicioEnlazado || '—') + ' sale ' + esc(f.horaSalidaEnlace || '—') + '</span>' +
        '</p>' +
        '<p class="cx-radar-meta">' +
          'Margen <b>' + esc(margen) + ' min</b>' +
          (viaj !== '—' && viaj !== '0' ? ' · ' + esc(viaj) + ' viaj.' : '') +
          (f.origen || f.destino
            ? ' · ' + esc(f.origen || '—') + ' → ' + esc(f.destino || '—')
            : '') +
        '</p>' +
      '</article>'
    );
  }
  function abrirModalConexiones_(numTren) {
    var cx = window.TurnioConexiones;
    var modal = document.getElementById('modal-conexiones');
    var lista = document.getElementById('cx-modal-lista');
    var sub = document.getElementById('cx-modal-sub');
    if (!cx || !modal || !lista) return;
    var num = cx.limpiarNumTren(numTren);
    cxTrenModal_ = num;
    var filas = cx.conexionesDeTren(num, true);
    if (sub) {
      sub.textContent = !cx.estado().cargado
        ? 'Carga primero el Excel de Combinados del día en Circulación.'
        : ('Tren ' + num + ' · ' + filas.length + ' enlace(s) en estaciones preferidas (Sevilla SJ, Córdoba, Málaga, Antequera, Granada, Dos Hermanas).');
    }
    if (!filas.length) {
      lista.innerHTML = '<div class="empty">' +
        (cx.estado().cargado
          ? 'No hay enlaces preferidos para este tren en el fichero de hoy.'
          : 'Sin fichero de conexiones cargado hoy.') +
        '</div>';
    } else {
      lista.innerHTML = filas.map(function (f) {
        return htmlTarjetaConexionRadarModal_(f, num);
      }).join('');
    }
    modal.hidden = false;
  }
  function cerrarModalConexiones_() {
    var modal = document.getElementById('modal-conexiones');
    if (modal) modal.hidden = true;
  }
  function cargarArchivoConexionesUi_(file) {
    var cx = window.TurnioConexiones;
    if (!file || !cx) return;
    toast('Leyendo conexiones…', 'success');
    cx.cargarArchivo(file).then(function (st) {
      refrescarUiConexiones_();
      render();
      pintarPanelConexiones_();
      toast('Conexiones cargadas: ' + st.total + ' filas', 'success');
    }).catch(function (err) {
      toast(String(err.message || err), 'error');
    });
  }
  function limpiarConexionesUi_() {
    var cx = window.TurnioConexiones;
    if (!cx) return;
    if (!cx.estado().cargado) { toast('No hay fichero cargado.'); return; }
    var eraCompartido = !!(cx.estado().meta && cx.estado().meta.compartido);
    var msgQuitar = eraCompartido
      ? '¿Quitar los datos solo de ESTE dispositivo?\n\nLa publicación del servidor sigue para los demás. Usa «Borrar publicación» si quieres quitarla para todos.'
      : '¿Quitar el Excel de conexiones de este dispositivo?';
    if (!confirm(msgQuitar)) return;
    cx.limpiar();
    cxFiltroTren_ = '';
    cxFiltroQ_ = '';
    cxFiltroEstacion_ = '';
    cxSoloPreferidas_ = true;
    cxFiltroTurno_ = 'todos';
    cxFiltroRol_ = 'enlace';
    cxFiltroSort_ = 'hora';
    cxSoloCirculando_ = false;
    cxSoloRetraso_ = false;
    syncCirculandoBtnCx_();
    syncRetrasoBtnCx_();
    var input = document.getElementById('cx-buscar-tren');
    if (input) input.value = '';
    var estLibre = document.getElementById('cx-est-libre');
    if (estLibre) estLibre.value = '';
    var sortSel = document.getElementById('cx-sort');
    if (sortSel) sortSel.value = 'hora';
    document.querySelectorAll('.cx-turno-btn').forEach(function (b) {
      b.classList.toggle('active', (b.getAttribute('data-cx-turno') || '') === 'todos');
    });
    syncRolBtnsCx_();
    refrescarUiConexiones_();
    render();
    pintarPanelConexiones_();
    toast('Conexiones eliminadas.');
  }
  (function cablearConexionesUi_() {
    function bindFile(btnId, inputId) {
      var btn = document.getElementById(btnId);
      var input = document.getElementById(inputId);
      if (!btn || !input) return;
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        cargarArchivoConexionesUi_(file);
      });
    }
    bindFile('btn-cx-cargar', 'cx-file-input');
    bindFile('btn-cx-cargar-panel', 'cx-file-input-panel');
    ['btn-cx-publicar', 'btn-cx-publicar-panel'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () { publicarConexionesUi_(); });
    });
    ['btn-cx-borrar-pub', 'btn-cx-borrar-pub-panel'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () { borrarPublicacionConexionesUi_(); });
    });
    var btnClear = document.getElementById('btn-cx-limpiar');
    if (btnClear) btnClear.addEventListener('click', limpiarConexionesUi_);
    var btnClearP = document.getElementById('btn-cx-limpiar-panel');
    if (btnClearP) btnClearP.addEventListener('click', limpiarConexionesUi_);
    var btnAbrir = document.getElementById('btn-cx-abrir-panel');
    if (btnAbrir) btnAbrir.addEventListener('click', function () { go('conexiones'); });
    var btnAbrirCoper = document.getElementById('btn-cx-abrir-coper');
    if (btnAbrirCoper) btnAbrirCoper.addEventListener('click', abrirCopernicoCombinadosHoy_);
    ['cx-coper-url', 'cx-coper-url-panel'].forEach(function (id) {
      var inp = document.getElementById(id);
      if (inp) inp.addEventListener('focus', function () { inp.select(); });
    });
    function abrirAyudaCx_() {
      var ov = document.getElementById('cx-help-overlay');
      if (ov) ov.hidden = false;
    }
    function cerrarAyudaCx_() {
      var ov = document.getElementById('cx-help-overlay');
      if (ov) ov.hidden = true;
    }
    var btnAyuda = document.getElementById('btn-cx-ayuda');
    if (btnAyuda) btnAyuda.addEventListener('click', abrirAyudaCx_);
    var btnAyudaCirc = document.getElementById('btn-cx-ayuda-circ');
    if (btnAyudaCirc) btnAyudaCirc.addEventListener('click', abrirAyudaCx_);
    var btnAyudaCerrar = document.getElementById('btn-cx-ayuda-cerrar');
    if (btnAyudaCerrar) btnAyudaCerrar.addEventListener('click', cerrarAyudaCx_);
    var ayudaOv = document.getElementById('cx-help-overlay');
    if (ayudaOv) {
      ayudaOv.addEventListener('click', function (e) {
        if (e.target === ayudaOv) cerrarAyudaCx_();
      });
    }
    var estWrap = document.getElementById('cx-est-btns');
    if (estWrap) {
      estWrap.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cx-est]');
        if (!b) return;
        var libre = document.getElementById('cx-est-libre');
        if (libre) libre.value = '';
        if (b.getAttribute('data-cx-todas') === '1') {
          cxSoloPreferidas_ = false;
          cxFiltroEstacion_ = '';
          cxFiltroRol_ = 'todos';
        } else if (b.getAttribute('data-cx-pref') === '1') {
          cxSoloPreferidas_ = true;
          cxFiltroEstacion_ = '';
          cxFiltroRol_ = 'enlace';
        } else {
          cxSoloPreferidas_ = false;
          cxFiltroEstacion_ = b.getAttribute('data-cx-est') || '';
          cxFiltroRol_ = 'enlace';
        }
        syncRolBtnsCx_();
        pintarPanelConexiones_();
      });
    }
    var estLibre = document.getElementById('cx-est-libre');
    if (estLibre) {
      var estLibreTimer = null;
      estLibre.addEventListener('input', function () {
        clearTimeout(estLibreTimer);
        estLibreTimer = setTimeout(function () {
          var v = String(estLibre.value || '').trim();
          if (v) {
            cxSoloPreferidas_ = false;
            cxFiltroEstacion_ = '';
            if (cxFiltroRol_ === 'todos') cxFiltroRol_ = 'enlace';
            syncRolBtnsCx_();
          }
          pintarPanelConexiones_();
        }, 220);
      });
    }
    var btnPrefs = document.getElementById('btn-cx-prefs');
    if (btnPrefs) btnPrefs.addEventListener('click', togglePanelPreferenciasCx_);
    var btnPrefsGuardar = document.getElementById('btn-cx-prefs-guardar');
    if (btnPrefsGuardar) btnPrefsGuardar.addEventListener('click', function () {
      guardarPreferenciasEstacionesCx_().catch(function () {});
    });
    var btnPrefsCerrar = document.getElementById('btn-cx-prefs-cerrar');
    if (btnPrefsCerrar) btnPrefsCerrar.addEventListener('click', function () {
      var panel = document.getElementById('cx-prefs-panel');
      if (panel) panel.hidden = true;
      if (btnPrefs) btnPrefs.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.cx-turno-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cxFiltroTurno_ = btn.getAttribute('data-cx-turno') || 'todos';
        document.querySelectorAll('.cx-turno-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        pintarPanelConexiones_();
      });
    });
    var btnCirc = document.getElementById('btn-cx-circulando');
    if (btnCirc) {
      btnCirc.addEventListener('click', function () {
        cxSoloCirculando_ = !cxSoloCirculando_;
        syncCirculandoBtnCx_();
        pintarPanelConexiones_();
      });
    }
    var btnRet = document.getElementById('btn-cx-retraso');
    if (btnRet) {
      btnRet.addEventListener('click', function () {
        cxSoloRetraso_ = !cxSoloRetraso_;
        if (cxSoloRetraso_) {
          // Al activar, ordenar por mayor demora para ver primero los peores.
          cxFiltroSort_ = 'retraso';
          var sortSelOn = document.getElementById('cx-sort');
          if (sortSelOn) sortSelOn.value = 'retraso';
        }
        syncRetrasoBtnCx_();
        pintarPanelConexiones_();
      });
    }
    document.querySelectorAll('.cx-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cxFiltroRol_ = btn.getAttribute('data-cx-rol') || 'enlace';
        syncRolBtnsCx_();
        pintarPanelConexiones_();
      });
    });
    var sortSel = document.getElementById('cx-sort');
    if (sortSel) {
      sortSel.addEventListener('change', function () {
        cxFiltroSort_ = sortSel.value || 'hora';
        pintarPanelConexiones_();
      });
    }
    var btnBuscar = document.getElementById('btn-cx-buscar');
    var inputTren = document.getElementById('cx-buscar-tren');
    if (btnBuscar) btnBuscar.addEventListener('click', pintarPanelConexiones_);
    if (inputTren) {
      inputTren.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          pintarPanelConexiones_();
        }
      });
      var searchTimer = null;
      inputTren.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(pintarPanelConexiones_, 220);
      });
    }
    var boxRes = document.getElementById('cx-resultados');
    if (boxRes) {
      boxRes.addEventListener('change', function (e) {
        var chk = e.target.closest('.cx-realizado-check');
        if (!chk) return;
        var key = chk.getAttribute('data-cx-key') || '';
        if (!key) return;
        cxToggleRealizadoManual_(key, !!chk.checked);
        pintarPanelConexiones_();
      });
      boxRes.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cx-enc]');
        if (!btn) return;
        e.preventDefault();
        var card = btn.closest('.cx-card');
        var fila = filaDesdeCardEnc_(card);
        if (fila) abrirModalEncaminar_(fila);
      });
    }
    var modalLista = document.getElementById('cx-modal-lista');
    if (modalLista) {
      modalLista.addEventListener('change', function (e) {
        var chk = e.target.closest('.cx-realizado-check');
        if (!chk) return;
        var key = chk.getAttribute('data-cx-key') || '';
        if (!key) return;
        cxToggleRealizadoManual_(key, !!chk.checked);
        if (cxTrenModal_) abrirModalConexiones_(cxTrenModal_);
        var scr = document.getElementById('screen-conexiones');
        if (scr && scr.classList.contains('active')) pintarPanelConexiones_();
      });
      modalLista.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cx-enc]');
        if (!btn) return;
        e.preventDefault();
        var card = btn.closest('.cx-card');
        var fila = filaDesdeCardEnc_(card);
        if (fila) abrirModalEncaminar_(fila);
      });
    }
    ['btn-cerrar-cx-encaminar', 'btn-cerrar-cx-encaminar-2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', cerrarModalEncaminar_);
    });
    var encModal = document.getElementById('modal-cx-encaminar');
    if (encModal) {
      encModal.addEventListener('click', function (e) {
        if (e.target === encModal) cerrarModalEncaminar_();
      });
    }
    var btnEncMallas = document.getElementById('btn-cx-enc-mallas');
    if (btnEncMallas) {
      btnEncMallas.addEventListener('click', function () {
        cerrarModalEncaminar_();
        go('mallas');
      });
    }
    ['btn-cerrar-conexiones', 'btn-cerrar-conexiones-2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', cerrarModalConexiones_);
    });
    var btnVerPanel = document.getElementById('btn-cx-ver-panel');
    if (btnVerPanel) {
      btnVerPanel.addEventListener('click', function () {
        var num = cxTrenModal_ || '';
        cxFiltroTren_ = num;
        if (inputTren) inputTren.value = num;
        cerrarModalConexiones_();
        go('conexiones');
      });
    }
    var modal = document.getElementById('modal-conexiones');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) cerrarModalConexiones_();
      });
    }
    refrescarUiConexiones_();
    pintarBotonesEstacionCx_();
    if (window.TurnioCxRetrasos) {
      window.TurnioCxRetrasos.setLoader(function () {
        return cargarFlotaMapa({ silent: true, fit: false }).then(function () {
          return flotaMapa;
        });
      });
      window.TurnioCxRetrasos.onChange(function () {
        refrescarLiveIndCx_();
        var scr = document.getElementById('screen-conexiones');
        if (scr && scr.classList.contains('active')) pintarPanelConexiones_();
        var modal = document.getElementById('modal-conexiones');
        if (modal && !modal.hidden && cxTrenModal_) abrirModalConexiones_(cxTrenModal_);
      });
      if (flotaMapa.length) {
        window.TurnioCxRetrasos.aplicarDesdeFlota(flotaMapa, 'turnio-flota');
      }
      if (radar.length) {
        window.TurnioCxRetrasos.aplicarDesdeRadar(radar, 'turnio-radar');
      }
      window.TurnioCxRetrasos.startPolling(2 * 60 * 1000);
      var liveInd = document.getElementById('cx-live-ind');
      if (liveInd) {
        liveInd.addEventListener('click', function () {
          liveInd.classList.remove('ok', 'err');
          liveInd.classList.add('loading');
          liveInd.textContent = 'Recargando flota TURNIO…';
          window.TurnioCxRetrasos.cargar();
        });
      }
    }
  })();
  // Los popups de Leaflet a veces no delegan bien solo en #mapa-container.
  document.addEventListener('click', function (e) {
    var scr = document.getElementById('screen-mapa');
    if (!scr || !scr.classList.contains('active')) return;
    var btnMarcha = e.target.closest('[data-marcha-tren]');
    if (btnMarcha) {
      e.preventDefault();
      marchaDesdePopup(
        btnMarcha.getAttribute('data-marcha-tren'),
        btnMarcha.getAttribute('data-marcha-trip') || ''
      );
      return;
    }
    var btnAviso = e.target.closest('[data-aviso-mapa-tren]');
    if (btnAviso) {
      e.preventDefault();
      avisoDesdeMapa(
        btnAviso.getAttribute('data-aviso-mapa-tren'),
        btnAviso.getAttribute('data-aviso-mapa-trip') || ''
      );
    }
  });
  var btnCerrarMarchaMapa = document.getElementById('btn-cerrar-mapa-marcha');
  if (btnCerrarMarchaMapa) btnCerrarMarchaMapa.addEventListener('click', cerrarMarchaMapa);

  mostrarVersionApp_();
  init();
}());

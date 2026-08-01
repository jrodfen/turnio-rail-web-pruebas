(function () {
  var status = document.getElementById('status');
  var loginShell = document.getElementById('login-shell');
  var loginForm = document.getElementById('login-form');
  var appShell = document.getElementById('app-shell');
  var nav = document.getElementById('bottom-nav');
  var list = document.getElementById('radar-list');
  var meta = document.getElementById('radar-meta');
  var api = String(window.TURNIO_EXTERNAL_API || '').replace(/\/$/, '');
  var clientKey = 'turnio_external_client_id';
  var sessionKey = 'turnio_external_session_token';
  var mode = 'TODOS';
  var radar = [];
  var sessionEmail = '';
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
    var r = await fetch(api + '/api/turnio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(Object.assign({
        accion: accion,
        clientId: clientId(),
        sessionToken: localStorage.getItem(sessionKey) || ''
      }, extra || {}))
    });
    var d;
    try { d = await r.json(); } catch (_) { throw new Error('Respuesta no válida del servicio.'); }
    if (!r.ok || d.ok === false || d.exito === false) throw new Error(d.error || 'No se pudo completar la operación.');
    return d;
  }
  function setStatus(kind, text) {
    status.className = 'status ' + kind;
    status.textContent = text;
  }
  function toast(text, type) {
    var t = document.getElementById('toast');
    t.textContent = text;
    t.className = 'toast show' + (type ? (' ' + type) : '');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () {
      t.classList.remove('show');
      t.className = 'toast';
    }, 2800);
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

  // Vista propia con scroll (Gravita show-all-trains), alojada en TURNIO.
  function pantallasScrollUrl_(codigo, modo) {
    return './pantalla-adif.html?station=' + encodeURIComponent(codigo) +
      '&modo=' + (modo === 'al' ? 'al' : 'dl');
  }

  function abrirAdifPantallas_(codigo, modo) {
    window.open(pantallasScrollUrl_(codigo, modo));
  }

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
  }

  function go(screen) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + screen);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.go === screen);
    });
    if (screen !== 'mapa') {
      detenerAutoFlota();
      cerrarMarchaMapa();
    }
    if (screen === 'radar' && !radar.length) loadRadar();
    if (screen === 'radar') refrescarAvisosRed();
    if (screen === 'avisos') cargarPantallaAvisos(true);
    if (screen === 'pantallas') abrirPantallas();
    if (screen === 'mapa') openMapa();
    if (screen === 'home') refrescarAvisosRed();
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
    }
    if (screen === 'mallas-localizador') {
      asegurarRutasMallas().catch(function (err) {
        setMallasStatus(String(err.message || err), true);
      });
    }
    gestionarAutoRadar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showApp(persona) {
    loginShell.hidden = true;
    appShell.hidden = false;
    nav.hidden = false;
    var nombre = (persona && persona.nombre) || 'Usuario';
    var email = (persona && persona.email) || document.getElementById('email').value || '';
    sessionEmail = String(email || '').trim().toLowerCase();
    document.getElementById('welcome-name').textContent = 'Hola, ' + nombre + '.';
    document.getElementById('user-name').textContent = nombre;
    var emailEl = document.getElementById('user-email');
    emailEl.textContent = email;
    emailEl.title = email;
    var userBox = emailEl.parentElement;
    if (userBox) userBox.title = email ? (nombre + ' · ' + email) : nombre;
    document.getElementById('profile-email').textContent = email;
    loadRadar();
    arrancarVigilanteDesdeCuadrante();
    gestionarAutoRadar();
    refrescarAvisosRed();
    // Precarga flota del mapa en segundo plano (no mallas: demasiado pesado).
    precargarFlotaMapa();
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
    } catch (err) {
      setMallasStatus(String(err.message || err), true);
      box.innerHTML = '<div class="empty error-text">' + esc(err.message || err) + '</div>';
    }
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
    panel.innerHTML = '<div class="marcha-empty">Consultando marcha / itinerario en vivo…</div>';
    try {
      var data = await call('marcha', { codTren: tren, tripId: trip });
      var m = data.marcha;
      if (m && m.ok) {
        item.classList.add('live');
        if (!item.querySelector('.malla-chip')) {
          var meta = item.querySelector('.malla-meta');
          if (meta) {
            var chip = document.createElement('div');
            chip.className = 'malla-chip';
            chip.textContent = '🟢 CIRCULANDO';
            meta.appendChild(chip);
          }
        }
        renderMarcha(panel, m);
      } else {
        panel.innerHTML =
          '<div class="marcha-empty">Sin posición en vivo ahora. Se muestra la ficha de malla (origen/destino/horas). El itinerario completo con paradas aparece cuando el tren circula en GTFS-RT.</div>';
      }
    } catch (err) {
      panel.innerHTML = '<div class="marcha-empty error-text">' + esc(err.message || err) + '</div>';
    }
  }

  var vigilanteActivo = false;
  var intervaloVigilante = null;
  var trenesYaAlertados = {};
  var trenesPendientesConfirmacion = [];
  var trenesPendientesDetencion = [];
  var chequeoEnCurso = false;

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
      if (!silentOff) toast('Vigilante desactivado');
    }
  }

  function toggleVigilante() {
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
    return String((c && (c.linea || c.codTren || c.mensaje)) || '');
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
      return '<div class="vig-item vig-item--red">' +
        '<div class="vig-item-linea">' + String(c.linea || '') + '</div>' +
        '<div class="vig-item-tag">' + esc(etiqueta) + '</div>' +
        '<div class="vig-item-msg">' + esc(plainText(c.mensaje)) + '</div>' +
        '</div>';
    }).join('');
    modal.hidden = false;
  }

  function mostrarModalDetenciones(items) {
    var lista = document.getElementById('lista-detenciones');
    var modal = document.getElementById('modal-detencion-grave');
    if (!lista || !modal) return;
    trenesPendientesDetencion = [];
    lista.innerHTML = items.map(function (c) {
      trenesPendientesDetencion.push(claveCritico(c));
      var etiqueta = c.etiquetaModal != null && c.etiquetaModal !== ''
        ? plainText(c.etiquetaModal)
        : 'Parado';
      var lugar = c.lugar
        ? ('<div class="vig-item-lugar">📍 ' + esc(plainText(c.lugar)) +
          (c.horaDesde ? (' · desde las <b>' + esc(plainText(c.horaDesde)) + '</b>h') : '') +
          '</div>')
        : '';
      return '<div class="vig-item vig-item--amber">' +
        '<div class="vig-item-linea">' + String(c.linea || '') + '</div>' +
        '<div class="vig-item-tag">' + esc(etiqueta) + '</div>' +
        lugar +
        '<div class="vig-item-msg">' + esc(plainText(c.mensaje)) + '</div>' +
        '</div>';
    }).join('');
    modal.hidden = false;
  }

  function procesarCriticos(criticos) {
    if (!Array.isArray(criticos) || !criticos.length) return 0;
    var nuevos = criticos.filter(function (c) {
      return !trenesYaAlertados[claveCritico(c)];
    });
    if (!nuevos.length) return criticos.length;
    // Misma regla que GAS: ≥25 → modal rojo; <25 (detención/sin salida/AVE 15-24) → naranja.
    var graves = nuevos.filter(function (c) { return Number(c.retrasoNum || 0) >= 25; });
    var detenidos = nuevos.filter(function (c) { return Number(c.retrasoNum || 0) < 25; });
    if (graves.length) mostrarModalRetrasos(graves);
    if (detenidos.length) mostrarModalDetenciones(detenidos);
    return criticos.length;
  }

  function resumenUmbralRadar() {
    var altas = 0;
    var avisos = 0;
    radar.forEach(function (a) {
      if (!a || /LIMPIA|ERROR/i.test(String(a.tipo || ''))) return;
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
    toast('Vigilante CGO escaneando red…');
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
        toast('Vigilante: ' + n + ' crítico' + (n === 1 ? '' : 's') + ' en ' + etiqueta);
      } else if (umbral.altas > 0) {
        toast('Conectado: 0 críticos nuevos (Radar ve ' + umbral.altas + ' ≥ umbral; pueden estar ya avisados o sin ruta GPS)');
      } else {
        toast('Conectado: sin críticos ahora (umbral AVE/Alvia ≥15 min, resto ≥25)');
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
      if (vigilanteActivo) toast('Vigilante error: ' + String(err.message || err));
      console.warn('[Vigilante] fallo', err);
    } finally {
      chequeoEnCurso = false;
    }
  }

  async function arrancarVigilanteDesdeCuadrante() {
    try {
      var res = await call('vigilante_cuadrante');
      if (res && res.activar) setVigilanteState(true, true);
      else if (res && res.motivo) {
        console.warn('[Vigilante cuadrante] no auto-ON:', res.motivo, res.turno || '');
      }
    } catch (err) {
      console.warn('[Vigilante cuadrante]', err);
    }
  }

  function confirmarRetrasos() {
    trenesPendientesConfirmacion.forEach(function (k) { trenesYaAlertados[k] = true; });
    trenesPendientesConfirmacion = [];
    document.getElementById('modal-retraso-grave').hidden = true;
  }
  function posponerRetrasos() {
    trenesPendientesConfirmacion = [];
    document.getElementById('modal-retraso-grave').hidden = true;
  }
  function confirmarDetenciones() {
    trenesPendientesDetencion.forEach(function (k) { trenesYaAlertados[k] = true; });
    trenesPendientesDetencion = [];
    document.getElementById('modal-detencion-grave').hidden = true;
  }
  function posponerDetenciones() {
    trenesPendientesDetencion = [];
    document.getElementById('modal-detencion-grave').hidden = true;
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
    var parts = String(texto || '').split('➞');
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
    if (n >= 6000 && n <= 7999) return 'ALVIA';
    if (n >= 8000 && n <= 9999) return 'AVANT';
    if (n >= 100 && n <= 999) return 'IR';
    if (n >= 1000 && n <= 1999) return 'AC';
    if (n >= 12000 && n <= 18999) return 'MD';
    if (n >= 19500 && n <= 29999) return 'CC';
    if (n >= 30500 && n <= 30999) return 'MD';
    if (n >= 31000 && n <= 32999) return 'CC';
    if (n < 100 || (n >= 10000 && n < 12000) || (n >= 30000 && n < 30500)) return 'LD';
    return 'TREN';
  }
  function titularTexto(s) {
    return String(s || '').toLowerCase().replace(/(^|\s|\/|·|-|_)([a-záéíóúñü])/g, function (_, a, b) {
      return a + b.toUpperCase();
    });
  }
  function abrirModalAviso() {
    sincronizarFirmaModal();
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
    var origen = opts.origen || 'ORIGEN';
    var destino = opts.destino || 'DESTINO';
    var hO = opts.hO || '[HH:MM]';
    var hD = opts.hD || '[HH:MM]';
    var matPart = opts.matPart || '';
    var situacion = opts.situacion || 'Circula con demora. [INCIDENCIA_AQUI].';
    var firma = obtenerFirmaAviso();
    var cuerpo = tipo + ' ' + tren + ' ' + origen + ' ' + hO + 'h - ' + destino + ' ' + hD + 'h' + matPart +
      ' (   v.) ' + situacion;
    if (cuerpo.indexOf('[INCIDENCIA_AQUI]') < 0) cuerpo += ' [INCIDENCIA_AQUI].';
    return firma + ': ' + cuerpo;
  }
  function situacionDesdeAlerta(alerta) {
    var demora = Number(alerta.retrasoNum || 0);
    var mensajeRadar = String(alerta.mensaje || '');
    var matchTramo = mensajeRadar.match(/Circulando entre\s+(.+?)\s+y\s+(.+?)\.\s*Próxima parada prevista:\s+(.+?)(?:\s+a las\s+([^\.]+))?\./i);
    var matchEnRuta = mensajeRadar.match(/En ruta hacia\s+(.+?)\.\s*Próxima parada prevista:\s+(.+?)\s+a las\s+([^\.]+)h\./i);
    if (matchTramo) {
      return 'Circula con ' + demora + ' minutos de demora entre ' + matchTramo[1].trim() + ' y ' + matchTramo[2].trim() +
        '. Próxima parada prevista: ' + matchTramo[3].trim() +
        (matchTramo[4] ? ' a las ' + matchTramo[4].trim() : '') + '. [INCIDENCIA_AQUI].';
    }
    if (matchEnRuta) {
      return 'Circula con ' + demora + ' minutos de demora. En ruta hacia ' + matchEnRuta[1].trim() +
        '. Llegada prevista a ' + matchEnRuta[2].trim() + ': ' + matchEnRuta[3].trim() + 'h. [INCIDENCIA_AQUI].';
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
    var destino = 'DESTINO';
    var partesRuta = textoLinea.split('|');
    if (partesRuta.length > 1) {
      var ruta = partesRuta[1].split('➞');
      if (ruta.length === 2) {
        origen = ruta[0].replace(/\(.*?\)/g, '').trim() || origen;
        destino = ruta[1].replace(/\(.*?\)/g, '').trim() || destino;
      }
    }
    var matTexto = (alerta.matLabel && alerta.matLabel !== '')
      ? alerta.matLabel
      : (alerta.mat && alerta.mat !== '' ? alerta.mat : '');
    return {
      tipo: tipoPorNumeroTren(trenNum),
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
      var ubicacion = String(contexto.ubicacion || '').trim();
      if (ubicacion) situacion += ' ' + ubicacion + '.';
      var proxima = contexto.proxima || null;
      if (proxima && proxima.nombre) {
        situacion += ' Próxima parada: ' + proxima.nombre +
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
          situacion += ' Llegada prevista a ' + id.destino + ': ' + contexto.llegadaDestino + 'h.';
        }
      }
      situacion += ' [INCIDENCIA_AQUI].';
      document.getElementById('cg-mensaje').value = construirMensajeAviso({
        tipo: id.tipo, tren: id.tren, origen: id.origen, destino: id.destino,
        hO: id.hO, hD: id.hD, matPart: id.matPart, situacion: situacion
      });
    }).catch(function () {});
  }
  function abrirAvisoDesdeAlerta(alerta) {
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
        tipo: d.tipo || tipoPorNumeroTren(d.tren || num),
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
    var x = String(a.tipo || '');
    return x.indexOf('ALERTA') >= 0 ? 'grave' : x.indexOf('AVISO') >= 0 ? 'warning' : '';
  }
  function filtered() {
    var q = String(document.getElementById('search').value || '').toLowerCase();
    return radar.filter(function (a) {
      return !q || JSON.stringify(a).toLowerCase().indexOf(q) >= 0;
    });
  }
  function render() {
    var a = filtered();
    var total = radar[0] && Number(radar[0].totalActivos);
    var incid = radar[0] && Number(radar[0].totalIncidencias);
    var home = document.getElementById('home-radar');
    meta.textContent = 'Última carga: ' + new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    if (!radar.length || (radar.length === 1 && /LIMPIA/i.test(String(radar[0].tipo || '')))) {
      var msg = radar[0] && radar[0].mensaje || 'Red operando con normalidad.';
      list.innerHTML = '<div class="empty clean">' + esc(msg) + '</div>';
      home.textContent = msg;
      return;
    }
    home.innerHTML = '<b>' + esc(String(isFinite(total) ? total : radar.length)) +
      ' trenes analizados</b> &middot; ' +
      esc(String(isFinite(incid) ? incid : radar.length)) + ' incidencias';
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
      var tieneGps = x.lat && x.lon && Math.abs(x.lat) > 0.1 && Math.abs(x.lon) > 0.1;
      return '<article class="alert ' + cls + '" data-cod="' + esc(tren) + '" data-trip="' + esc(trip) + '">' +
        '<div class="alert-head"><span>&#128308; ' + esc(x.tipo || 'AVISO') + '</span><span>&#128338; ' + esc(x.hora || '') + '</span></div>' +
        '<div class="train">&#9642; ' + esc(linea) + '</div>' +
        '<p class="message">' + esc(x.mensaje || ('Demora ' + (delay >= 0 ? '+' : '') + delay + ' min.')) + '</p>' +
        '<div class="alert-bottom"><span>&#8618; Pulsa para ver la marcha</span>' +
        '<div class="alert-actions">' +
        (tieneGps
          ? '<button class="map-btn" type="button" data-map-tren="' + esc(tren) + '">&#128506; Mapa</button>'
          : '<button class="map-btn disabled" type="button" disabled title="Sin coordenadas GPS">&#128506; Mapa</button>') +
        '<button class="generate" type="button" data-aviso-tren="' + esc(tren) + '" data-aviso-trip="' + esc(trip) + '">&#128172; Generar Aviso</button>' +
        '</div></div>' +
        '<div class="marcha-panel" hidden></div></article>';
    }).join('');
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
    var rows = paradas.slice(0, 24).map(function (p) {
      var cl = p.esActual ? 'actual' : p.esPasada ? 'pasada' : '';
      var icon = p.esActual ? '&#128205;' : p.esPasada ? '&#10003;' : '&#9675;';
      return '<div class="marcha-step ' + cl + '"><b>' + esc(p.horaEst || p.horaProgramada || '--:--') +
        '</b><span>' + icon + ' ' + esc(p.nombre || 'Parada') +
        (Number(p.delayMin || 0) > 0 ? ' <em>+' + Number(p.delayMin) + ' min</em>' : '') +
        '</span></div>';
    }).join('');
    panel.innerHTML = '<div class="marcha-head"><strong>&#128225; Marcha en vivo · Tren ' + esc(m.numTren || '') +
      '</strong><span>' + labelStatus(m.status) + '</span></div>' + ruta +
      '<div class="marcha-kpis"><span>' + (retraso > 0 ? '&#9201; ' + esc(retTxt) : '&#9989; Puntual') +
      '</span><span>' + esc(m.stopActualNombre || 'Posición disponible') + '</span></div>' +
      (rows ? '<div class="marcha-list">' + rows + '</div>' : '<div class="marcha-empty">Sin paradas disponibles en el feed.</div>') +
      '<div class="marcha-source">Fuente: Renfe GTFS-RT</div>';
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
      var data = await call('marcha', { codTren: tren, tripId: String(card.dataset.trip || '') });
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

  /** Igual que GAS producción: refresco automático cada 2 min con el radar visible. */
  function gestionarAutoRadar() {
    var pantallaRadar = document.getElementById('screen-radar');
    var activa = !!(pantallaRadar && pantallaRadar.classList.contains('active') && !appShell.hidden);
    if (activa) {
      if (!intervaloAutoRadar) {
        intervaloAutoRadar = setInterval(function () {
          var scr = document.getElementById('screen-radar');
          if (scr && scr.classList.contains('active') && !appShell.hidden) {
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
    if (!ts) return '';
    // Renfe a veces manda segundos Unix; a veces ms.
    if (ts < 1e12) ts = ts * 1000;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  async function fetchAvisosRed() {
    if (cargandoAvisosRed) return cargandoAvisosRed;
    cargandoAvisosRed = (async function () {
      try {
        var r = await fetch(api + '/api/avisos', { method: 'GET', cache: 'no-store' });
        if (r.ok) {
          var data = await r.json();
          if (data && Array.isArray(data.avisos)) return data.avisos;
        }
      } catch (_) {}
      try {
        var dataGas = await call('avisos_red', {});
        return Array.isArray(dataGas.avisos) ? dataGas.avisos : [];
      } catch (_) {
        return cacheAvisosRed.slice();
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
    var n = Array.isArray(avisos) ? avisos.length : 0;
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
      html += '<div class="infra-item"><span class="infra-dot">🔴</span><span>' +
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
    if (!avisos || !avisos.length) {
      lista.innerHTML = '<div class="empty">✅ Red operando con normalidad. No hay avisos activos.</div>';
      return;
    }
    lista.innerHTML = avisos.map(function (av) {
      var fecha = fechaAvisoTxt(av.inicio);
      return '<div class="avisos-row">' +
        (fecha ? '<div class="avisos-fecha">🕐 ' + esc(fecha) + '</div>' : '') +
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
  });

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
        var regionLabel = document.getElementById('mapa-region-label');
        if (regionLabel) {
          regionLabel.textContent = 'Flota Renfe · LD ' + (d.ld || 0) + ' · Cerc. ' + (d.cercanias || 0);
        }
        if (window._mapaLeaflet) pintarMarcadores(!!opts.fit);
        else if (cnt && flotaMapa.length) {
          cnt.textContent = flotaMapa.length + ' trenes listos · abre el mapa';
        }
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
  function arrancarAutoFlota() {
    detenerAutoFlota();
    flotaTimer = setInterval(function () {
      var scr = document.getElementById('screen-mapa');
      if (!scr || !scr.classList.contains('active')) return;
      cargarFlotaMapa({ fit: false }).catch(function () {});
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

    // Capas OpenRailwayMap (como en TURNIO GAS)
    window._capasORM = {
      standard: L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { attribution: '', opacity: 0.75, maxZoom: 19 }),
      maxspeed: L.tileLayer('https://{s}.tiles.openrailwaymap.org/maxspeed/{z}/{x}/{y}.png', { attribution: '', opacity: 0.80, maxZoom: 19 }),
      signals: L.tileLayer('https://{s}.tiles.openrailwaymap.org/signals/{z}/{x}/{y}.png', { attribution: '', opacity: 0.80, maxZoom: 19 })
    };
    window._ormEstado = 'standard';
    aplicarCapaORM(map, 'standard');
    map.on('zoomend', actualizarBtnORM);

    var leyenda = L.control({ position: 'bottomleft' });
    leyenda.onAdd = function () {
      var div = L.DomUtil.create('div', 'mapa-leyenda');
      div.innerHTML =
        '<strong style="display:block;margin-bottom:6px;">Retraso (Renfe)</strong>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#008000;"></div> ≤ 15 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#FFDE21;"></div> 16 – 60 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#FF0000;"></div> &gt; 60 min</div>';
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
      var icon = L.divIcon({
        className: '',
        html: '<div class="mapa-marker" style="width:30px;height:30px;background:' + color + ';color:' + ink + ';">' + texto + '</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
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
      '<button class="mapa-popup-btn mapa-popup-btn--aviso" type="button" data-aviso-mapa-tren="' +
        esc(cod) + '" data-aviso-mapa-trip="' + esc(String(ft.tripId || '')) +
        '">💬 Generar aviso</button></div>';
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
        omitirMallaPesada: true,
        rapida: true,
        modo: String(ft.modo || '')
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
      '<button class="mapa-popup-btn mapa-popup-btn--aviso" type="button" data-aviso-mapa-tren="' +
        esc(String(a.codTren)) + '" data-aviso-mapa-trip="' + esc(String(a.tripId || '')) +
        '">💬 Generar aviso</button>' +
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

  async function init() {
    if (!api) { setStatus('error', 'Puente externo pendiente de configurar.'); return; }
    try {
      var r = await fetch(api + '/api/health', { cache: 'no-store' });
      var d = await r.json();
      if (!r.ok || !d.ok || !d.configured) throw 0;
      setStatus('ready', 'Conexión externa preparada.');
      if (localStorage.getItem(sessionKey)) {
        try {
          var x = await call('sesion');
          showApp(x.persona);
          return;
        } catch (_) { localStorage.removeItem(sessionKey); }
      }
      loginForm.hidden = false;
    } catch (_) {
      setStatus('error', 'No se ha podido conectar con el entorno externo.');
    }
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    setStatus('pending', 'Validando acceso...');
    try {
      var d = await call('iniciar_pruebas', {
        email: document.getElementById('email').value.trim(),
        pin: document.getElementById('pin').value
      });
      if (!d.token) throw new Error('No se ha creado la sesión.');
      localStorage.setItem(sessionKey, d.token);
      setStatus('ready', 'Sesión iniciada.');
      showApp(d.persona);
    } catch (err) {
      setStatus('error', err.message);
    }
  });

  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go); });
  });
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
    setVigilanteState(false, true);
    if (intervaloAutoRadar) {
      clearInterval(intervaloAutoRadar);
      intervaloAutoRadar = null;
    }
    localStorage.removeItem(sessionKey);
    appShell.hidden = true;
    nav.hidden = true;
    loginShell.hidden = false;
    loginForm.hidden = false;
    toast('Sesión de pruebas cerrada.');
  });
  document.getElementById('btn-obtener-actualizacion').addEventListener('click', function () {
    if (!confirm('¿Descargar la última versión y reiniciar la app?\n\nTu sesión se mantiene; no hace falta volver a entrar.')) return;
    toast('Obteniendo nueva versión…', 'success');
    document.body.style.opacity = '0.55';
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('_v', String(Date.now()));
      // Evita que un ?t= viejo confunda la caché del acceso directo.
      url.searchParams.delete('t');
      setTimeout(function () {
        window.location.replace(url.toString());
      }, 350);
    } catch (err) {
      window.location.reload(true);
    }
  });
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
      gtfs.flipCard(card);
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
    buscarTrenEnMapa();
  });
  document.getElementById('mapa-buscar-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarTrenEnMapa();
    }
  });
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

  init();
}());

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
  function go(screen) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + screen);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.go === screen);
    });
    if (screen === 'radar' && !radar.length) loadRadar();
    if (screen === 'mapa') openMapa();
    if (screen === 'mallas-localizador') {
      asegurarRutasMallas().catch(function (err) {
        setMallasStatus(String(err.message || err), true);
      });
    }
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
      var regionEl = document.getElementById('region');
      var region = regionEl ? regionEl.value : 'andalucia';
      var data = await call('vigilante_chequeo', { region: region });
      if (!vigilanteActivo) return;
      var criticos = (data && data.criticos) || [];
      var n = procesarCriticos(criticos);
      var umbral = resumenUmbralRadar();
      if (n > 0) {
        toast('Vigilante: ' + n + ' crítico' + (n === 1 ? '' : 's') + ' en ' + region);
      } else if (umbral.altas > 0) {
        toast('Conectado: 0 críticos nuevos (Radar ve ' + umbral.altas + ' ≥ umbral; pueden estar ya avisados o sin ruta GPS)');
      } else {
        toast('Conectado: sin críticos ahora (umbral AVE/Alvia ≥15 min, resto ≥25)');
      }
      console.info('[Vigilante]', {
        region: region,
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
        situacion += ' Llegada prevista a ' + id.destino + ': ' + contexto.llegadaDestino + 'h.';
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
  async function loadRadar() {
    list.innerHTML = '<div class="empty">Actualizando Radar...</div>';
    try {
      var data = await call('radar', {
        modo: mode,
        region: document.getElementById('region').value
      });
      radar = Array.isArray(data.alertas) ? data.alertas : [];
      render();
      if (document.getElementById('screen-mapa').classList.contains('active') && window._mapaLeaflet) {
        pintarMarcadores();
      }
    } catch (e) {
      list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
      if (/sesión|caducada/i.test(e.message)) {
        localStorage.removeItem(sessionKey);
        appShell.hidden = true;
        nav.hidden = true;
        loginShell.hidden = false;
        loginForm.hidden = false;
      }
    }
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

  /* ── Mapa Leaflet ───────────────────────────────────────────── */
  function colorMarcador(a) {
    if (a.tipo && String(a.tipo).indexOf('ALERTA') >= 0) return '#ef4444';
    var r = Number(a.retrasoNum || 0);
    if (r >= 25) return '#ef4444';
    if (r >= 5) return '#f59e0b';
    if (a.currentStatus === 'STOPPED_AT' && r < 1) return '#3b82f6';
    return '#22c55e';
  }
  function cargarLeaflet(cb) {
    if (window.L) { cb(); return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
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
      pintarMarcadores();
      return;
    }
    var map = L.map('mapa-container', { zoomControl: false }).setView([40.0, -3.7], 6);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
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
        '<strong style="display:block;margin-bottom:6px;">Retraso</strong>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#22c55e;"></div> Puntual / &lt;5 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#f59e0b;"></div> 5 – 24 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#ef4444;"></div> ≥ 25 min</div>' +
        '<div class="mapa-leyenda-item"><div class="mapa-leyenda-dot" style="background:#3b82f6;"></div> En estación</div>';
      return div;
    };
    leyenda.addTo(map);
    window._mapaLeaflet = map;
    mapReady = true;
    pintarMarcadores();
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
  function pintarMarcadores() {
    var map = window._mapaLeaflet;
    if (!map) return;
    mapMarkers.forEach(function (m) { map.removeLayer(m); });
    mapMarkers = [];
    mapIndex = {};
    var noData = document.getElementById('mapa-no-datos');
    var cnt = document.getElementById('mapa-contador-trenes');
    var upd = document.getElementById('mapa-last-update');
    var regionLabel = document.getElementById('mapa-region-label');
    var regionSel = document.getElementById('region');
    if (regionLabel && regionSel) regionLabel.textContent = regionSel.options[regionSel.selectedIndex].text;
    var alertas = radar.filter(function (a) {
      return a.lat && a.lon && Math.abs(a.lat) > 0.1 && Math.abs(a.lon) > 0.1;
    });
    if (!alertas.length) {
      noData.hidden = false;
      cnt.textContent = radar.length ? 'Sin coordenadas GPS en este filtro' : 'Sin datos de radar';
      return;
    }
    noData.hidden = true;
    cnt.textContent = alertas.length + ' tren' + (alertas.length !== 1 ? 'es' : '') + ' en el mapa';
    upd.textContent = 'Act. ' + new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var usarCluster = !!(window.L && window.L.markerClusterGroup);
    var cluster = usarCluster ? L.markerClusterGroup({
      maxClusterRadius: 60,
      iconCreateFunction: function (c) {
        var color = '#22c55e';
        c.getAllChildMarkers().forEach(function (m) {
          var col = m.options._alertaColor || '#22c55e';
          if (col === '#ef4444') color = '#ef4444';
          else if (col === '#f59e0b' && color !== '#ef4444') color = '#f59e0b';
        });
        return L.divIcon({
          className: '',
          html: '<div class="mapa-cluster" style="background:' + color + ';">' + c.getChildCount() + '</div>',
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
      var texto = Number(a.retrasoNum) > 0 ? '+' + a.retrasoNum : '✓';
      var icon = L.divIcon({
        className: '',
        html: '<div class="mapa-marker" style="width:30px;height:30px;background:' + color + ';">' + texto + '</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -18]
      });
      var linea = plainText(a.linea || a.codTren || '–');
      var msg = plainText(a.mensaje || '');
      var retrasoHtml = Number(a.retrasoNum) > 0
        ? '<span style="color:#ef4444;font-weight:900;">+' + a.retrasoNum + ' min</span>'
        : '<span style="color:#22c55e;font-weight:900;">Puntual</span>';
      var popup =
        '<div style="min-width:200px;">' +
        '<div class="mapa-popup-linea">' + esc(linea) + '</div>' +
        '<div class="mapa-popup-msg">' + esc(msg) + '</div>' +
        '<div style="font-size:11px;margin-bottom:8px;">⏱ ' + retrasoHtml + '</div>' +
        (a.codTren
          ? '<button class="mapa-popup-btn" type="button" data-marcha-tren="' + esc(String(a.codTren)) +
            '" data-marcha-trip="' + esc(String(a.tripId || '')) + '">📡 Ver marcha en tiempo real</button>'
          : '') +
        '</div>';
      var marker = L.marker([lat, lon], {
        icon: icon,
        _alertaColor: color,
        _codTren: String(a.codTren || '')
      }).bindPopup(popup, { maxWidth: 280 });
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
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    else if (bounds.length === 1) map.setView(bounds[0], 9);
  }
  function openMapa() {
    if (!radar.length) {
      loadRadar().then(function () {
        cargarLeaflet(crearMapa);
      });
      return;
    }
    cargarLeaflet(crearMapa);
  }
  function buscarTrenEnMapa(numForzado) {
    var input = document.getElementById('mapa-buscar-input');
    var msg = document.getElementById('mapa-busqueda-msg');
    var num = String(numForzado || input.value || '').replace(/\D/g, '').replace(/^0+/, '');
    if (numForzado && input) input.value = num;
    if (!num) {
      msg.textContent = 'Introduce un número de tren.';
      msg.className = 'err';
      return false;
    }
    var marker = mapIndex[num];
    if (!marker) {
      msg.textContent = 'Tren ' + num + ' no está en el mapa con este filtro.';
      msg.className = 'err';
      return false;
    }
    var map = window._mapaLeaflet;
    if (!map) return false;

    function abrirPopup() {
      try { marker.openPopup(); } catch (_) {}
      msg.textContent = 'Tren ' + num + ' ubicado.';
      msg.className = '';
    }

    // Si está en un cluster, zoomToShowLayer saca el marcador sin cambiar el
    // aspecto general del mapa (los clusters siguen igual para el resto).
    var clusterGroup = window._mapaClusterGroup;
    if (clusterGroup && typeof clusterGroup.zoomToShowLayer === 'function' &&
        clusterGroup.hasLayer && clusterGroup.hasLayer(marker)) {
      clusterGroup.zoomToShowLayer(marker, abrirPopup);
      return true;
    }

    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12));
    setTimeout(abrirPopup, 80);
    return true;
  }
  function abrirMapaTren(tren) {
    var num = String(tren || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!num) { toast('No hay número de tren.'); return; }
    var alerta = radar.filter(function (a) {
      return String(a.codTren || '').replace(/^0+/, '') === num;
    })[0];
    if (!alerta || !(alerta.lat && alerta.lon && Math.abs(alerta.lat) > 0.1)) {
      toast('Este tren no tiene posición GPS ahora mismo.');
      return;
    }
    go('mapa');
    var intentos = 0;
    (function esperarMapa() {
      intentos++;
      if (window._mapaLeaflet && mapIndex[num]) {
        buscarTrenEnMapa(num);
        return;
      }
      if (intentos < 25) setTimeout(esperarMapa, 120);
      else toast('No se pudo ubicar el tren en el mapa.');
    })();
  }
  async function marchaDesdePopup(tren, trip) {
    go('radar');
    toast('Abriendo marcha del tren ' + tren + '…');
    setTimeout(function () {
      var card = list.querySelector('.alert[data-cod="' + tren + '"]');
      if (card) abrirMarcha(card);
      else toast('El tren no está en la lista actual del Radar.');
    }, 250);
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
  document.querySelectorAll('[data-coming]').forEach(function (b) {
    b.addEventListener('click', function () {
      toast(b.dataset.coming + ' se incorporará en el siguiente bloque.');
    });
  });
  document.querySelectorAll('.filter').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.mode;
      document.querySelectorAll('.filter').forEach(function (x) {
        x.classList.toggle('active', x === b);
      });
      loadRadar();
    });
  });
  document.getElementById('region').addEventListener('change', loadRadar);
  document.getElementById('search').addEventListener('input', render);
  document.getElementById('logout').addEventListener('click', function () {
    setVigilanteState(false, true);
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
    loadRadar().then(function () {
      if (window._mapaLeaflet) {
        window._mapaLeaflet.invalidateSize();
        pintarMarcadores();
      }
    });
  });
  document.getElementById('btn-ubicar-mapa').addEventListener('click', buscarTrenEnMapa);
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
  document.getElementById('mapa-container').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-marcha-tren]');
    if (!btn) return;
    marchaDesdePopup(btn.getAttribute('data-marcha-tren'), btn.getAttribute('data-marcha-trip') || '');
  });

  init();
}());

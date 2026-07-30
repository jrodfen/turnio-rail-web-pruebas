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
  function toast(text) {
    var t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2800);
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showApp(persona) {
    loginShell.hidden = true;
    appShell.hidden = false;
    nav.hidden = false;
    var nombre = (persona && persona.nombre) || 'Usuario';
    var email = (persona && persona.email) || document.getElementById('email').value || '';
    document.getElementById('welcome-name').textContent = 'Hola, ' + nombre + '.';
    document.getElementById('user-name').textContent = nombre;
    var emailEl = document.getElementById('user-email');
    emailEl.textContent = email;
    emailEl.title = email;
    var userBox = emailEl.parentElement;
    if (userBox) userBox.title = email ? (nombre + ' · ' + email) : nombre;
    document.getElementById('profile-email').textContent = email;
    loadRadar();
  }

  var vigilanteActivo = false;
  function setVigilanteUI(on) {
    vigilanteActivo = !!on;
    var btn = document.getElementById('btn-vigilante');
    var txt = document.getElementById('txt-vigilante');
    if (!btn || !txt) return;
    btn.classList.toggle('on', vigilanteActivo);
    btn.setAttribute('aria-pressed', vigilanteActivo ? 'true' : 'false');
    txt.textContent = vigilanteActivo ? 'VIGILANTE: ON' : 'VIGILANTE: OFF';
  }
  function toggleVigilante() {
    setVigilanteUI(!vigilanteActivo);
    toast(vigilanteActivo
      ? 'Vigilante activado (estado local de pruebas)'
      : 'Vigilante desactivado');
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
        '<button class="generate" type="button">&#128172; Generar Aviso</button>' +
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
    localStorage.removeItem(sessionKey);
    appShell.hidden = true;
    nav.hidden = true;
    loginShell.hidden = false;
    loginForm.hidden = false;
    toast('Sesión de pruebas cerrada.');
  });
  document.getElementById('btn-monitor').addEventListener('click', function () {
    toggleMonitorMode(true);
  });
  document.getElementById('btn-exit-monitor').addEventListener('click', function () {
    toggleMonitorMode(false);
  });
  document.getElementById('btn-mapa').addEventListener('click', function () { go('mapa'); });
  document.getElementById('btn-vigilante').addEventListener('click', toggleVigilante);
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
      toast('La generación de avisos se incorporará tras migrar su API.');
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

/**
 * Retrasos para servicios enlazados usando el tiempo real de TURNIO
 * (flota del mapa /api/flota o flota_mapa), no el JSON de GitHub Pages.
 */
(function (global) {
  'use strict';

  var MAPEO_URL =
    'https://cdn.jsdelivr.net/gh/jrodfen/servicios-enlazados@main/mapeo_trenes.json';

  var data = Object.create(null);
  var mapeoVm = Object.create(null);
  var mapeoMv = Object.create(null);
  var eqCache = Object.create(null);
  var meta = {
    cargado: false,
    total: 0,
    fuente: '',
    horaJson: '—',
    recarga: '—',
    error: ''
  };
  var pollTimer = null;
  var listeners = [];
  var mapeoPromise = null;
  var externalLoader = null;

  function limpiarCod(val) {
    var s = String(val == null ? '' : val).trim();
    if (!s) return '';
    var m = s.match(/(\d{2,6})/);
    return m ? String(parseInt(m[1], 10)) : s.replace(/\D/g, '');
  }

  function fetchJson(url, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
    return fetch(url, { cache: 'no-store', signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(t); });
  }

  function asegurarMapeo() {
    if (mapeoPromise) return mapeoPromise;
    mapeoPromise = fetchJson(MAPEO_URL, 12000)
      .then(function (json) {
        mapeoVm = json.venta_a_marcha || json.ventaAMarcha || {};
        mapeoMv = json.marcha_a_venta || json.marchaAVenta || {};
        eqCache = Object.create(null);
      })
      .catch(function () {
        mapeoVm = Object.create(null);
        mapeoMv = Object.create(null);
      });
    return mapeoPromise;
  }

  function equivalentes(codigoEntrada) {
    var codigo = limpiarCod(codigoEntrada);
    if (!codigo) return [];
    if (eqCache[codigo]) return eqCache[codigo];
    var set = {};
    set[codigo] = true;
    var m1 = mapeoVm[codigo];
    var m2 = mapeoMv[codigo];
    if (m1 != null && m1 !== '') set[limpiarCod(m1)] = true;
    if (m2 != null && m2 !== '') set[limpiarCod(m2)] = true;
    var out = Object.keys(set).filter(Boolean);
    eqCache[codigo] = out;
    return out;
  }

  function detalle(codigoExcel) {
    var codigo = limpiarCod(codigoExcel);
    if (!codigo) {
      return { encontrado: false, codigoExcel: '', codigoJson: null, retraso: undefined, tipo: 'sin_codigo' };
    }
    var eqs = equivalentes(codigo);
    for (var i = 0; i < eqs.length; i++) {
      var cod = eqs[i];
      if (Object.prototype.hasOwnProperty.call(data, cod)) {
        return {
          encontrado: true,
          codigoExcel: codigo,
          codigoJson: cod,
          retraso: data[cod],
          tipo: cod === codigo ? 'exacto' : 'equivalencia'
        };
      }
    }
    return { encontrado: false, codigoExcel: codigo, codigoJson: null, retraso: undefined, tipo: 'sin_dato' };
  }

  function minutos(codigo) {
    var info = detalle(codigo);
    if (!info.encontrado) return undefined;
    var r = Number(info.retraso);
    return isFinite(r) ? r : 0;
  }

  function textoBadge(info) {
    if (!info || !info.encontrado) return '';
    var r = Number(info.retraso);
    if (!isFinite(r)) r = 0;
    var ret = r <= 0 ? 'Puntual' : ('+' + r + '′');
    // Equivalencia solo en title del badge (en móvil el texto · excel→json desborda).
    return ret;
  }

  function badgeHtml(codigoExcel, escFn) {
    var esc = typeof escFn === 'function' ? escFn : function (s) { return String(s == null ? '' : s); };
    var info = detalle(codigoExcel);
    if (!info.encontrado) return '';
    var r = Number(info.retraso);
    if (!isFinite(r)) r = 0;
    var clases = 'cx-retraso-badge' + (r <= 0 ? ' cx-retraso-ok' : '') +
      (info.tipo === 'equivalencia' ? ' cx-retraso-eq' : '');
    var title = info.tipo === 'equivalencia'
      ? 'Cruce venta/circulación: ' + info.codigoExcel + ' → ' + info.codigoJson
      : 'Tiempo real flota Renfe: ' + info.codigoJson + (r < 0 ? ' (adelanto ' + Math.abs(r) + ' min)' : '');
    return ' <span class="' + clases + '" title="' + esc(title) + '">' + esc(textoBadge(info)) + '</span>';
  }

  function horaAMinutos(hStr) {
    var m = String(hStr || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function riesgoHtml(fila, escFn) {
    var esc = typeof escFn === 'function' ? escFn : function (s) { return String(s == null ? '' : s); };
    var ret = minutos(fila && fila.servicio);
    // Solo demora positiva real; ignorar 0 / adelantos / ruido ±1 del radar.
    if (ret === undefined || ret < 1) return '';
    var hL = horaAMinutos(fila.horaLlegadaEnlace);
    var hS = horaAMinutos(fila.horaSalidaEnlace);
    if (hL < 0 || hS < 0) return '';
    var margen = hS - (hL + ret);
    if (margen <= 0) {
      return '<span class="cx-riesgo-badge">¡Enlace en riesgo! (+' + esc(String(ret)) + ' min)</span>';
    }
    if (margen <= 10) {
      return '<span class="cx-riesgo-badge cx-riesgo-warn">Enlace ajustado — ' +
        esc(String(margen)) + ' min margen (+' + esc(String(ret)) + ' min)</span>';
    }
    return '';
  }

  function esperaBubbleHtml(esperaPlan, codigoOrigen) {
    var espera = Number(esperaPlan) || 0;
    var tClass = 'cx-t-ok';
    if (espera > 60) tClass = 'cx-t-danger';
    else if (espera > 30) tClass = 'cx-t-warn';
    var ret = minutos(codigoOrigen);
    if (ret === undefined || ret <= 0) {
      return '<div class="cxn-espera ' + tClass + '"><span class="cxn-espera-ico" aria-hidden="true">&#9201;</span><b>' +
        espera + '</b><small>min</small></div>';
    }
    var eReal = espera - ret;
    var col = eReal <= 0 ? '#dc2626' : eReal < 10 ? '#f97316' : eReal < 20 ? '#d97706' : '#16a34a';
    var bg = eReal <= 0 ? '#fee2e2' : eReal < 10 ? '#fff7ed' : '#f0fdf4';
    var txt = eReal <= 0 ? ('⚠ ' + eReal) : String(eReal);
    return '<div class="cxn-espera-wrap">' +
      '<div class="cxn-espera ' + tClass + '" title="Espera planificada: ' + espera + ' min">' +
      '<span class="cxn-espera-ico" aria-hidden="true">&#9201;</span><b>' + espera +
      '</b><small class="cxn-espera-sub">plan</small></div>' +
      '<div class="cxn-espera-real" title="Espera real (+' + ret + ' min retraso)" style="border-color:' + col +
      ';background:' + bg + ';color:' + col + '"><span class="cxn-espera-ico" aria-hidden="true">⚡</span><b>' +
      txt + '</b><small class="cxn-espera-sub">real</small></div></div>';
  }

  function stampMeta_(fuente) {
    meta.cargado = true;
    meta.total = Object.keys(data).length;
    meta.fuente = fuente || 'turnio';
    meta.error = '';
    meta.horaJson = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    meta.recarga = new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function codDesdeTren_(t) {
    return limpiarCod(t && (t.codTren || t.codComercial || t.tren || t.servicio || t.numTren));
  }

  /** Parsea minutos de demora sin convertir -1 (adelanto) en 0 por el `||`. */
  function parseRetrasoMin_(v) {
    if (v == null || v === '') return null;
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = Number(v);
    if (!isFinite(n)) return null;
    return n;
  }

  function retrasoDesdeTren_(t) {
    if (!t) return 0;
    var n = parseRetrasoMin_(t.retrasoNum);
    if (n == null) n = parseRetrasoMin_(t.ultRetraso);
    if (n == null) n = parseRetrasoMin_(t.delayMin);
    // "retraso" en alertas Radar a veces es texto; solo aceptar numérico puro.
    if (n == null && t.retraso != null && t.retraso !== '' && isFinite(Number(t.retraso))) {
      n = parseRetrasoMin_(t.retraso);
    }
    return n == null ? 0 : n;
  }

  /** Sustituye el índice con la flota viva de TURNIO (mapa / Renfe visor). */
  function aplicarDesdeFlota(trenes, fuente) {
    var next = Object.create(null);
    (trenes || []).forEach(function (t) {
      var cod = codDesdeTren_(t);
      if (!cod) return;
      next[cod] = retrasoDesdeTren_(t);
    });
    data = next;
    stampMeta_(fuente || 'turnio-flota');
    notificar();
    return estado();
  }

  /**
   * Fusiona demoras del Radar sin pisar la flota Renfe.
   * El TripUpdate GTFS a menudo redondea ruido de 30–90 s a "+1 min" y
   * dejaba todas las tarjetas de enlaces en +1 aunque la flota dijera otra cosa.
   */
  function aplicarDesdeRadar(alertas, fuente) {
    var hubo = false;
    (alertas || []).forEach(function (a) {
      var cod = codDesdeTren_(a);
      if (!cod) return;
      if (a.retrasoNum == null && a.ultRetraso == null && a.delayMin == null) return;
      var rRadar = retrasoDesdeTren_(a);
      if (!Object.prototype.hasOwnProperty.call(data, cod)) {
        // Solo huecos: tren visto en Radar pero aún no en flota mapa.
        data[cod] = rRadar;
        hubo = true;
        return;
      }
      var rPrev = Number(data[cod]);
      if (!isFinite(rPrev)) rPrev = 0;
      // Si ya hay flota, solo subir si el Radar aporta claramente más demora
      // (evita ruido ±1 min del TripUpdate).
      if (rRadar >= 3 && rRadar > rPrev + 1) {
        data[cod] = rRadar;
        hubo = true;
      }
    });
    if (hubo) {
      stampMeta_(fuente || (meta.fuente ? meta.fuente + '+radar' : 'turnio-radar'));
      notificar();
    }
    return estado();
  }

  function notificar() {
    listeners.forEach(function (fn) {
      try { fn(estado()); } catch (e) { /* ignore */ }
    });
  }

  function setLoader(fn) {
    externalLoader = typeof fn === 'function' ? fn : null;
  }

  function cargar() {
    return asegurarMapeo().then(function () {
      if (!externalLoader) {
        meta.cargado = false;
        meta.error = 'Sin cargador de flota TURNIO';
        notificar();
        return estado();
      }
      return Promise.resolve()
        .then(function () { return externalLoader(); })
        .then(function (trenes) {
          if (!trenes || !trenes.length) throw new Error('Flota TURNIO vacía');
          aplicarDesdeFlota(trenes, 'turnio-flota');
          return estado();
        })
        .catch(function (err) {
          meta.cargado = Object.keys(data).length > 0;
          meta.error = String(err && err.message ? err.message : err);
          if (!meta.cargado) meta.fuente = '';
          notificar();
          return estado();
        });
    });
  }

  function estado() {
    return {
      cargado: meta.cargado,
      total: meta.total,
      fuente: meta.fuente,
      horaJson: meta.horaJson,
      recarga: meta.recarga,
      error: meta.error,
      label: meta.cargado
        ? ('TURNIO tiempo real · ' + meta.total + ' trenes · ' + meta.recarga)
        : (meta.error ? ('Sin flota · ' + meta.error) : 'Cargando flota TURNIO…')
    };
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function startPolling(ms) {
    stopPolling();
    cargar();
    pollTimer = setInterval(cargar, Math.max(30000, ms || 2 * 60 * 1000));
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  global.TurnioCxRetrasos = {
    setLoader: setLoader,
    cargar: cargar,
    startPolling: startPolling,
    stopPolling: stopPolling,
    estado: estado,
    onChange: onChange,
    aplicarDesdeFlota: aplicarDesdeFlota,
    aplicarDesdeRadar: aplicarDesdeRadar,
    detalle: detalle,
    minutos: minutos,
    badgeHtml: badgeHtml,
    riesgoHtml: riesgoHtml,
    esperaBubbleHtml: esperaBubbleHtml,
    limpiarCod: limpiarCod
  };
})(typeof window !== 'undefined' ? window : this);

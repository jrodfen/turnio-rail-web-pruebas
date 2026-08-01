/**
 * Retrasos en tiempo real para el panel de servicios enlazados.
 * Fuente principal: retrasos.json vivo de servicios-enlazados (GitHub Actions).
 * Fallback: flotaLD Renfe (y proxy CORS si hace falta).
 */
(function (global) {
  'use strict';

  var RETRASOS_SE =
    'https://jrodfen.github.io/servicios-enlazados/retrasos.json';
  var RETRASOS_RENFE =
    'https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json';
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
    fechaJson: '',
    horaJson: '—',
    recarga: '—',
    error: ''
  };
  var pollTimer = null;
  var listeners = [];
  var mapeoPromise = null;

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
    return info.encontrado ? Number(info.retraso || 0) : undefined;
  }

  function textoBadge(info) {
    if (!info || !info.encontrado) return '';
    var r = Number(info.retraso || 0);
    var ret = r === 0 ? 'Puntual' : '+' + r + ' min';
    var eq = info.tipo === 'equivalencia' ? ' · ' + info.codigoExcel + '→' + info.codigoJson : '';
    return ret + eq;
  }

  function badgeHtml(codigoExcel, escFn) {
    var esc = typeof escFn === 'function' ? escFn : function (s) { return String(s == null ? '' : s); };
    var info = detalle(codigoExcel);
    if (!info.encontrado) return '';
    var r = Number(info.retraso || 0);
    var clases = 'cx-retraso-badge' + (r === 0 ? ' cx-retraso-ok' : '') +
      (info.tipo === 'equivalencia' ? ' cx-retraso-eq' : '');
    var title = info.tipo === 'equivalencia'
      ? 'Cruce venta/circulación: ' + info.codigoExcel + ' → ' + info.codigoJson
      : 'Tiempo real: ' + info.codigoJson;
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
    if (ret === undefined || ret <= 0) return '';
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
      return '<div class="cxn-espera ' + tClass + '">&#9201;<br><b>' + espera + '</b><br><small>min</small></div>';
    }
    var eReal = espera - ret;
    var col = eReal <= 0 ? '#dc2626' : eReal < 10 ? '#f97316' : eReal < 20 ? '#d97706' : '#16a34a';
    var bg = eReal <= 0 ? '#fee2e2' : eReal < 10 ? '#fff7ed' : '#f0fdf4';
    var txt = eReal <= 0 ? ('⚠ ' + eReal) : String(eReal);
    return '<div class="cxn-espera-wrap">' +
      '<div class="cxn-espera ' + tClass + '" title="Espera planificada: ' + espera + ' min">' +
      '<small>&#9201;</small><br><b>' + espera + '</b><br><small class="cxn-espera-sub">plan</small></div>' +
      '<div class="cxn-espera-real" title="Espera real (+' + ret + ' min retraso)" style="border-color:' + col +
      ';background:' + bg + ';color:' + col + '"><small>⚡</small><br><b>' + txt +
      '</b><br><small class="cxn-espera-sub">real</small></div></div>';
  }

  function aplicarJson(json, fuente) {
    var next = Object.create(null);
    (json.trenes || []).forEach(function (t) {
      var cod = limpiarCod(t.codComercial);
      if (!cod) return;
      next[cod] = parseInt(t.ultRetraso, 10) || 0;
    });
    data = next;
    meta.cargado = true;
    meta.total = Object.keys(data).length;
    meta.fuente = fuente;
    meta.error = '';
    meta.fechaJson = json.fechaActualizacion || '';
    meta.horaJson = '—';
    if (meta.fechaJson) {
      var m = String(meta.fechaJson).match(/T(\d{2}:\d{2})/);
      if (m) meta.horaJson = m[1];
    }
    meta.recarga = new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function notificar() {
    listeners.forEach(function (fn) {
      try { fn(estado()); } catch (e) { /* ignore */ }
    });
  }

  function cargar() {
    return asegurarMapeo().then(function () {
      var bust = '?v=' + Date.now();
      return fetchJson(RETRASOS_SE + bust, 8000)
        .then(function (json) {
          aplicarJson(json, 'servicios-enlazados');
        })
        .catch(function () {
          return fetchJson(RETRASOS_RENFE + bust, 8000).then(function (json) {
            aplicarJson(json, 'renfe-flotaLD');
          });
        })
        .catch(function () {
          var proxy = 'https://corsproxy.io/?' + encodeURIComponent(RETRASOS_RENFE + bust);
          return fetchJson(proxy, 10000).then(function (json) {
            if (json && json.contents) json = JSON.parse(json.contents);
            aplicarJson(json, 'proxy-renfe');
          });
        })
        .catch(function (err) {
          meta.cargado = false;
          meta.error = String(err && err.message ? err.message : err);
          meta.fuente = '';
        })
        .then(function () {
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
        ? ('Tiempo real · ' + meta.total + ' trenes · JSON ' + meta.horaJson + ' · ' + meta.recarga)
        : (meta.error ? ('Sin retrasos · ' + meta.error) : 'Cargando tiempo real…')
    };
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function startPolling(ms) {
    stopPolling();
    cargar();
    pollTimer = setInterval(cargar, Math.max(60000, ms || 5 * 60 * 1000));
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  global.TurnioCxRetrasos = {
    cargar: cargar,
    startPolling: startPolling,
    stopPolling: stopPolling,
    estado: estado,
    onChange: onChange,
    detalle: detalle,
    minutos: minutos,
    badgeHtml: badgeHtml,
    riesgoHtml: riesgoHtml,
    esperaBubbleHtml: esperaBubbleHtml,
    limpiarCod: limpiarCod
  };
})(typeof window !== 'undefined' ? window : this);

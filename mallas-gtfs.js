/* Buscador GTFS / cuadro de horarios (paridad operativa con VistaBuscadorGTFS de GAS). */
(function (global) {
  'use strict';

  var URL_OPERATIVA =
    'https://raw.githubusercontent.com/jrodfen/turnio-mallas-motor/main/operativa_diaria.json';
  var CACHE_NAME = 'turnio-operativa-gtfs-v1';
  var SCHEMA = 'v1.8-7d-r2';
  var cargando = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
    });
  }

  function formatTime(t) {
    var m = String(t || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return '--:--';
    var hh = parseInt(m[1], 10) % 24;
    return String(hh).padStart(2, '0') + ':' + m[2];
  }

  function minutosGTFSExtendido_(t) {
    var m = String(t || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function limpiarNumeroTren(tripId) {
    var str = String(tripId || '').toUpperCase();
    if (str.startsWith('R') || str.match(/^[LMXJVSD]R/)) {
      var rNum = str.replace(/^[LMXJVSD]/, '');
      var rMatch = rNum.match(/(R\d{3,5})/);
      return rMatch ? rMatch[1] : rNum;
    }
    var sinDia = str.replace(/^[LMXJVSD]/, '');
    var match5 = str.match(/(\d{5})/);
    if (match5) return match5[1];
    var matchCualquiera = sinDia.match(/(\d+)/);
    return matchCualquiera ? matchCualquiera[1] : sinDia;
  }

  function turnioFechaGtfsLocal_(fecha) {
    if (typeof fecha === 'string') {
      var texto = fecha.trim().replace(/-/g, '');
      if (/^\d{8}$/.test(texto)) return texto;
    }
    var f = fecha instanceof Date ? fecha : new Date();
    return String(f.getFullYear()) +
      String(f.getMonth() + 1).padStart(2, '0') +
      String(f.getDate()).padStart(2, '0');
  }

  function turnioServicioCirculaEnFecha_(serviceId, fecha) {
    var id = String(serviceId || '').trim();
    if (!id) return true;
    var claveFecha = turnioFechaGtfsLocal_(fecha);
    var excepcion = global.excepcionesCalendario && global.excepcionesCalendario[id] &&
      global.excepcionesCalendario[id][claveFecha];
    if (excepcion === 1 || excepcion === '1') return true;
    if (excepcion === 2 || excepcion === '2') return false;
    var cal = global.calendarios && global.calendarios[id];
    if (!cal) return true;
    if (cal.s && claveFecha < cal.s) return false;
    if (cal.e && claveFecha > cal.e) return false;
    var patron = String(cal.d || '');
    if (patron.length !== 7) return true;
    var indiceGtfs = (new Date(
      Number(claveFecha.slice(0, 4)),
      Number(claveFecha.slice(4, 6)) - 1,
      Number(claveFecha.slice(6, 8))
    ).getDay() + 6) % 7;
    return patron.charAt(indiceGtfs) === '1';
  }

  function procesarJsonOperativaEnMemoria(operativa) {
    global.estaciones = operativa.e || {};
    global.horarios = (operativa.h || []).map(function (item) {
      return {
        trip_id: item.t, stop_id: item.s, arrival_time: item.a,
        departure_time: item.d, stop_sequence: item.q
      };
    });
    global.calendarios = operativa.c || {};
    global.excepcionesCalendario = operativa.x || {};
    global.viajes = {};
    var regexConocidos = /\b(ave|alvia|avant|intercity|md|media distancia|regional|avlo|euromed|trenhotel|proximidad|express)\b/i;
    var sourceViajes = operativa.j || {};
    for (var id in sourceViajes) {
      var nombreFrontal = sourceViajes[id].f || '';
      var catProd = sourceViajes[id].p || 'TREN';
      var matchRegex = nombreFrontal.match(regexConocidos);
      if (matchRegex) catProd = matchRegex[0].toUpperCase();
      else if (sourceViajes[id].c || String(catProd).toLowerCase().indexOf('cercan') !== -1) catProd = 'Cercanías';
      global.viajes[id] = {
        numero_tren: sourceViajes[id].n,
        productoFiltro: catProd,
        nombreVisualFrontal: nombreFrontal,
        lineaTren: sourceViajes[id].l,
        esCercanias: sourceViajes[id].c,
        service_id: sourceViajes[id].s,
        unidad: sourceViajes[id].u,
        accesible: sourceViajes[id].a === '1' ? 'Sí ♿' : 'No'
      };
    }
    global.limitesViajes = {};
    var sourceLimites = operativa.l || {};
    for (var lid in sourceLimites) {
      global.limitesViajes[lid] = {
        min: sourceLimites[lid].min,
        max: sourceLimites[lid].max,
        origen: sourceLimites[lid].o,
        destino: sourceLimites[lid].d,
        hora_llegada_destino: sourceLimites[lid].h
      };
    }
  }

  function actualizarIndiceParadasPorTripGTFS() {
    var idx = {};
    (global.horarios || []).forEach(function (h) {
      if (!h || !h.trip_id) return;
      if (!idx[h.trip_id]) idx[h.trip_id] = [];
      idx[h.trip_id].push(h);
    });
    Object.keys(idx).forEach(function (tid) {
      idx[tid].sort(function (a, b) {
        return parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10);
      });
    });
    global._gtfsIdxParadasTrip = idx;
  }

  function obtenerParadasViajeOrdenadas(tripId) {
    var idx = global._gtfsIdxParadasTrip;
    if (idx && idx[tripId]) return idx[tripId];
    var arr = (global.horarios || []).filter(function (h) { return h.trip_id === tripId; });
    arr.sort(function (a, b) {
      return parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10);
    });
    return arr;
  }

  function nombresExtremosViajeDesdeParadas(paradas) {
    if (!paradas || !paradas.length) return null;
    return {
      org: global.estaciones[paradas[0].stop_id] || 'Desc.',
      dest: global.estaciones[paradas[paradas.length - 1].stop_id] || 'Desc.'
    };
  }

  function generarHtmlMarchaItinerario(paradas, stopSequenceConsulta) {
    if (!paradas || !paradas.length) return '';
    var sqU = parseInt(stopSequenceConsulta, 10);
    return paradas.map(function (p, idx) {
      var sq = parseInt(p.stop_sequence, 10);
      var esTu = !isNaN(sqU) && sq === sqU;
      var tShow = formatTime(p.departure_time || p.arrival_time);
      var nombre = global.estaciones[p.stop_id] || 'Estación';
      var cls = esTu ? ' step-actual' : '';
      var last = idx === paradas.length - 1 ? ' is-last' : '';
      return '<div class="malla-step' + cls + last + '">' +
        '<span class="malla-step-time">' + esc(tShow) + '</span>' +
        '<span class="malla-step-station">' + esc(nombre) + (esTu ? ' · tu parada' : '') + '</span></div>';
    }).join('');
  }

  function reconstruirSelectores() {
    global.mapaEstacionesGlobal = {};
    Object.keys(global.estaciones || {}).forEach(function (key) {
      var nombre = global.estaciones[key];
      if (!global.mapaEstacionesGlobal[nombre]) global.mapaEstacionesGlobal[nombre] = [];
      global.mapaEstacionesGlobal[nombre].push(key);
    });
    var selectProducto = document.getElementById('filtroProducto');
    if (selectProducto) {
      selectProducto.innerHTML = '<option value="">Todos</option>';
      var productosUnicos = {};
      Object.keys(global.viajes || {}).forEach(function (key) {
        var prod = global.viajes[key].productoFiltro;
        if (prod && !productosUnicos[prod]) {
          productosUnicos[prod] = true;
          selectProducto.appendChild(new Option(prod, prod));
        }
      });
    }
    var fecha = document.getElementById('filtroFechaServicio');
    if (fecha && !fecha.value) {
      var d = new Date();
      fecha.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      fecha.min = fecha.value;
      var max = new Date(d.getTime() + 6 * 86400000);
      fecha.max = max.getFullYear() + '-' + String(max.getMonth() + 1).padStart(2, '0') + '-' + String(max.getDate()).padStart(2, '0');
    }
    actualizarIndiceParadasPorTripGTFS();
  }

  function setStatus(msg, isError) {
    var el = document.getElementById('gtfs-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--primary-dark)';
  }

  function setProgress(pct) {
    var wrap = document.getElementById('gtfs-progress-wrap');
    var bar = document.getElementById('gtfs-progress-bar');
    if (!wrap || !bar) return;
    wrap.hidden = false;
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  async function asegurarOperativaGtfs(opts) {
    opts = opts || {};
    if (global.horarios && global.horarios.length && global.viajes && Object.keys(global.viajes).length) {
      document.getElementById('gtfs-carga').hidden = true;
      document.getElementById('gtfs-busqueda').hidden = false;
      reconstruirSelectores();
      return true;
    }
    if (cargando) return cargando;
    cargando = (async function () {
      var panelCarga = document.getElementById('gtfs-carga');
      var panelBusqueda = document.getElementById('gtfs-busqueda');
      if (panelCarga) panelCarga.hidden = false;
      if (panelBusqueda) panelBusqueda.hidden = true;
      setStatus('Sincronizando operativa diaria…');
      setProgress(5);
      var data = null;
      try {
        if (global.caches) {
          var cache = await caches.open(CACHE_NAME);
          var cached = await cache.match(URL_OPERATIVA);
          if (cached) {
            setStatus('Cargando mallas desde caché del dispositivo…');
            setProgress(40);
            data = await cached.json();
          }
        }
      } catch (e) {}
      if (!data) {
        setStatus('Descargando operativa (~28 MB). La primera vez puede tardar…');
        setProgress(15);
        var res = await fetch(URL_OPERATIVA + '?_=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo descargar la operativa GTFS.');
        setProgress(55);
        data = await res.json();
        setProgress(80);
        try {
          if (global.caches) {
            var c2 = await caches.open(CACHE_NAME);
            await c2.put(URL_OPERATIVA, new Response(JSON.stringify(data), {
              headers: { 'Content-Type': 'application/json' }
            }));
          }
        } catch (ePut) {}
      }
      setStatus('Procesando mallas en memoria…');
      setProgress(90);
      procesarJsonOperativaEnMemoria(data);
      global.TURNIO_GTFS_CACHE_SCHEMA = SCHEMA;
      reconstruirSelectores();
      setProgress(100);
      setStatus('Operativa lista · ' + Object.keys(global.viajes).length.toLocaleString('es-ES') + ' servicios');
      if (panelCarga) panelCarga.hidden = true;
      if (panelBusqueda) panelBusqueda.hidden = false;
      return true;
    })();
    try {
      return await cargando;
    } finally {
      cargando = null;
    }
  }

  function filtrarListaEstaciones() {
    var input = document.getElementById('inputEstacionBuscar');
    var lista = document.getElementById('listaEstacionesCustom');
    var vacio = document.getElementById('msgSinEstacion');
    if (!input || !lista) return;
    var q = input.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var nombres = Object.keys(global.mapaEstacionesGlobal || {}).sort(function (a, b) {
      return a.localeCompare(b, 'es');
    });
    var hits = !q ? nombres.slice(0, 40) : nombres.filter(function (n) {
      return n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').indexOf(q) >= 0;
    }).slice(0, 40);
    if (!hits.length) {
      lista.innerHTML = '';
      lista.hidden = true;
      if (vacio) vacio.hidden = false;
      return;
    }
    if (vacio) vacio.hidden = true;
    lista.innerHTML = hits.map(function (nombre) {
      return '<button type="button" class="searchable-option" data-estacion="' + esc(nombre) + '">' + esc(nombre) + '</button>';
    }).join('');
    lista.hidden = false;
  }

  function mostrarListaEstaciones() {
    filtrarListaEstaciones();
  }

  function seleccionarEstacion(nombre) {
    var input = document.getElementById('inputEstacionBuscar');
    var lista = document.getElementById('listaEstacionesCustom');
    if (input) input.value = nombre;
    if (lista) lista.hidden = true;
  }

  function flipCard(el) {
    if (!el) return;
    el.classList.toggle('is-flipped');
  }

  function mostrarDiasCirculacionCuadro() {
    var input = document.getElementById('filtroNumTren');
    var panel = document.getElementById('diasCirculacionTren');
    if (!input || !panel) return;
    var numeroObjetivo = String(input.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!numeroObjetivo) {
      panel.hidden = false;
      panel.innerHTML = '<div class="empty" style="padding:8px;">Introduce primero el número de tren.</div>';
      return;
    }
    var candidatos = Object.keys(global.viajes || {}).map(function (k) { return global.viajes[k]; }).filter(function (v) {
      var numero = String(v.numero_tren || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      return numero === numeroObjetivo;
    });
    if (!candidatos.length) {
      panel.hidden = false;
      panel.innerHTML = '<div class="empty" style="padding:8px;">No hay datos de calendario para este tren.</div>';
      return;
    }
    var nombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    var base = new Date();
    base.setHours(12, 0, 0, 0);
    var filas = [];
    for (var i = 0; i < 7; i++) {
      var fecha = new Date(base.getTime());
      fecha.setDate(base.getDate() + i);
      var iso = fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0') + '-' + String(fecha.getDate()).padStart(2, '0');
      var circula = candidatos.some(function (v) {
        return turnioServicioCirculaEnFecha_(v.service_id, iso);
      });
      filas.push(
        '<div class="mallas-dia ' + (circula ? 'si' : 'no') + '">' +
        '<span>' + (circula ? '✅' : '❌') + ' ' + nombres[fecha.getDay()] + ' ' +
        String(fecha.getDate()).padStart(2, '0') + '/' + String(fecha.getMonth() + 1).padStart(2, '0') +
        '</span><strong>' + (circula ? 'Circula' : 'No circula') + '</strong></div>'
      );
    }
    panel.hidden = false;
    panel.innerHTML = '<strong>🚆 Tren ' + esc(input.value) + '</strong>' + filas.join('');
  }

  function mostrarHorarios() {
    var inputBusqueda = (document.getElementById('inputEstacionBuscar') || {}).value.trim();
    var cont = document.getElementById('resultadosGTFS');
    if (!cont) return;
    cont.innerHTML = '';
    if (!inputBusqueda) {
      cont.innerHTML = '<div class="empty">Selecciona una estación de la lista.</div>';
      return;
    }
    var stopIds = [];
    Object.keys(global.mapaEstacionesGlobal || {}).some(function (key) {
      if (key.toLowerCase() === inputBusqueda.toLowerCase()) {
        stopIds = global.mapaEstacionesGlobal[key];
        return true;
      }
      return false;
    });
    if (!stopIds.length) {
      cont.innerHTML = '<div class="empty error-text">Estación no válida. Escoge una de la lista.</div>';
      return;
    }

    var tipoParada = (document.getElementById('filtroTipoParada') || {}).value || '';
    var prod = (document.getElementById('filtroProducto') || {}).value || '';
    var nTren = String((document.getElementById('filtroNumTren') || {}).value || '').trim().toLowerCase();
    var horaDesdeInput = String((document.getElementById('filtroHoraDesde') || {}).value || '').trim();
    var fechaConsulta = (document.getElementById('filtroFechaServicio') || {}).value || '';

    if (!global._gtfsIdxParadasTrip) actualizarIndiceParadasPorTripGTFS();
    var idxParadas = global._gtfsIdxParadasTrip || {};
    var todasLasParadas = [];
    var todasParaProximos = [];

    (global.horarios || []).forEach(function (h) {
      if (stopIds.indexOf(h.stop_id) < 0 || !h.departure_time) return;
      var dv = global.viajes[h.trip_id];
      if (!dv) return;
      var lim = global.limitesViajes[h.trip_id];
      if (!lim) return;
      if (!turnioServicioCirculaEnFecha_(dv.service_id, fechaConsulta)) return;
      var hl = formatTime(h.departure_time);
      var extMinsSalida = minutosGTFSExtendido_(h.departure_time);
      var sq = parseInt(h.stop_sequence, 10);
      var cal = global.calendarios[dv.service_id];
      var numeroLimpioDisplay = limpiarNumeroTren(dv.numero_tren || h.trip_id);
      var paradasTrip = idxParadas[h.trip_id] || [];
      var extremos = nombresExtremosViajeDesdeParadas(paradasTrip);
      var orgNombre = extremos ? extremos.org : (global.estaciones[lim.origen] || 'Desc.');
      var destNombre = extremos ? extremos.dest : (global.estaciones[lim.destino] || 'Desc.');

      if (sq !== lim.max && (!prod || dv.productoFiltro === prod)) {
        todasParaProximos.push({
          hora_salida: hl, _extMinsSalida: extMinsSalida, num: numeroLimpioDisplay,
          tid: h.trip_id, dest: destNombre
        });
      }
      if (tipoParada === 'origen' && sq !== lim.min) return;
      if (tipoParada === 'destino' && sq !== lim.max) return;
      if (tipoParada === 'intermedia' && (sq === lim.min || sq === lim.max)) return;
      if (prod && dv.productoFiltro !== prod) return;

      todasLasParadas.push({
        hora_salida: hl,
        _extMinsSalida: extMinsSalida,
        hora_llegada_estacion: formatTime(h.arrival_time),
        hora_llegada_destino: (lim.hora_llegada_destino && /^\d{1,2}:\d{2}/.test(String(lim.hora_llegada_destino)))
          ? formatTime(lim.hora_llegada_destino) : (lim.hora_llegada_destino || 'Desc.'),
        prod: dv.productoFiltro,
        tren_front: dv.nombreVisualFrontal,
        es_cerc: dv.esCercanias,
        num: numeroLimpioDisplay,
        un: dv.unidad,
        lin: dv.lineaTren,
        tid: h.trip_id,
        sq: sq,
        org: orgNombre,
        dest: destNombre,
        acc: dv.accesible,
        val: cal && cal.s
          ? ('V: hasta ' + (cal.e ? cal.e.substring(6, 8) + '/' + cal.e.substring(4, 6) : 'fin'))
          : 'Sin datos'
      });
    });

    todasLasParadas.sort(function (a, b) { return (a._extMinsSalida || 0) - (b._extMinsSalida || 0); });
    todasParaProximos.sort(function (a, b) { return (a._extMinsSalida || 0) - (b._extMinsSalida || 0); });

    todasLasParadas.forEach(function (trenActual) {
      var nx = [];
      for (var j = 0; j < todasParaProximos.length; j++) {
        var c = todasParaProximos[j];
        if (c._extMinsSalida < trenActual._extMinsSalida) continue;
        if (c.dest === trenActual.dest && c.num !== trenActual.num) {
          if (!nx.some(function (t) { return t.hora_salida === c.hora_salida; })) nx.push(c);
        }
        if (nx.length === 3) break;
      }
      trenActual.prox = nx;
    });

    var horaCorte;
    if (horaDesdeInput) horaCorte = horaDesdeInput.substring(0, 5);
    else {
      var fechaAhora = new Date();
      var hoyIso = fechaAhora.getFullYear() + '-' + String(fechaAhora.getMonth() + 1).padStart(2, '0') + '-' + String(fechaAhora.getDate()).padStart(2, '0');
      horaCorte = fechaConsulta && fechaConsulta !== hoyIso ? '00:00' : fechaAhora.toTimeString().substring(0, 5);
    }

    var trenesUtiles = [];
    var tripsUnicos = {};
    if (nTren) {
      todasLasParadas.filter(function (t) {
        return String(t.num).toLowerCase().indexOf(nTren) >= 0;
      }).forEach(function (t) {
        var clv = t.num || t.tid;
        if (!tripsUnicos[clv]) { tripsUnicos[clv] = true; trenesUtiles.push(t); }
      });
    } else {
      var corteMins = minutosGTFSExtendido_(horaCorte);
      todasLasParadas.filter(function (t) {
        return (t._extMinsSalida || 0) >= corteMins;
      }).forEach(function (t) {
        var clv = t.num || t.tid;
        if (!tripsUnicos[clv]) { tripsUnicos[clv] = true; trenesUtiles.push(t); }
      });
    }

    var cnt = document.getElementById('contadorResultadosGTFS');
    if (cnt) cnt.textContent = trenesUtiles.length + ' próximos';
    if (!trenesUtiles.length) {
      cont.innerHTML = '<div class="empty">No hay próximos trenes con estos filtros.</div>';
      return;
    }

    trenesUtiles.forEach(function (s) {
      s.marchaStepsHtml = generarHtmlMarchaItinerario(obtenerParadasViajeOrdenadas(s.tid), s.sq);
    });

    var html = trenesUtiles.slice(0, 80).map(function (s) {
      var pxHtml = (s.prox && s.prox.length)
        ? s.prox.map(function (t) {
          return '<span class="next-train-badge">' + esc(t.hora_salida) + ' <small>(Nº' + esc(t.num) + ')</small></span>';
        }).join('')
        : '<span style="font-size:0.7rem;color:var(--muted);">Fin servicio</span>';
      var badgeHtml = s.num ? '<span class="gtfs-badge">Nº ' + esc(s.num) + '</span>' : '';
      var badgeLinea = (s.es_cerc && s.lin && s.lin !== 'undefined')
        ? '<span class="gtfs-badge gtfs-badge--line">' + esc(s.lin) + '</span>' : '';
      return '<article class="flip-card" data-tid="' + esc(s.tid) + '" data-num="' + esc(s.num || '') + '">' +
        '<div class="flip-card-inner">' +
        '<div class="flip-card-front">' +
        '<div class="time-box">' + esc(s.hora_salida) + '</div>' +
        '<div class="trip-info">' +
        '<div class="train-type">🚆 ' + esc(s.tren_front || s.prod || 'Tren') + ' ' + badgeLinea + '</div>' +
        '<div>' + badgeHtml + ' <span class="gtfs-val">📅 ' + esc(s.val) + '</span></div>' +
        '<div class="ruta-delantera">📍 ' + esc(s.org) + ' ➔ ' + esc(s.dest) + '</div>' +
        '<div class="malla-hint">Toca para ver hoja de ruta</div>' +
        '</div></div>' +
        '<div class="flip-card-back">' +
        '<div class="back-detail"><span><strong>Origen:</strong> ' + esc(s.org) + '</span><span><strong>Serv:</strong> ' + esc(s.prod) + '</span></div>' +
        '<div class="back-detail"><span><strong>Tu andén:</strong> ' + esc(s.hora_llegada_estacion) + '</span><span><strong>Fin:</strong> ' + esc(s.dest) + ' (' + esc(s.hora_llegada_destino) + ')</span></div>' +
        '<div class="back-detail"><span><strong>Acceso:</strong> ' + esc(s.acc) + '</span><span><strong>Nº:</strong> ' + esc(s.num || 'N/D') + '</span></div>' +
        '<div class="back-detail back-detail--col"><span><strong>Siguientes a ' + esc(s.dest) + ':</strong></span><div class="prox-row">' + pxHtml + '</div></div>' +
        '<div class="marcha-label">Marcha (operativa diaria)</div>' +
        '<div class="malla-timeline malla-timeline--compact">' + (s.marchaStepsHtml || '<div class="empty">Sin itinerario.</div>') + '</div>' +
        '</div></div></article>';
    }).join('');

    if (trenesUtiles.length > 80) {
      html += '<div class="empty">Mostrando 80 de ' + trenesUtiles.length + '. Afina filtros para ver menos resultados.</div>';
    }
    cont.innerHTML = html;
  }

  function operativaCargada() {
    return !!(global.horarios && global.horarios.length && global.viajes && Object.keys(global.viajes).length);
  }

  function normalizarNombreEst_(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\./g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function resolverStopIdsPorNombre_(nombre) {
    var q = normalizarNombreEst_(nombre);
    if (!q || !global.mapaEstacionesGlobal) return [];
    var exact = [];
    var parcial = [];
    Object.keys(global.mapaEstacionesGlobal).forEach(function (key) {
      var nk = normalizarNombreEst_(key);
      if (!nk) return;
      if (nk === q) exact = exact.concat(global.mapaEstacionesGlobal[key] || []);
      else if (nk.indexOf(q) >= 0 || q.indexOf(nk) >= 0) {
        parcial = parcial.concat(global.mapaEstacionesGlobal[key] || []);
      }
    });
    var ids = exact.length ? exact : parcial;
    var uniq = {};
    ids.forEach(function (id) { if (id) uniq[id] = true; });
    return Object.keys(uniq);
  }

  /**
   * Salidas desde una estación hacia un destino (final o paso), resto del día.
   * opts: { estacion, destino, desdeMinutos, margenMin, excluirTren, fecha, limit }
   */
  function buscarSalidasHaciaDestino(opts) {
    opts = opts || {};
    if (!operativaCargada()) {
      return { ok: false, motivo: 'sin_malla', alternativas: [] };
    }
    var stopOrigen = resolverStopIdsPorNombre_(opts.estacion);
    var stopDest = resolverStopIdsPorNombre_(opts.destino);
    if (!stopOrigen.length) {
      return { ok: false, motivo: 'estacion_origen', alternativas: [], detalle: opts.estacion };
    }
    if (!stopDest.length) {
      return { ok: false, motivo: 'estacion_destino', alternativas: [], detalle: opts.destino };
    }
    if (!global._gtfsIdxParadasTrip) actualizarIndiceParadasPorTripGTFS();
    var idxParadas = global._gtfsIdxParadasTrip || {};
    var desde = Math.max(0, Number(opts.desdeMinutos) || 0);
    var margen = Math.max(0, Number(opts.margenMin) || 8);
    var corte = desde + margen;
    var excluir = String(opts.excluirTren || '').replace(/^0+/, '');
    var fecha = opts.fecha || new Date();
    var limit = Math.max(1, Math.min(Number(opts.limit) || 8, 20));
    var destSet = {};
    stopDest.forEach(function (id) { destSet[id] = true; });
    var origSet = {};
    stopOrigen.forEach(function (id) { origSet[id] = true; });

    var candidatos = [];
    (global.horarios || []).forEach(function (h) {
      if (!origSet[h.stop_id] || !h.departure_time) return;
      var mins = minutosGTFSExtendido_(h.departure_time);
      if (mins < corte || mins >= 24 * 60 + 30) return;
      var dv = global.viajes[h.trip_id];
      if (!dv) return;
      if (!turnioServicioCirculaEnFecha_(dv.service_id, fecha)) return;
      var lim = global.limitesViajes[h.trip_id];
      if (!lim) return;
      var sq = parseInt(h.stop_sequence, 10);
      if (sq === lim.max) return;
      var num = limpiarNumeroTren(dv.numero_tren || h.trip_id);
      if (excluir && String(num).replace(/^0+/, '') === excluir) return;

      var paradas = idxParadas[h.trip_id] || [];
      var destFinal = false;
      var pasaPor = false;
      var horaLlegDest = '';
      var i;
      for (i = 0; i < paradas.length; i++) {
        var p = paradas[i];
        var psq = parseInt(p.stop_sequence, 10);
        if (psq <= sq) continue;
        if (destSet[p.stop_id]) {
          pasaPor = true;
          horaLlegDest = formatTime(p.arrival_time || p.departure_time);
          if (psq === lim.max) destFinal = true;
          break;
        }
      }
      if (!pasaPor) return;
      var extremos = nombresExtremosViajeDesdeParadas(paradas);
      candidatos.push({
        fuente: 'gtfs',
        tren: num,
        tripId: h.trip_id,
        producto: dv.productoFiltro || dv.nombreVisualFrontal || '',
        horaSalida: formatTime(h.departure_time),
        minutosSalida: mins,
        horaLlegadaDestino: horaLlegDest || formatTime(lim.hora_llegada_destino) || '—',
        destinoFinalNombre: extremos ? extremos.dest : (global.estaciones[lim.destino] || ''),
        match: destFinal ? 'destino' : 'paso',
        esperaDesdeLlegada: mins - desde
      });
    });

    candidatos.sort(function (a, b) {
      if (a.match !== b.match) return a.match === 'destino' ? -1 : 1;
      return a.minutosSalida - b.minutosSalida;
    });
    var vistos = {};
    var out = [];
    for (var j = 0; j < candidatos.length; j++) {
      var c = candidatos[j];
      var key = c.tren + '|' + c.horaSalida;
      if (vistos[key]) continue;
      vistos[key] = true;
      out.push(c);
      if (out.length >= limit) break;
    }
    return { ok: true, motivo: '', alternativas: out, malla: true };
  }

  global.TurnioMallasGtfs = {
    asegurarOperativaGtfs: asegurarOperativaGtfs,
    operativaCargada: operativaCargada,
    buscarSalidasHaciaDestino: buscarSalidasHaciaDestino,
    filtrarListaEstaciones: filtrarListaEstaciones,
    mostrarListaEstaciones: mostrarListaEstaciones,
    seleccionarEstacion: seleccionarEstacion,
    mostrarHorarios: mostrarHorarios,
    mostrarDiasCirculacionCuadro: mostrarDiasCirculacionCuadro,
    flipCard: flipCard,
    limpiarNumeroTren: limpiarNumeroTren
  };
})(window);

/* Conexiones / servicios enlazados (Excel HTML Copérnico → Radar TURNIO). */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'turnio-conexiones-v1';

  /* Estaciones preferidas (mismo criterio que servicios-enlazados CG). */
  var ESTACIONES_PREFERIDAS = [
    'sevilla s.j',
    'sevilla santa justa',
    'cordoba',
    'malaga maria zambrano',
    'malaga',
    'antequera santa ana',
    'antequera',
    'granada',
    'dos hermanas'
  ];

  var state = {
    fecha: '',
    filas: [],
    meta: { nombre: '', cargadoEn: '', total: 0 },
    idx: {}
  };

  function hoyIsoLocal_() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  function normalizarTexto_(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function limpiarNumTren_(s) {
    /* Unifica "02100", "2100 ", "2100 (AVE)" → "2100" para casar Radar ↔ Excel. */
    var m = String(s == null ? '' : s).match(/(\d{3,5})/);
    if (!m) return '';
    var n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 100) return '';
    return String(n);
  }

  function celdaTexto_(td) {
    if (!td) return '';
    var t = td.getAttribute('title');
    if (t) return String(t).trim();
    return String(td.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function esEstacionPreferida_(nombre) {
    var n = normalizarTexto_(nombre);
    if (!n) return false;
    for (var i = 0; i < ESTACIONES_PREFERIDAS.length; i++) {
      if (n.indexOf(ESTACIONES_PREFERIDAS[i]) >= 0) return true;
    }
    return false;
  }

  function reconstruirIndice_() {
    state.idx = {};
    state.filas.forEach(function (f, i) {
      [f.servicio, f.servicioEnlazado].forEach(function (num) {
        if (!num) return;
        if (!state.idx[num]) state.idx[num] = [];
        if (state.idx[num].indexOf(i) < 0) state.idx[num].push(i);
      });
    });
  }

  function persistir_() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        fecha: state.fecha,
        filas: state.filas,
        meta: state.meta
      }));
    } catch (err) {
      console.warn('[conexiones] No se pudo guardar en localStorage', err);
    }
  }

  function cargarDesdeStorage_() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.filas)) return false;
      if (data.fecha !== hoyIsoLocal_()) {
        /* Caduca cada día: hay que volver a cargar el Excel. */
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      state.fecha = data.fecha;
      state.filas = data.filas;
      state.meta = data.meta || { nombre: '', cargadoEn: '', total: state.filas.length };
      reconstruirIndice_();
      return state.filas.length > 0;
    } catch (err) {
      return false;
    }
  }

  function parseFilasDesdeTabla_(table) {
    var headers = [];
    var ths = table.querySelectorAll('thead th');
    if (ths.length) {
      ths.forEach(function (th) { headers.push(normalizarTexto_(th.textContent)); });
    }
    var idxOf = function (nombres, exacto) {
      var i, j;
      for (i = 0; i < headers.length; i++) {
        for (j = 0; j < nombres.length; j++) {
          if (headers[i] === nombres[j]) return i;
        }
      }
      if (exacto) return -1;
      for (i = 0; i < headers.length; i++) {
        for (j = 0; j < nombres.length; j++) {
          if (headers[i].indexOf(nombres[j]) >= 0) return i;
        }
      }
      return -1;
    };
    /* "servicio enlazado" antes que "servicio" para no pillarlo por fuzzy. */
    var iServEnl = idxOf(['servicio enlazado'], true);
    if (iServEnl < 0) iServEnl = idxOf(['servicio enlazado']);
    var iServ = -1;
    for (var hs = 0; hs < headers.length; hs++) {
      if (headers[hs] === 'servicio') { iServ = hs; break; }
    }
    if (iServ < 0) {
      for (hs = 0; hs < headers.length; hs++) {
        if (headers[hs].indexOf('servicio') >= 0 && headers[hs].indexOf('enlaz') < 0) {
          iServ = hs;
          break;
        }
      }
    }
    var iOrig = idxOf(['origen'], true);
    var iHSalOrig = idxOf(['hora salida orig'], true);
    var iHLlegEnl = idxOf(['hora llegada enlace'], true);
    var iEstEnl = idxOf(['estacion enlace'], true);
    var iHSalEnl = idxOf(['hora salida enlace'], true);
    var iTiempo = idxOf(['tiempo conexion'], true);
    var iHSal = idxOf(['hora salida'], true);
    var iHLleg = idxOf(['hora llegada'], true);
    var iDest = idxOf(['destino'], true);
    var iViaj = idxOf(['viajeros'], true);

    /* Fallback posiciones típicas Copérnico si no hay thead usable */
    if (iServ < 0) {
      iServ = 0; iOrig = 2; iHSalOrig = 3; iHLlegEnl = 4; iEstEnl = 5;
      iHSalEnl = 6; iTiempo = 7; iServEnl = 9; iHSal = 10; iHLleg = 11; iDest = 12; iViaj = 14;
    }
    if (iServEnl < 0) iServEnl = 9;

    var out = [];
    var trs = table.querySelectorAll('tbody tr');
    trs.forEach(function (tr) {
      var tds = tr.querySelectorAll('td');
      if (tds.length < 6) return;
      var servicio = limpiarNumTren_(celdaTexto_(tds[iServ]));
      var servicioEnlazado = limpiarNumTren_(celdaTexto_(tds[iServEnl >= 0 ? iServEnl : 9]));
      if (!servicio && !servicioEnlazado) return;
      var estEnlace = celdaTexto_(tds[iEstEnl >= 0 ? iEstEnl : 5]);
      out.push({
        servicio: servicio,
        origen: celdaTexto_(tds[iOrig >= 0 ? iOrig : 2]),
        horaSalidaOrig: celdaTexto_(tds[iHSalOrig >= 0 ? iHSalOrig : 3]),
        horaLlegadaEnlace: celdaTexto_(tds[iHLlegEnl >= 0 ? iHLlegEnl : 4]),
        estacionEnlace: estEnlace,
        horaSalidaEnlace: celdaTexto_(tds[iHSalEnl >= 0 ? iHSalEnl : 6]),
        tiempoConexion: parseInt(celdaTexto_(tds[iTiempo >= 0 ? iTiempo : 7]), 10) || 0,
        servicioEnlazado: servicioEnlazado,
        horaSalida: celdaTexto_(tds[iHSal >= 0 ? iHSal : 10]),
        horaLlegada: celdaTexto_(tds[iHLleg >= 0 ? iHLleg : 11]),
        destino: celdaTexto_(tds[iDest >= 0 ? iDest : 12]),
        viajeros: parseInt(celdaTexto_(tds[iViaj >= 0 ? iViaj : 14]), 10) || 0,
        preferida: esEstacionPreferida_(estEnlace)
      });
    });
    return out;
  }

  function parseCopernicoHtml_(text) {
    var doc = new DOMParser().parseFromString(text, 'text/html');
    var table = doc.querySelector('#datos') || doc.querySelector('table.tablalistado') || doc.querySelector('table');
    if (!table) throw new Error('No se encontró la tabla de conexiones en el fichero.');
    var filas = parseFilasDesdeTabla_(table);
    if (!filas.length) throw new Error('La tabla está vacía o no tiene el formato de Trenes Combinados.');
    return filas;
  }

  function aplicarFilas_(filas, nombreArchivo) {
    state.fecha = hoyIsoLocal_();
    state.filas = filas;
    state.meta = {
      nombre: String(nombreArchivo || 'conexiones'),
      cargadoEn: new Date().toISOString(),
      total: filas.length
    };
    reconstruirIndice_();
    persistir_();
  }

  function cargarArchivo(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No se eligió ningún fichero.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('No se pudo leer el fichero.')); };
      reader.onload = function () {
        try {
          var text = String(reader.result || '');
          var head = text.slice(0, 200).toLowerCase();
          if (head.indexOf('<html') >= 0 || head.indexOf('<!doctype') >= 0 || head.indexOf('<table') >= 0) {
            aplicarFilas_(parseCopernicoHtml_(text), file.name);
            resolve(estado());
            return;
          }
          reject(new Error(
            'Este fichero no parece el HTML/Excel de Copérnico (Trenes Combinados). ' +
            'En Copérnico: Buscar → guarda/exporta el resultado (o el .xls HTML) y cárgalo aquí.'
          ));
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file, 'ISO-8859-1');
    });
  }

  function estado() {
    return {
      cargado: !!(state.filas && state.filas.length && state.fecha === hoyIsoLocal_()),
      fecha: state.fecha,
      total: state.filas.length,
      meta: state.meta
    };
  }

  function conexionesDeTren(numTren, soloPreferidas) {
    var num = limpiarNumTren_(numTren);
    if (!num || !state.idx[num]) return [];
    var list = state.idx[num].map(function (i) { return state.filas[i]; }).filter(Boolean);
    if (soloPreferidas !== false) {
      list = list.filter(function (f) { return f.preferida; });
    }
    return list;
  }

  function tieneEnlaces(numTren) {
    if (!estado().cargado) return false;
    return conexionesDeTren(numTren, true).length > 0;
  }

  /** Rol del tren en la fila: llega (servicio), sale (enlazado) o ambos. */
  function rolTrenEnFila(fila, numTren) {
    var num = limpiarNumTren_(numTren);
    if (!num || !fila) return '';
    var llega = fila.servicio === num;
    var sale = fila.servicioEnlazado === num;
    if (llega && sale) return 'ambos';
    if (llega) return 'llega';
    if (sale) return 'sale';
    return '';
  }

  /** Descarga Excel Trenes Combinados del día (GET excel=E; red Renfe + sesión). */
  function urlCombinadosHoy() {
    var n = new Date();
    var dd = String(n.getDate()).padStart(2, '0');
    var mm = String(n.getMonth() + 1).padStart(2, '0');
    var yyyy = n.getFullYear();
    var fecha = encodeURIComponent(dd + '/' + mm + '/' + yyyy);
    return 'http://copernico.sir.renfe.es/copernico/SrvRenfeSeguimiento'
      + '?todo=combinados&excel=E&codusuario=&hoy=' + fecha
      + '&perfil=3&inicio=false&servicio1=&estacion=&orden=4'
      + '&fechaInicio=' + fecha + '&fechaFin=' + fecha;
  }

  function limpiar() {
    state = { fecha: '', filas: [], meta: { nombre: '', cargadoEn: '', total: 0 }, idx: {} };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function listar(opts) {
    opts = opts || {};
    var soloPref = opts.soloPreferidas === true;
    var estacion = normalizarTexto_(opts.estacion || '');
    var tren = limpiarNumTren_(opts.tren || '');
    var q = normalizarTexto_(opts.q || '');
    var turno = String(opts.turno || 'todos');
    var rol = String(opts.rol || 'todos');
    var sort = String(opts.sort || 'hora');
    var limit = Math.max(1, Math.min(Number(opts.limit) || 200, 800));
    var out = [];

    function horaAMinutos(hStr) {
      var m = String(hStr || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return -1;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    function coincideEst(nombreFiltro, valor) {
      var a = normalizarTexto_(nombreFiltro);
      var b = normalizarTexto_(valor);
      return !!(a && b && (b.indexOf(a) >= 0 || a.indexOf(b) >= 0));
    }

    for (var i = 0; i < state.filas.length; i++) {
      var f = Object.assign({}, state.filas[i]);
      if (tren && f.servicio !== tren && f.servicioEnlazado !== tren) continue;

      if (estacion) {
        var enOrig = coincideEst(estacion, f.origen);
        var enEnl = coincideEst(estacion, f.estacionEnlace);
        var enDest = coincideEst(estacion, f.destino);
        if (!enOrig && !enEnl && !enDest) continue;
        f._roles = [];
        if (enOrig) f._roles.push('origen');
        if (enEnl) f._roles.push('enlace');
        if (enDest) f._roles.push('destino');
        if (rol !== 'todos' && f._roles.indexOf(rol) < 0) continue;
      } else if (soloPref) {
        if (!f.preferida) continue;
        f._roles = ['enlace'];
        if (rol !== 'todos' && rol !== 'enlace') continue;
      } else {
        f._roles = [];
      }

      if (turno === 'manana' || turno === 'tarde') {
        var mins = horaAMinutos(f.horaSalidaEnlace);
        if (mins >= 0) {
          var mananaMin = 6 * 60, mananaMax = 14 * 60 + 30, tardeMax = 22 * 60 + 30;
          if (turno === 'manana' && !(mins >= mananaMin && mins < mananaMax)) continue;
          if (turno === 'tarde' && !(mins >= mananaMax && mins <= tardeMax)) continue;
        }
      }
      if (q) {
        var blob = normalizarTexto_([
          f.servicio, f.servicioEnlazado, f.origen, f.destino, f.estacionEnlace
        ].join(' '));
        if (blob.indexOf(q) < 0) continue;
      }
      out.push(f);
    }

    out.sort(function (a, b) {
      if (sort === 'viajeros') return (b.viajeros || 0) - (a.viajeros || 0);
      if (sort === 'conexion') return (a.tiempoConexion || 0) - (b.tiempoConexion || 0);
      return String(a.horaSalidaEnlace || '').localeCompare(String(b.horaSalidaEnlace || ''));
    });

    return out.slice(0, limit);
  }

  function estacionesPreferidasUi() {
    return [
      { id: '__todas__', label: 'Todas', todas: true },
      { id: '', label: 'Todas preferidas', all: true },
      { id: 'sevilla s.j', label: 'Sevilla SJ' },
      { id: 'cordoba', label: 'Córdoba' },
      { id: 'malaga maria zambrano', label: 'Málaga MZ' },
      { id: 'antequera santa ana', label: 'Antequera AV' },
      { id: 'granada', label: 'Granada' },
      { id: 'dos hermanas', label: 'Dos Hermanas' }
    ];
  }

  cargarDesdeStorage_();

  global.TurnioConexiones = {
    cargarArchivo: cargarArchivo,
    estado: estado,
    conexionesDeTren: conexionesDeTren,
    listar: listar,
    estacionesPreferidasUi: estacionesPreferidasUi,
    tieneEnlaces: tieneEnlaces,
    rolTrenEnFila: rolTrenEnFila,
    urlCombinadosHoy: urlCombinadosHoy,
    limpiar: limpiar,
    limpiarNumTren: limpiarNumTren_
  };
})(window);

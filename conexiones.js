/* Conexiones / servicios enlazados (Excel HTML Copérnico → Radar TURNIO). */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'turnio-conexiones-v1';

  /**
   * Preferidas del usuario.
   * null = aún no ha elegido → modo "todas" (todas las filas cuentan).
   * array = ids normalizados de estaciones reales elegidas.
   */
  var preferidasIds_ = null;
  /** Catálogo del día: estaciones reales del Excel (sin tramos A - B). */
  var catalogoDia_ = [];
  /** Patrones de match cuando hay selección (ids normalizados). */
  var ESTACIONES_PREFERIDAS = [];

  /** Tramos de enlace tipo "Chamartín - Atocha" (espacio-guion-espacio): no son una estación. */
  function esEstacionElegible_(nombre) {
    var s = String(nombre == null ? '' : nombre).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    if (s.indexOf(' - ') >= 0) return false;
    return true;
  }

  function idEstacion_(nombre) {
    return normalizarTexto_(nombre);
  }

  function modoTodasPreferidas_() {
    return !preferidasIds_ || !preferidasIds_.length;
  }

  function reconstruirCatalogoDia_() {
    var byId = {};
    state.filas.forEach(function (f) {
      var raw = f && f.estacionEnlace;
      if (!esEstacionElegible_(raw)) return;
      var id = idEstacion_(raw);
      if (!id) return;
      var label = String(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (!byId[id]) {
        byId[id] = { id: id, label: label, n: 0 };
      }
      byId[id].n += 1;
      /* Conserva el label más largo si hay variantes de mayúsculas. */
      if (label.length > byId[id].label.length) byId[id].label = label;
    });
    catalogoDia_ = Object.keys(byId).map(function (k) { return byId[k]; })
      .sort(function (a, b) {
        if (b.n !== a.n) return b.n - a.n;
        return a.label.localeCompare(b.label, 'es');
      });
  }

  function reconstruirMatchPreferidas_() {
    if (modoTodasPreferidas_()) {
      ESTACIONES_PREFERIDAS = [];
      return;
    }
    var pats = [];
    var seen = {};
    preferidasIds_.forEach(function (id) {
      var k = String(id || '').toLowerCase();
      if (!k || seen[k] || !esEstacionElegible_(k)) return;
      seen[k] = 1;
      pats.push(k);
    });
    ESTACIONES_PREFERIDAS = pats;
  }

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
    if (modoTodasPreferidas_()) return true;
    var n = normalizarTexto_(nombre);
    if (!n) return false;
    for (var i = 0; i < ESTACIONES_PREFERIDAS.length; i++) {
      if (n.indexOf(ESTACIONES_PREFERIDAS[i]) >= 0 || ESTACIONES_PREFERIDAS[i].indexOf(n) >= 0) {
        return true;
      }
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
      reconstruirCatalogoDia_();
      refrescarFlagsPreferida_();
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
      total: filas.length,
      compartido: false
    };
    reconstruirIndice_();
    reconstruirCatalogoDia_();
    refrescarFlagsPreferida_();
    persistir_();
  }

  /** Aplica snapshot del servidor (mismo día). Devuelve true si cargó filas. */
  function aplicarSnapshotCompartido(data) {
    if (!data || !Array.isArray(data.filas) || !data.filas.length) return false;
    var fecha = String(data.fecha || hoyIsoLocal_());
    if (fecha !== hoyIsoLocal_()) return false;
    state.fecha = fecha;
    state.filas = data.filas;
    var metaIn = data.meta && typeof data.meta === 'object' ? data.meta : {};
    state.meta = {
      nombre: String(metaIn.nombre || 'compartido'),
      cargadoEn: String(metaIn.publicado_en || metaIn.cargadoEn || new Date().toISOString()),
      total: state.filas.length,
      compartido: true,
      publicado_por: String(metaIn.publicado_por || '')
    };
    reconstruirIndice_();
    reconstruirCatalogoDia_();
    refrescarFlagsPreferida_();
    persistir_();
    return true;
  }

  function snapshotParaPublicar() {
    if (!estado().cargado) return null;
    return {
      fecha: state.fecha,
      filas: state.filas,
      meta: {
        nombre: state.meta && state.meta.nombre ? state.meta.nombre : 'combinados',
        cargadoEn: state.meta && state.meta.cargadoEn ? state.meta.cargadoEn : new Date().toISOString(),
        total: state.filas.length
      }
    };
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
    catalogoDia_ = [];
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

  function refrescarFlagsPreferida_() {
    state.filas.forEach(function (f) {
      f.preferida = esEstacionPreferida_(f.estacionEnlace);
    });
  }

  function setEstacionesPreferidas(ids) {
    if (!Array.isArray(ids) || !ids.length) {
      preferidasIds_ = null;
    } else {
      var out = [];
      var seen = {};
      ids.forEach(function (raw) {
        var id = normalizarTexto_(raw);
        if (!id || seen[id] || !esEstacionElegible_(id)) return;
        if (id.length > 80) return;
        seen[id] = 1;
        out.push(id);
      });
      preferidasIds_ = out.length ? out : null;
    }
    reconstruirMatchPreferidas_();
    refrescarFlagsPreferida_();
    return getEstacionesPreferidas();
  }

  /** null = modo todas (sin elección). */
  function getEstacionesPreferidas() {
    return preferidasIds_ ? preferidasIds_.slice() : null;
  }

  /* Fallback legible si aún no hay Excel del día. */
  function labelEstacionPreferida_(id) {
    var key = normalizarTexto_(id);
    if (!key) return '';
    for (var i = 0; i < catalogoDia_.length; i++) {
      if (catalogoDia_[i].id === key) return catalogoDia_[i].label;
    }
    return key.split(' ').map(function (w) {
      if (!w) return w;
      if (/^s\.?j\.?$/i.test(w)) return 'S.J.';
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function catalogoPreferidas() {
    return catalogoDia_.map(function (c) {
      return { id: c.id, label: c.label, n: c.n };
    });
  }

  function estacionesPreferidasUi() {
    var chips = [
      { id: '__todas__', label: 'Todas', todas: true }
    ];
    if (!modoTodasPreferidas_()) {
      chips.push({ id: '', label: 'Todas preferidas', all: true });
      preferidasIds_.forEach(function (id) {
        chips.push({ id: id, label: labelEstacionPreferida_(id) });
      });
    }
    return chips;
  }

  cargarDesdeStorage_();

  global.TurnioConexiones = {
    cargarArchivo: cargarArchivo,
    aplicarSnapshotCompartido: aplicarSnapshotCompartido,
    snapshotParaPublicar: snapshotParaPublicar,
    estado: estado,
    conexionesDeTren: conexionesDeTren,
    listar: listar,
    estacionesPreferidasUi: estacionesPreferidasUi,
    setEstacionesPreferidas: setEstacionesPreferidas,
    getEstacionesPreferidas: getEstacionesPreferidas,
    catalogoPreferidas: catalogoPreferidas,
    labelEstacionPreferida: labelEstacionPreferida_,
    modoTodasPreferidas: modoTodasPreferidas_,
    esEstacionElegible: esEstacionElegible_,
    tieneEnlaces: tieneEnlaces,
    rolTrenEnFila: rolTrenEnFila,
    urlCombinadosHoy: urlCombinadosHoy,
    limpiar: limpiar,
    limpiarNumTren: limpiarNumTren_
  };
})(window);
